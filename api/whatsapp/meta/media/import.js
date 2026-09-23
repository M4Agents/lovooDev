// =============================================================================
// POST /api/whatsapp/meta/media/import
//
// Importa idempotentemente um asset de lead_media_unified para company_media_library,
// tornando-o disponível como HEADER de template Meta.
//
// FLUXO:
//   1. Method guard (POST only)
//   2. Auth + RBAC + feature flag via validateMetaCaller (META_SEND_ROLES)
//   3. Validação de source_id UUID (após auth)
//   4. Idempotency precheck via source_ref = 'lmu:<source_id>'
//   5. Lookup tenant-safe em lead_media_unified
//   6. Validação de prefixo de key (clientes/<company_id>/)
//   7. Validação de file_type suportado
//   8. DB file_size prefilter (hint — não autoridade)
//   9. Download de bytes via AWS (awsDownload.js)
//  10. Validação de tamanho real (autoridade)
//  11. Detecção de MIME pelos bytes reais (fileTypeFromBlob)
//  12. Whitelist MIME conservadora
//  13. Compatibilidade MIME × file_type do DB
//  14. Geração de destinationKey (biblioteca/companies/<co>/meta-imports/<uuid>/<filename>)
//  15. Upload para Supabase Storage
//  16. Obtenção de preview_url via getPublicUrl()
//  17. INSERT em company_media_library com source_ref e created_by
//  18. Tratamento 23505: cleanup + re-query (sem parse de texto de erro)
//  19. Retorna { id }
//
// SEGURANÇA:
//   - company_id vem EXCLUSIVAMENTE de auth.companyId (validado pelo guard).
//   - source_id é validado como UUID após auth — nunca antes.
//   - Prefixo de key validado server-side para garantia de isolamento cross-tenant.
//   - Nenhum dado de credencial, key ou conteúdo é logado.
//   - service_role confinado ao backend (este arquivo).
//
// IDEMPOTÊNCIA:
//   - source_ref = 'lmu:<uuid_canônico>' garante unicidade via partial unique index.
//   - Precheck antes do download evita overhead em requisições repetidas.
//   - Race condition pós-INSERT tratada via 23505 → cleanup → re-query.
// =============================================================================

import { fileTypeFromBlob }              from 'file-type';
import { getSupabaseAdmin }              from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_SEND_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { downloadAwsBytes }              from '../../../lib/meta-whatsapp/awsDownload.js';
import {
  UUID_RE,
  MEDIA_SIZE_LIMITS,
  MIME_TO_MEDIA_TYPE,
  sanitizeFilename,
} from '../../../lib/meta-whatsapp/mediaConstants.js';

// =============================================================================
// Constantes locais
// =============================================================================

const STORAGE_BUCKET = 'aws-lovoocrm-media';

// Prefixo base do Supabase Storage para assets importados.
// Formato final: biblioteca/companies/<co>/meta-imports/<uuid>/<filename>
const STORAGE_IMPORT_BASE = 'biblioteca/companies';

// Mapeamento DB file_type (lowercase) → MEDIA_TYPE (uppercase)
// Apenas tipos presentes na whitelist MIME_TO_MEDIA_TYPE são suportados.
const DB_FILE_TYPE_TO_MEDIA = {
  image:    'IMAGE',
  video:    'VIDEO',
  document: 'DOCUMENT',
};

// Extensão de arquivo por MIME para o destinationKey.
// Usada quando o filename original não é adequado para tipos não-DOCUMENT.
const MIME_TO_EXT = new Map([
  ['image/jpeg',      'jpg'],
  ['image/png',       'png'],
  ['video/mp4',       'mp4'],
  ['video/3gpp',      '3gp'],
  ['application/pdf', 'pdf'],
]);

// =============================================================================
// Helper privado — cleanup seguro de destinationKey em storage
// =============================================================================

/**
 * Remove um objeto do Supabase Storage após falha de INSERT.
 * Erros de cleanup são logados de forma sanitizada e nunca mascaram o erro primário.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} destinationKey
 */
