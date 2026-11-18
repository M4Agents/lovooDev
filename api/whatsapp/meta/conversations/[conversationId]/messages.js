// =============================================================================
// GET /api/whatsapp/meta/conversations/:conversationId/messages
//
// Retorna as N mensagens mais recentes de uma conversa Meta WhatsApp,
// em ordem cronológica (mais antiga → mais recente).
//
// Query params:
//   company_id      (string, obrigatório)
//   limit           (integer, opcional) — padrão 50, máximo 100
//
// Fluxo de segurança (ordem obrigatória — não alterar):
//   1. Method guard (GET only)
//   2. Extrair e validar company_id, conversationId e limit — sem DB
//   3. getSupabaseAdmin()
//   4. validateMetaCaller() — auth + RBAC + feature flag
//   5. [somente após auth.ok] Lookup de meta_conversations com auth.companyId
//   6. [somente após conversa válida] Query de meta_messages com auth.companyId
//   7. [somente após messages] Resolução batched de assets de mídia (MVP4B.6C)
//      AUDIO AWS inbound: signed GetObject (TTL 3600) via helper inbound
//      AUDIO AWS outbound: signed GetObject (TTL 3600) só com s3_key
//        clientes/{companyId}/meta-outbound/{operationId}/audio.m4a
//      s3_key nunca no DTO
//   8. [somente outbound com wamid] Tracking batched em meta_whatsapp_messages
//      (MVP5.B1.1 — delivery_status; wamid nunca no DTO)
//
// Segurança:
//   - company_id da query identifica o tenant — nunca autoriza acesso diretamente
//   - PROIBIDO consultar meta_conversations antes de auth.ok
//   - Toda query usa auth.companyId (nunca req.query.company_id como filtro DB)
//   - conversation_id e instance_id na query de messages vêm do objeto DB,
//     nunca do caller — impede travessia cross-tenant via IDs injetados
//   - 404 idêntico para: inexistente, outro tenant, archived — sem oracle
//   - SELECT explícito: sem company_id, updated_at, SELECT *
//   - media_asset_id e meta_message_id: selecionados internamente; não expostos no DTO
//   - delivery_status: enriquecido via tracking outbound; inbound e ausência → null
//   - asset lookup: filtra company_id = auth.companyId (tenant-safe); s3_key nunca exposto
//   - Respostas 500 nunca expõem stack, erro bruto Supabase, PII ou credentials
//   - Zero logging de Authorization, token ou segredos
//
// RBAC:
//   - META_VIEW_ROLES (todos os roles, incluindo seller)
//   - Partner: exige assignment ativo (validado pelo guard)
//   - Parent → child: somente super_admin/system_admin do parent correto
//
// Ordenação:
//   Busca as N mensagens mais recentes (DESC) e inverte antes de retornar
//   → frontend recebe ordem cronológica (mais antiga → mais recente).
//   Tiebreaker: created_at DESC para desempate determinístico.
//
// Lista vazia:
//   Conversa ativa sem mensagens ainda → 200 { messages: [] }
// =============================================================================

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSupabaseAdmin }                   from '../../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';
import { sanitizeTemplateButtonsSnapshot }    from '../../../../lib/meta-whatsapp/templateButtonsSnapshot.js';
import {
  SIGNED_URL_TTL_SECONDS,
  signMetaInboundAudioGetUrl,
} from '../../../../lib/meta-whatsapp/awsUpload.js';
import { parseOperationId } from '../../../../lib/meta-whatsapp/outboundAudioOperation.js';
import {
  buildMetaOutboundAudioS3Key,
  META_OUTBOUND_AUDIO_S3_FILENAME,
  META_OUTBOUND_AUDIO_S3_KEY_INFIX,
} from '../../../../lib/meta-whatsapp/awsOutboundAudio.js';

// UUID v4 básico — rejeita inputs obviamente inválidos antes de qualquer query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite máximo de mensagens por request.
const LIMIT_MAX     = 100;
const LIMIT_DEFAULT = 50;

