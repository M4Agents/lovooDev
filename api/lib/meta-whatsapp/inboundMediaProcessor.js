// =============================================================================
// inboundMediaProcessor.js  (INBOUND-MEDIA-B)
//
// Responsabilidade única:
//   downloadAndStoreInboundMedia(params)
//
// Transforma:
//   Meta media_id
//   → metadata Graph
//   → bytes Graph/CDN (anti-SSRF, redirect controlado, limite de stream)
//   → validação real dos bytes (MIME pelos bytes, não pelo payload)
//   → Supabase Storage
//   → company_media_library (idempotente via source_ref)
//
// NÃO conhece req/res.
// NÃO resolve credentials (token chega descriptografado pelo caller).
// NÃO resolve company_id (chega validado server-side pelo caller).
// NÃO cria meta_messages nem meta_conversations.
// NÃO chama RPCs de webhook.
//
// IDEMPOTÊNCIA:
//   source_ref = 'meta-inbound:<wamid>'
//   partial unique index (company_id, source_ref) WHERE source_ref IS NOT NULL
//   precheck ANTES de qualquer I/O caro — ZERO Graph/Storage em hit.
//   race 23505 → cleanup + re-query winner.
//
// SEGURANÇA:
//   - token e metadata.url NUNCA presentes em mensagens de erro ou logs
//   - Bytes do stream são autoridade de MIME (não metadata, não extension)
//   - Storage path gerado server-side; bucket e prefixo hardcoded
//   - Toda query CML inclui obrigatoriamente company_id
//   - created_by = NULL (system ingestion, sem contexto de usuário)
//
// DEBT-DOMAIN-ALLOWLIST-C: allowlist provisória de CDN pertence ao graphClient.
//   Não ampliar nem duplicar aqui.
// =============================================================================

import { fileTypeFromBlob }           from 'file-type';
import { downloadMediaMetadata, downloadMediaBytes } from './graphClient.js';
import {
  UUID_RE,
  VALID_MEDIA_TYPES,
  MEDIA_SIZE_LIMITS,
  MIME_TO_MEDIA_TYPE,
  FALLBACK_DOC_FILENAME,
  sanitizeFilename,
} from './mediaConstants.js';

// =============================================================================
// Constantes locais
// =============================================================================

// Bucket Supabase Storage — mesmo que mediaAsset.js e import.js.
const STORAGE_BUCKET = 'aws-lovoocrm-media';

// Prefixo base para mídia inbound Meta.
// Formato final: biblioteca/companies/<companyId>/meta-inbound/<uuid>/<filename>
// companyId e uuid gerados/validados server-side — nunca do payload.
const STORAGE_INBOUND_BASE = 'biblioteca/companies';

// Comprimento máximo defensivo para wamid.
// Não tenta interpretar semanticamente o wamid — apenas limita tamanho.
const WAMID_MAX_LEN = 200;

// Extensão de arquivo por MIME detectado.
// Usada para gerar filenames de fallback para IMAGE/VIDEO.
// PDF (DOCUMENT) usa extensão do filename original sanitizado.
const MIME_TO_EXT = new Map([
  ['image/jpeg',      'jpg'],
  ['image/png',       'png'],
  ['video/mp4',       'mp4'],
  ['video/3gpp',      '3gp'],
  ['application/pdf', 'pdf'],
]);

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Cria um Error com propriedade `code` determinística.
 * Mensagem nunca deve incluir: token, metadata URL, bytes, Authorization.
 *
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function makeError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Remove objeto do Storage após falha de INSERT.
 * Best-effort: erros de cleanup são logados sanitizados e nunca mascaram o erro primário.
 * NUNCA loga: destinationKey completo, token, URL Graph, bytes.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} destinationKey
 */
async function cleanupDestination(svc, destinationKey) {
  try {
    await svc.storage.from(STORAGE_BUCKET).remove([destinationKey]);
  } catch {
    // DEBT D-ORPHAN-STORAGE: cleanup falhou — objeto órfão possível no storage.
    console.error('[inboundMediaProcessor] cleanup-destination-failed — orphan possible');
  }
}