async function cleanupDestination(svc, destinationKey) {
  try {
    await svc.storage.from(STORAGE_BUCKET).remove([destinationKey]);
  } catch {
    // DEBT D-ORPHAN-STORAGE: cleanup falhou — objeto órfão pode ficar no storage.
    // Não logar destinationKey pois pode conter company_id e uuid sensíveis.
    console.error('[meta/media/import] cleanup-destination-failed — orphan possible');
  }
}

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  // ── 1. Method guard ─────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // ── 2. Supabase admin (service_role — backend only) ──────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    const { company_id: bodyCompanyId, source_id: sourceId } = req.body ?? {};

    // ── 3. Auth + RBAC + feature flag ─────────────────────────────────────────
    // validateMetaCaller valida JWT, membership, is_active, role e feature flag.
    // auth.companyId é a fonte de verdade do tenant — nunca bodyCompanyId diretamente.
    const auth = await validateMetaCaller(req, svc, bodyCompanyId, {
      roles: META_SEND_ROLES,
    });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    // ── 4. Validar source_id UUID (após auth) ─────────────────────────────────
    // Validação deliberadamente após auth para não vazar informação de schema
    // em contexto não autenticado.
    if (!sourceId || !UUID_RE.test(sourceId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    // ── 5. Canonical source_ref ───────────────────────────────────────────────
    const canonicalSourceId = sourceId.toLowerCase();
    const sourceRef         = `lmu:${canonicalSourceId}`;

    // ── 6. Idempotency precheck ───────────────────────────────────────────────
    // Verificar ANTES do download para evitar sobrecarga em requisições repetidas.
    // O partial unique index (company_id, source_ref WHERE source_ref IS NOT NULL)
    // garante que este precheck e o INSERT são idempotentes.
    {
      const { data: existing } = await svc
        .from('company_media_library')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('source_ref', sourceRef)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ id: existing.id });
      }
    }

    // ── 7. Lookup tenant-safe em lead_media_unified ───────────────────────────
    // Obrigatório: id = canonicalSourceId AND company_id = auth.companyId.
    // Cross-tenant e inexistente são indistinguíveis (resposta opaca 404).
    const { data: source, error: sourceErr } = await svc
      .from('lead_media_unified')
      .select('id, s3_key, file_size, mime_type, original_filename, file_type')
      .eq('id', canonicalSourceId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (sourceErr || !source) {
      return res.status(404).json({ error: 'source_not_found' });
    }

    // ── 8. Validação de prefixo de key (defense-in-depth) ─────────────────────
    // s3_key deve iniciar com clientes/<auth.companyId>/ para garantir que
    // nenhum asset cross-tenant seja acessado mesmo em caso de bug upstream.
    const allowedPrefix = `clientes/${auth.companyId}/`;
    if (!source.s3_key.startsWith(allowedPrefix)) {
      console.error('[meta/media/import] prefix-violation detected', {
        companyId: auth.companyId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }

    // ── 9. Validação de file_type suportado ───────────────────────────────────
    const expectedMediaType = DB_FILE_TYPE_TO_MEDIA[source.file_type];
    if (!expectedMediaType) {
      return res.status(422).json({ error: 'media_type_unsupported' });
    }

    // ── 10. DB file_size prefilter (hint — não autoridade) ────────────────────
    // Rejeição rápida antes do download para tipos sabidamente grandes.
    const sizeLimit = MEDIA_SIZE_LIMITS[expectedMediaType];
    if (typeof source.file_size === 'number' && source.file_size > sizeLimit) {
      return res.status(422).json({ error: 'media_too_large' });
    }

    // ── 11. Download de bytes via AWS ─────────────────────────────────────────
    let buffer;
    try {
      buffer = await downloadAwsBytes({
        svc,
        companyId: auth.companyId,
        key:       source.s3_key,
      });
    } catch (err) {
      if (err.code === 'aws_object_not_found') {
        return res.status(404).json({ error: 'source_file_not_found' });
      }
      if (err.code === 'aws_credentials_unavailable') {
        return res.status(500).json({ error: 'internal_error' });
      }
      return res.status(502).json({ error: 'source_unavailable' });
    }

    // ── 12. Validação de tamanho real (autoridade) ────────────────────────────
    if (buffer.length > sizeLimit) {
      return res.status(422).json({ error: 'media_too_large' });
    }

    // ── 13. Detecção de MIME pelos bytes reais ────────────────────────────────
    // mime_type, file_type e original_filename do DB NÃO são autoridade de segurança.
    // Somente os bytes reais determinam o MIME aceito.
    const detected = await fileTypeFromBlob(new Blob([buffer]));
    if (!detected) {
      return res.status(422).json({ error: 'media_type_unknown' });
    }

    // ── 14. Whitelist MIME conservadora ──────────────────────────────────────
    const detectedMediaType = MIME_TO_MEDIA_TYPE.get(detected.mime);
    if (!detectedMediaType) {
      return res.status(422).json({ error: 'media_type_unsupported' });
    }

    // ── 15. Compatibilidade MIME × file_type do DB ────────────────────────────
    // O MIME real deve ser compatível com o file_type declarado no DB.
    // Ex: um arquivo 'video' cujos bytes detectam image/jpeg → rejeitado.
    if (detectedMediaType !== expectedMediaType) {
      return res.status(422).json({ error: 'media_type_mismatch' });
    }

    // ── 16. Geração de destinationKey ─────────────────────────────────────────
    // Formato: biblioteca/companies/<co>/meta-imports/<uuid>/<filename>
    // Cada importação gera um UUID único → sem colisão mesmo em re-tentativas pré-23505.
    const importId = crypto.randomUUID();
    const ext      = MIME_TO_EXT.get(detected.mime) ?? 'bin';

    // DOCUMENT: usa filename original sanitizado (necessário para payload Graph).
    // IMAGE/VIDEO: usa importId.<ext> (filename não é exigido pelo payload Graph).
    const displayFilename =
      expectedMediaType === 'DOCUMENT'
        ? sanitizeFilename(source.original_filename)
        : `${importId}.${ext}`;

    const destinationKey = `${STORAGE_IMPORT_BASE}/${auth.companyId}/meta-imports/${importId}/${displayFilename}`;

    // ── 17. Upload para Supabase Storage ─────────────────────────────────────
    const { error: uploadErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .upload(destinationKey, buffer, {
        contentType: detected.mime,
        upsert:      false, // Nunca sobrescrever — importId garante unicidade
      });

    if (uploadErr) {
      return res.status(500).json({ error: 'internal_error' });
    }

    // ── 18. Obter preview_url via SDK ─────────────────────────────────────────
    // getPublicUrl() é síncrono e nunca falha — apenas gera a URL pública.
    const { data: urlData } = svc.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(destinationKey);

    const previewUrl = urlData?.publicUrl ?? null;

    // ── 19. INSERT em company_media_library ────────────────────────────────────
    const { data: inserted, error: insertErr } = await svc
      .from('company_media_library')
      .insert({
        company_id:        auth.companyId,
        folder_path:       '/',
        original_filename: sanitizeFilename(source.original_filename),
        s3_key:            destinationKey,
        file_type:         source.file_type,   // lowercase — consistente com a tabela
        mime_type:         detected.mime,       // autoridade — bytes reais
        file_size:         buffer.length,       // autoridade — bytes reais
        preview_url:       previewUrl,
        created_by:        auth.userId,
        source_ref:        sourceRef,
      })
      .select('id')
      .single();

    // ── 20. Tratamento de erros de INSERT ─────────────────────────────────────
    if (insertErr) {
      if (insertErr.code === '23505') {
        // Race condition: outro processo inseriu o mesmo source_ref entre
        // o precheck (passo 6) e este INSERT. Limpar o destination órfão
        // e re-consultar para retornar o id do vencedor da race.
        //
        // NÃO fazer parse do texto da mensagem de erro para identificar a constraint
        // violada — texto não é API estável e varia por locale/versão do PG.
        await cleanupDestination(svc, destinationKey);

        const { data: raceWinner } = await svc
          .from('company_media_library')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('source_ref', sourceRef)
          .maybeSingle();

        if (raceWinner) {
          return res.status(200).json({ id: raceWinner.id });
        }

        // 23505 sem source_ref encontrado → outra constraint violada (s3_key, etc.)
        // Fail-closed: não tentar recuperar — situação inesperada.
        return res.status(409).json({ error: 'conflict_error' });
      }

      // Falha de INSERT não-23505 → cleanup e falha controlada.
      await cleanupDestination(svc, destinationKey);
      return res.status(500).json({ error: 'internal_error' });
    }

    // ── 21. Sucesso ────────────────────────────────────────────────────────────
    return res.status(200).json({ id: inserted.id });
  } catch (err) {
    console.error('[meta/media/import] unexpected-error', { message: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}