// Campos públicos de meta_conversations necessários para o lookup.
// SELECT mínimo: apenas o que é usado nas queries subsequentes.
const CONV_FIELDS = 'id, instance_id';

// Campos de meta_messages para o SELECT interno.
// media_asset_id: usado apenas para resolução de mídia (Step 7); não exposto no DTO final.
// meta_message_id: usado apenas para correlacionar tracking (Step 8); não exposto no DTO.
// Nunca incluir: company_id, updated_at.
// template_name e template_language: presentes nas colunas desde MVP4A.4.
// Retornados como null em mensagens de texto — nunca ausentes do shape.
const MSG_FIELDS = [
  'id',
  'conversation_id',
  'instance_id',
  'direction',
  'message_type',
  'body',
  'provider_timestamp',
  'created_at',
  'template_name',
  'template_language',
  'media_asset_id',       // MVP4B.6C — interno; removido do DTO antes de retornar
  'template_buttons',     // MVP4C.4B — sanitizado no DTO; nunca JSONB cru
  'meta_message_id',      // MVP5.B1.1 — interno; correlaciona tracking; nunca no DTO
].join(', ');

// Statuses públicos de entrega. Qualquer outro valor do tracking → null.
const ALLOWED_DELIVERY_STATUS = new Set([
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
]);

// Campos internos de company_media_library para enriquecimento do DTO de mídia.
// s3_key e company_id: somente para assinatura AWS AUDIO e boundary de tenant.
// Nunca expostos no DTO.
const ASSET_FIELDS = 'id, company_id, preview_url, original_filename, mime_type, file_type, file_size, s3_key';

const AWS_AUDIO_KEY_INFIX = 'meta-inbound';
const AWS_CREDS_ERR = 'aws_credentials_unavailable';
const AWS_SIGN_ERR = 'aws_sign_failed';

// Tipos de file_type aceitos no DTO de mídia — fail-closed.
// Outros, null, desconhecido → media:null.
// AUDIO só é anexado quando message_type === 'audio' (não altera template/image/video/document).
const ALLOWED_MEDIA_TYPES = new Set(['image', 'video', 'document', 'audio']);

/**
 * AUDIO exige correspondência estrita message_type ↔ file_type.
 * IMAGE/VIDEO/DOCUMENT preservam o contrato atual (template HEADER usa
 * message_type='template' com file_type image/video/document).
 */
function isCompatibleMediaType(messageType, fileType) {
  if (!ALLOWED_MEDIA_TYPES.has(fileType)) return false;
  if (fileType === 'audio' || messageType === 'audio') {
    return messageType === 'audio' && fileType === 'audio';
  }
  return true;
}

function hasPublicPreviewUrl(previewUrl) {
  return typeof previewUrl === 'string' && previewUrl.trim().length > 0;
}

/**
 * Roteamento: AUDIO AWS inbound usa prefixo do helper.
 * Autorização efetiva permanece em signMetaInboundAudioGetUrl (tenant + path).
 * Não aceita key do caller — somente s3_key do asset já filtrado por company_id.
 */
function isAwsMetaInboundAudioKey(companyId, s3Key) {
  if (typeof companyId !== 'string' || typeof s3Key !== 'string') return false;
  const key = s3Key.trim();
  if (key.length === 0) return false;
  return key.startsWith(`clientes/${companyId}/${AWS_AUDIO_KEY_INFIX}/`);
}

function shouldSignAwsInboundAudio(messageType, asset, companyId) {
  if (messageType !== 'audio') return false;
  if (!asset || asset.file_type !== 'audio') return false;
  if (asset.company_id !== companyId) return false;
  if (hasPublicPreviewUrl(asset.preview_url)) return false;
  return isAwsMetaInboundAudioKey(companyId, asset.s3_key);
}