/**
 * Resolve o filename de display para o asset a ser armazenado.
 *
 * DOCUMENT: usa hintFilename sanitizado; fallback = FALLBACK_DOC_FILENAME ('document.pdf').
 * IMAGE/VIDEO: usa hintFilename sanitizado se fornecido; fallback = 'inbound.<ext>'
 *   onde ext vem dos bytes detectados — nunca do payload.
 *
 * NÃO usa extensão do hintFilename para determinar formato.
 * Filename é apenas metadata de display — bytes são autoridade de MIME.
 *
 * @param {'IMAGE'|'VIDEO'|'DOCUMENT'} expectedMediaType
 * @param {unknown} hintFilename
 * @param {string}  detectedExt   — ext dos bytes reais (MIME_TO_EXT)
 * @returns {string}
 */
function resolveFilename(expectedMediaType, hintFilename, detectedExt) {
  if (expectedMediaType === 'DOCUMENT') {
    // sanitizeFilename trata fallback para FALLBACK_DOC_FILENAME
    return sanitizeFilename(hintFilename);
  }
  // IMAGE / VIDEO: usa hintFilename quando fornecido; caso contrário, fallback determinístico
  if (typeof hintFilename === 'string' && hintFilename.trim().length > 0) {
    return sanitizeFilename(hintFilename);
  }
  return `inbound.${detectedExt}`;
}

// =============================================================================
// Função principal exportada
// =============================================================================

/**
 * Baixa, valida e persiste uma mídia inbound Meta no Supabase Storage e CML.
 *
 * Idempotente via source_ref = 'meta-inbound:<wamid>'.
 * Em hit de precheck: retorna asset existente sem nenhum I/O adicional.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.svc
 *   Client Supabase com service_role. Injetado pelo caller server-side.
 * @param {string} params.token
 *   Business token da instância já descriptografado pelo caller. NUNCA logar.
 * @param {string} params.companyId
 *   UUID do tenant. Resolvido server-side pelo caller — nunca do payload.
 * @param {string} params.mediaId
 *   Media ID recebido no webhook (numeric string — validado pelo graphClient).
 * @param {string} params.wamid
 *   Message ID único do webhook. Chave de idempotência.
 * @param {'IMAGE'|'VIDEO'|'DOCUMENT'} params.expectedMediaType
 *   Tipo esperado — deve corresponder ao 'type' do webhook (verificado via bytes).
 * @param {unknown} [params.hintFilename]
 *   Filename original do payload. Não confiável — sempre sanitizado.
 * @param {number} params.maxBytes
 *   Limite máximo de bytes a aceitar. Inteiro positivo ≤ MEDIA_SIZE_LIMITS[type].
 *
 * @returns {Promise<{
 *   assetId:  string,
 *   mimeType: string,
 *   fileSize: number,
 *   filename: string,
 *   reused:   boolean,
 * }>}
 *
 * @throws {Error & { code: string }} com codes:
 *   inbound_media_invalid_input    — inputs inválidos
 *   inbound_media_too_large        — arquivo excede maxBytes ou limite do tipo
 *   inbound_media_type_mismatch    — MIME detectado incompatível com expectedMediaType
 *   inbound_media_download_failed  — falha no metadata ou no download de bytes
 *   inbound_media_storage_failed   — falha no upload para Storage
 *   inbound_media_persistence_failed — falha no INSERT (não-23505)
 *   inbound_media_conflict         — 23505 sem winner encontrado na re-query
 */