function isUnsafeS3Key(key) {
  return (
    key.startsWith('http://')
    || key.startsWith('https://')
    || key.includes('\\')
    || key.includes('\0')
    || key.includes('..')
    || key.includes('//')
    || /%2e%2e/i.test(key)
  );
}

/**
 * Chave outbound autorizada: clientes/{companyId}/meta-outbound/{operationId}/audio.m4a
 * operationId UUID v4. Compara com a chave determinística do helper B.1.
 */
function isAwsMetaOutboundAudioKey(companyId, s3Key) {
  if (typeof companyId !== 'string' || typeof s3Key !== 'string') return false;
  const key = s3Key.trim();
  if (key.length === 0 || isUnsafeS3Key(key)) return false;
  const parts = key.split('/');
  if (parts.length !== 5) return false;
  if (parts[0] !== 'clientes') return false;
  if (parts[1].toLowerCase() !== companyId.toLowerCase()) return false;
  if (parts[2] !== META_OUTBOUND_AUDIO_S3_KEY_INFIX) return false;
  if (parts[4] !== META_OUTBOUND_AUDIO_S3_FILENAME) return false;
  const parsed = parseOperationId(parts[3]);
  if (!parsed.ok) return false;
  const built = buildMetaOutboundAudioS3Key({
    companyId,
    operationId: parsed.operationId,
  });
  return built.ok === true && built.objectKey === key;
}

function shouldSignAwsOutboundAudio(message, asset, companyId) {
  if (message?.direction !== 'outbound') return false;
  if (message.message_type !== 'audio') return false;
  if (!message.media_asset_id) return false;
  if (!asset || asset.file_type !== 'audio') return false;
  if (asset.company_id !== companyId) return false;
  if (hasPublicPreviewUrl(asset.preview_url)) return false;
  return isAwsMetaOutboundAudioKey(companyId, asset.s3_key);
}

function readAwsCredentialsRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (
    row == null
    || typeof row.access_key_id !== 'string'
    || row.access_key_id.length === 0
    || typeof row.secret_access_key !== 'string'
    || row.secret_access_key.length === 0
    || typeof row.region !== 'string'
    || row.region.length === 0
    || typeof row.bucket !== 'string'
    || row.bucket.length === 0
  ) {
    return null;
  }
  return row;
}

function makeAwsError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Signed GetObject para chave outbound já validada no caller.
 * Credenciais por tenant via a mesma RPC inbound. Sem process.env. Sem URL pública.
 */
async function signMetaOutboundAudioGetUrl({ svc, companyId, objectKey }) {
  const { data, error } = await svc.rpc('webhook_resolve_aws_credentials', {
    p_company_id: companyId,
  });
  const creds = readAwsCredentialsRow(data);
  if (error || !creds) {
    throw makeAwsError(AWS_CREDS_ERR, 'AWS credentials unavailable for tenant');
  }
  const client = new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
    maxAttempts: 1,
  });
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: creds.bucket, Key: objectKey }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
  if (typeof url !== 'string' || url.length === 0) {
    throw makeAwsError(AWS_SIGN_ERR, 'AWS request failed');
  }
  return { url, expiresIn: SIGNED_URL_TTL_SECONDS };
}

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair e validar parâmetros (sem DB) ───────────────────────────────
  const companyId      = req.query?.company_id;
  const conversationId = req.query?.conversationId;
  const limitParam     = req.query?.limit;

  // 2a. company_id obrigatório
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // 2b. conversationId formato UUID
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return res.status(400).json({ error: 'conversationId inválido' });
  }

  // 2c. limit: inteiro >= 1; clamp no máximo
  let safeLimit = LIMIT_DEFAULT;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== limitParam) {
      return res.status(400).json({ error: 'limit inválido — deve ser inteiro positivo' });
    }
    safeLimit = Math.min(parsed, LIMIT_MAX);
  }

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados.
  // Nunca logar: Authorization, token, stack.
  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  // validateMetaCaller valida (nesta ordem):
  //   Bearer → JWT → UUID format → membership → role → partner → parent → flag
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. Conversation lookup — somente após auth.ok ─────────────────────────
  // PROIBIDO executar antes de auth. Segue padrão Meta (não o Instagram).
  // Filtros obrigatórios:
  //   id          = conversationId (do caller, já validado como UUID)
  //   company_id  = auth.companyId (nunca req.query — trava no tenant autorizado)
  //   status      = 'active'       (archived → 404, consistente com /conversations)
  //
  // Resposta 404 idêntica para: inexistente, outro tenant, archived.
  // Impede Existence Oracle: caller não distingue os três casos.
  const { data: conversation, error: convErr } = await svc
    .from('meta_conversations')
    .select(CONV_FIELDS)
    .eq('id', conversationId)
    .eq('company_id', auth.companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (convErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  // ── 6. Messages query — somente após conversa validada ────────────────────
  // conversation_id e instance_id vêm do objeto DB (nunca do caller).
  // Isso garante que qualquer UUID injetado pelo caller seja substituído
  // pelo valor real pertencente ao tenant autorizado.
  //
  // Estratégia de ordenação:
  //   Busca as N mais recentes (DESC) e inverte antes de retornar.
  //   → O frontend recebe ordem cronológica (mais antiga → mais recente).
  //   Tiebreaker created_at DESC: desempate determinístico quando
  //   provider_timestamp é igual ou NULL.
  //   NULLS LAST em DESC: mensagens sem timestamp Meta ficam ao final
  //   da seleção DESC (portanto ao início após reverse — comportamento
  //   aceitável; em MVP3A todos os inbounds têm provider_timestamp).
  const { data, error: msgErr } = await svc
    .from('meta_messages')
    .select(MSG_FIELDS)
    .eq('company_id', auth.companyId)
    .eq('conversation_id', conversation.id)
    .eq('instance_id', conversation.instance_id)
    .order('provider_timestamp', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (msgErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Inverter para ordem cronológica (mais antiga → mais recente).
  // Spread para evitar mutação do array original retornado pelo Supabase.
  const rawMessages = [...(data ?? [])].reverse();

  // ── 7. Media resolution — batched, tenant-safe ─────────────────────────────
  // Sem N+1: uma única query de assets, independente do número de mensagens.
  // Fail-closed:
  //   - asset inexistente   → media:null (nunca fallback global)
  //   - asset outro tenant  → media:null (boundary: company_id = auth.companyId)
  //   - file_type inválido  → media:null (fora da allowlist)
  //   - audio com file_type divergente → media:null (fail-closed)
  //   - asset query error   → 500 (consistente com padrão do endpoint)
  // media_asset_id nunca aparece no DTO final.
  const mediaIds = [...new Set(
    rawMessages.flatMap(m => (m.media_asset_id ? [m.media_asset_id] : []))
  )];

  let assetMap = new Map();
  if (mediaIds.length > 0) {
    const { data: assets, error: assetErr } = await svc
      .from('company_media_library')
      .select(ASSET_FIELDS)
      .eq('company_id', auth.companyId)   // boundary tenant-safe obrigatório
      .in('id', mediaIds);

    if (assetErr) {
      return res.status(500).json({ error: 'internal_error' });
    }

    for (const asset of (assets ?? [])) {
      assetMap.set(asset.id, asset);
    }
  }

  // AUDIO AWS: URL assinada por asset, após tenant boundary.
  // Inbound: helper meta-inbound. Outbound: chave determinística meta-outbound.
  // Falha de signer → media.url null nesta mensagem; demais mensagens intactas.
  // Nunca logar object key, signed URL ou credenciais.
  const signedUrlByAssetId = new Map();
  {
    const inboundToSign = new Map();
    const outboundToSign = new Map();
    for (const msg of rawMessages) {
      if (msg.message_type !== 'audio' || !msg.media_asset_id) continue;
      const asset = assetMap.get(msg.media_asset_id);
      if (shouldSignAwsInboundAudio(msg.message_type, asset, auth.companyId)) {
        inboundToSign.set(asset.id, asset.s3_key);
        continue;
      }
      if (shouldSignAwsOutboundAudio(msg, asset, auth.companyId)) {
        outboundToSign.set(asset.id, asset.s3_key);
      }
    }

    for (const [assetId, objectKey] of inboundToSign) {
      try {
        const signed = await signMetaInboundAudioGetUrl({
          svc,
          companyId: auth.companyId,
          objectKey,
        });
        if (typeof signed?.url === 'string' && signed.url.length > 0) {
          signedUrlByAssetId.set(assetId, signed.url);
        }
      } catch {
        console.error('[meta/messages] aws_audio_sign_failed');
      }
    }

    for (const [assetId, objectKey] of outboundToSign) {
      try {
        const signed = await signMetaOutboundAudioGetUrl({
          svc,
          companyId: auth.companyId,
          objectKey,
        });
        if (typeof signed?.url === 'string' && signed.url.length > 0) {
          signedUrlByAssetId.set(assetId, signed.url);
        }
      } catch {
        console.error('[meta/messages] aws_audio_sign_failed');
      }
    }
  }

  // ── 8. Delivery status — batched, tenant-safe ─────────────────────────────
  // Somente outbound com wamid. Uma query para o lote; nunca N+1.
  // Filtros: auth.companyId + instance_id da conversa validada + wamids do lote.
  // Falha de consulta → 500 (não inventar status nem tratar erro como ausência).
  // Wamid ausente no tracking → delivery_status null (mensagem ainda visível).
  const outboundWamids = [...new Set(
    rawMessages.flatMap((m) => (
      m.direction === 'outbound' && typeof m.meta_message_id === 'string' && m.meta_message_id.length > 0
        ? [m.meta_message_id]
        : []
    ))
  )];

  const statusByWamid = new Map();
  if (outboundWamids.length > 0) {
    const { data: trackingRows, error: trackingErr } = await svc
      .from('meta_whatsapp_messages')
      .select('meta_message_id, status')
      .eq('company_id', auth.companyId)
      .eq('instance_id', conversation.instance_id)
      .in('meta_message_id', outboundWamids);

    if (trackingErr) {
      console.error('[meta/messages] tracking_lookup_failed db_error=true');
      return res.status(500).json({ error: 'internal_error' });
    }

    for (const row of (trackingRows ?? [])) {
      if (
        typeof row?.meta_message_id === 'string'
        && ALLOWED_DELIVERY_STATUS.has(row.status)
      ) {
        statusByWamid.set(row.meta_message_id, row.status);
      }
    }
  }

  // Enriquecer DTO: media + delivery_status; remover campos internos.
  const messages = rawMessages.map(({ media_asset_id, template_buttons, meta_message_id, ...msg }) => {
    let media = null;
    if (media_asset_id) {
      const asset = assetMap.get(media_asset_id);
      if (asset && isCompatibleMediaType(msg.message_type, asset.file_type)) {
        let url = hasPublicPreviewUrl(asset.preview_url) ? asset.preview_url : null;
        if (signedUrlByAssetId.has(asset.id)) {
          url = signedUrlByAssetId.get(asset.id);
        }
        media = {
          type:      asset.file_type,
          url,
          filename:  asset.original_filename  ?? null,
          mime_type: asset.mime_type          ?? null,
          file_size: asset.file_size          ?? null,
        };
      }
    }

    const deliveryStatus = msg.direction === 'outbound'
      ? (statusByWamid.get(meta_message_id) ?? null)
      : null;

    return {
      ...msg,
      media,
      template_buttons: sanitizeTemplateButtonsSnapshot(template_buttons),
      delivery_status:  deliveryStatus,
    };
  });

  return res.status(200).json({ messages });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou detalhes de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