export async function downloadAndStoreInboundMedia({
  svc,
  token,
  companyId,
  mediaId,
  wamid,
  expectedMediaType,
  hintFilename,
  maxBytes,
}) {
  // ── 1. Validação de inputs (fail-closed antes de qualquer I/O caro) ──────
  if (!companyId || !UUID_RE.test(companyId)) {
    throw makeError('inbound_media_invalid_input', 'inboundMediaProcessor: companyId inválido');
  }
  if (
    typeof wamid !== 'string' ||
    wamid.trim().length === 0 ||
    wamid.length > WAMID_MAX_LEN
  ) {
    throw makeError('inbound_media_invalid_input', 'inboundMediaProcessor: wamid inválido');
  }
  if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
    throw makeError('inbound_media_invalid_input', 'inboundMediaProcessor: mediaId inválido');
  }
  if (!VALID_MEDIA_TYPES.has(expectedMediaType)) {
    throw makeError('inbound_media_invalid_input', 'inboundMediaProcessor: expectedMediaType inválido');
  }
  const sizeLimit = MEDIA_SIZE_LIMITS[expectedMediaType];
  if (
    typeof maxBytes !== 'number' ||
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > sizeLimit
  ) {
    throw makeError('inbound_media_invalid_input', 'inboundMediaProcessor: maxBytes inválido');
  }

  // ── 2. Idempotência: precheck antes de qualquer Graph call ───────────────
  // source_ref é tenant-scoped pelo índice parcial único (company_id, source_ref).
  // NUNCA buscar source_ref sem company_id.
  const sourceRef = `meta-inbound:${wamid}`;
  {
    const { data: existing } = await svc
      .from('company_media_library')
      .select('id, mime_type, file_size, original_filename')
      .eq('company_id', companyId)
      .eq('source_ref', sourceRef)
      .maybeSingle();

    if (existing) {
      return {
        assetId:  existing.id,
        mimeType: existing.mime_type,
        fileSize: existing.file_size,
        filename: existing.original_filename,
        reused:   true,
      };
    }
  }

  // ── 3. Metadata Graph — URL temporária (NUNCA logar) ────────────────────
  let metadata;
  try {
    metadata = await downloadMediaMetadata(token, mediaId);
  } catch {
    throw makeError('inbound_media_download_failed', 'inboundMediaProcessor: metadata falhou');
  }

  // ── 4. Precheck defensivo de tamanho via metadata (hint — não autoridade) ─
  // metadata.file_size não é fonte de verdade — pode estar ausente ou errado.
  // Usado apenas para rejeição rápida antes do download.
  if (typeof metadata.file_size === 'number' && metadata.file_size > maxBytes) {
    throw makeError('inbound_media_too_large', 'inboundMediaProcessor: arquivo muito grande (precheck)');
  }

  // ── 5. Download de bytes via graphClient ─────────────────────────────────
  // graphClient garante: anti-SSRF, redirect controlado, limite de stream,
  // timeout. Não duplicar essas proteções aqui.
  let blob;
  try {
    blob = await downloadMediaBytes(token, metadata.url, { maxBytes });
  } catch (err) {
    if (err?.code === 'media_download_too_large') {
      throw makeError('inbound_media_too_large', 'inboundMediaProcessor: arquivo muito grande (stream)');
    }
    throw makeError('inbound_media_download_failed', 'inboundMediaProcessor: download falhou');
  }

  // ── 6. Validação de tamanho real (defense in depth) ──────────────────────
  // graphClient já limitou o stream, mas validamos novamente nos bytes reais
  // para garantir que nenhum arquivo oversized chegue ao Storage.
  if (blob.size > maxBytes || blob.size > sizeLimit) {
    throw makeError('inbound_media_too_large', 'inboundMediaProcessor: arquivo muito grande (bytes reais)');
  }

  // ── 7. Detecção de MIME pelos bytes reais (autoridade) ───────────────────
  // metadata.mime_type NÃO é fonte de verdade para segurança.
  // hintFilename NÃO determina formato.
  // Somente bytes reais determinam o MIME aceito.
  const detected = await fileTypeFromBlob(blob);
  if (!detected) {
    throw makeError('inbound_media_type_mismatch', 'inboundMediaProcessor: MIME não detectável pelos bytes');
  }
  const detectedMediaType = MIME_TO_MEDIA_TYPE.get(detected.mime);
  if (!detectedMediaType || detectedMediaType !== expectedMediaType) {
    throw makeError('inbound_media_type_mismatch', 'inboundMediaProcessor: tipo de mídia incompatível');
  }

  // ── 8. Filename de display ───────────────────────────────────────────────
  // hintFilename é não confiável — sempre sanitizado.
  // Extensão do fallback vem dos bytes detectados (MIME_TO_EXT).
  const ext      = MIME_TO_EXT.get(detected.mime) ?? 'bin';
  const filename = resolveFilename(expectedMediaType, hintFilename, ext);

  // ── 9. Storage path (gerado server-side) ─────────────────────────────────
  // companyId e importId são gerados/validados server-side.
  // Bucket e prefixo hardcoded — nunca aceitos do caller.
  const importId        = crypto.randomUUID();
  const destinationKey  = `${STORAGE_INBOUND_BASE}/${companyId}/meta-inbound/${importId}/${filename}`;

  // ── 10. Upload para Supabase Storage ─────────────────────────────────────
  const { error: uploadErr } = await svc.storage
    .from(STORAGE_BUCKET)
    .upload(destinationKey, blob, {
      contentType: detected.mime,
      upsert:      false, // Nunca sobrescrever — importId garante unicidade
    });

  if (uploadErr) {
    throw makeError('inbound_media_storage_failed', 'inboundMediaProcessor: upload falhou');
  }

  // ── 11. Preview URL ───────────────────────────────────────────────────────
  // getPublicUrl() é síncrono e nunca falha — gera URL pública do bucket.
  const { data: urlData } = svc.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(destinationKey);
  const previewUrl = urlData?.publicUrl ?? null;

  // ── 12. INSERT em company_media_library ───────────────────────────────────
  // created_by = NULL: ingestão automática de sistema, sem contexto de usuário.
  // Schema: created_by UUID REFERENCES users(id) — sem NOT NULL → aceita NULL.
  const { data: inserted, error: insertErr } = await svc
    .from('company_media_library')
    .insert({
      company_id:        companyId,
      folder_path:       '/',
      original_filename: filename,
      s3_key:            destinationKey,
      file_type:         expectedMediaType.toLowerCase(),
      mime_type:         detected.mime,
      file_size:         blob.size,
      preview_url:       previewUrl,
      created_by:        null,
      source_ref:        sourceRef,
    })
    .select('id')
    .single();

  // ── 13. Tratamento de erros de INSERT ─────────────────────────────────────
  if (insertErr) {
    if (insertErr.code === '23505') {
      // Race condition: precheck passou, mas outro processo inseriu antes.
      // 1. Cleanup best-effort do objeto Storage criado por este processo.
      // 2. Re-query para retornar o winner.
      // NÃO identificar 23505 por texto — code é API estável, texto não.
      await cleanupDestination(svc, destinationKey);

      const { data: winner } = await svc
        .from('company_media_library')
        .select('id, mime_type, file_size, original_filename')
        .eq('company_id', companyId)
        .eq('source_ref', sourceRef)
        .maybeSingle();

      if (winner) {
        return {
          assetId:  winner.id,
          mimeType: winner.mime_type,
          fileSize: winner.file_size,
          filename: winner.original_filename,
          reused:   true,
        };
      }

      // 23505 sem winner → outra constraint (s3_key?) ou situação inesperada.
      throw makeError('inbound_media_conflict', 'inboundMediaProcessor: conflito de insert não resolvido');
    }

    // Falha de INSERT não-23505 → cleanup e falha controlada.
    await cleanupDestination(svc, destinationKey);
    throw makeError('inbound_media_persistence_failed', 'inboundMediaProcessor: insert falhou');
  }

  // ── 14. Sucesso ───────────────────────────────────────────────────────────
  return {
    assetId:  inserted.id,
    mimeType: detected.mime,
    fileSize: blob.size,
    filename,
    reused:   false,
  };
}
