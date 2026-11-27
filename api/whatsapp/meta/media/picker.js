// =============================================================================
// GET /api/whatsapp/meta/media/picker?company_id=<uuid>&media_type=IMAGE|VIDEO|DOCUMENT
//
// Retorna lista unificada de assets elegíveis para HEADER de template Meta:
//   - company_media_library (CML) — assets já na biblioteca da empresa
//   - lead_media_unified   (LMU) — assets recebidos de leads via WhatsApp
//
// FLUXO:
//   1. Method guard (GET only)
//   2. Auth + RBAC + feature flag via validateMetaCaller (META_SEND_ROLES)
//   3. Validação de media_type (IMAGE | VIDEO | DOCUMENT)
//   4. Visibilidade da conversa. Seller restrito separa biblioteca e mídia Meta
//      antes do limite, e só então recebe preview_url
//   5. Fetch CML bounded (100 rows) — filtra em DB por file_type
//   6. Fetch LMU bounded (100 rows) — filtra em DB por file_type
//   7. Filtro em memória:
//      - MIME whitelist compartilhada com mediaConstants.js
//      - file_size <= limite por media_type
//      - s3_key com prefixo correto (LMU apenas — defense-in-depth)
//   8. Dedupe: LMU com source_ref importado em CML é ocultado
//   9. Merge + sort por data desc
//  10. Bounded 100 items finais; truncated=true se exceder
//  11. Retorna items sem s3_key, source_ref ou internals
//
// SEGURANÇA:
//   - auth.companyId é o tenant authority (nunca query.company_id diretamente)
//   - s3_key lido SOMENTE no backend para validação de prefixo — nunca retornado
//   - source_ref lido SOMENTE no backend para dedupe — nunca retornado
//   - MIME e tamanho validados em memória server-side
// =============================================================================

import { getSupabaseAdmin }              from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_SEND_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { resolveMetaConversationVisibility } from '../../../lib/meta-whatsapp/metaConversationAccess.js';
import {
  COMMERCIAL_SOURCE_OR,
  META_CONVERSATION_SOURCE_OR,
  filterAssignedCompanyMedia,
} from '../../../lib/meta-whatsapp/metaMediaAccess.js';
import {
  MEDIA_SIZE_LIMITS,
  MIME_TO_MEDIA_TYPE,
} from '../../../lib/meta-whatsapp/mediaConstants.js';

// =============================================================================
// Constantes locais
// =============================================================================

const VALID_MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

// Mapeamento media_type (uppercase) → file_type DB (lowercase)
const MEDIA_TYPE_TO_FILE_TYPE = {
  IMAGE:    'image',
  VIDEO:    'video',
  DOCUMENT: 'document',
};

// Quantidade máxima de rows buscadas por tabela e de items no resultado final
const FETCH_LIMIT  = 100;
const OUTPUT_LIMIT = 100;
const CML_FIELDS = 'id, company_id, original_filename, file_type, mime_type, file_size, preview_url, created_at, source_ref, s3_key';

function visibilityFailure(scope) {
  if (scope.status === 503) return { status: 503, error: 'internal_error' };
  return { status: scope.status, error: scope.error };
}

function cmlQuery(svc, companyId, fileType) {
  return svc
    .from('company_media_library')
    .select(CML_FIELDS)
    .eq('company_id', companyId)
    .eq('file_type', fileType);
}

async function loadCompanyMedia(svc, auth, fileType, scope) {
  if (scope.visibility !== 'assigned') {
    return cmlQuery(svc, auth.companyId, fileType)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);
  }

  const commercial = await cmlQuery(svc, auth.companyId, fileType)
    .or(COMMERCIAL_SOURCE_OR)
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT);
  if (commercial.error) return commercial;

  const meta = await cmlQuery(svc, auth.companyId, fileType)
    .or(META_CONVERSATION_SOURCE_OR)
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT);
  if (meta.error) return meta;

  const visible = await filterAssignedCompanyMedia(svc, scope, [
    ...(commercial.data ?? []),
    ...(meta.data ?? []),
  ]);
  if (!visible.ok) return { data: null, error: visible };
  const seen = new Set();
  const rows = [];
  for (const row of visible.rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return { data: rows, error: null };
}

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  // ── 1. Method guard ─────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // ── 2. Supabase admin (service_role) ─────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    const { company_id: queryCompanyId, media_type: mediaTypeRaw } = req.query ?? {};

    // ── 3. Auth + RBAC + feature flag ───────────────────────────────────────────
    const auth = await validateMetaCaller(req, svc, queryCompanyId, {
      roles: META_SEND_ROLES,
    });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    // ── 4. Validar media_type ────────────────────────────────────────────────────
    const mediaType = String(mediaTypeRaw ?? '').toUpperCase();
    if (!VALID_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: 'invalid_media_type' });
    }

    const fileType  = MEDIA_TYPE_TO_FILE_TYPE[mediaType];
    const sizeLimit = MEDIA_SIZE_LIMITS[mediaType];

    const scope = await resolveMetaConversationVisibility(svc, auth);
    if (!scope.ok) {
      const failure = visibilityFailure(scope);
      return res.status(failure.status).json({ error: failure.error });
    }

    // MIMEs válidos para este media_type
    const validMimes = new Set(
      [...MIME_TO_MEDIA_TYPE.entries()]
        .filter(([, mt]) => mt === mediaType)
        .map(([mime]) => mime),
    );

    // ── 5. Fetch CML (bounded) ────────────────────────────────────────────────────
    // Seller restrito: biblioteca comercial e mídia de conversa em consultas
    // separadas, cada uma limitada antes do merge. source_ref e s3_key não saem.
    const { data: cmlRows, error: cmlErr } = await loadCompanyMedia(
      svc,
      auth,
      fileType,
      scope,
    );

    if (cmlErr) {
      if (typeof cmlErr.status === 'number') {
        const error = cmlErr.status === 403 ? 'Acesso negado' : 'internal_error';
        return res.status(cmlErr.status).json({ error });
      }
      console.error('[meta/media/picker] cml-query-error', { message: cmlErr.message });
      return res.status(500).json({ error: 'internal_error' });
    }

    // ── 6. Fetch LMU (bounded) ─────────────────────────────────────────────────
    // SELECT inclui s3_key para validação de prefixo — nunca retornado ao frontend
    const { data: lmuRows, error: lmuErr } = await svc
      .from('lead_media_unified')
      .select('id, original_filename, file_type, mime_type, file_size, preview_url, received_at, s3_key')
      .eq('company_id', auth.companyId)
      .eq('file_type', fileType)
      .order('received_at', { ascending: false })
      .limit(FETCH_LIMIT);

    if (lmuErr) {
      console.error('[meta/media/picker] lmu-query-error', { message: lmuErr.message });
      return res.status(500).json({ error: 'internal_error' });
    }

    // ── 7. Construir Set de LMU IDs já importados (via source_ref em CML) ─────────
    const importedLmuIds = new Set(
      (cmlRows ?? [])
        .map(r => r.source_ref)
        .filter(ref => typeof ref === 'string' && ref.startsWith('lmu:'))
        .map(ref => ref.slice(4)),
    );

    // ── 8. Mapear CML items ───────────────────────────────────────────────────────
    // Filtro em memória: MIME whitelist + tamanho
    // source_ref NÃO é incluído na resposta — usado somente para dedupe
    const cmlItems = (cmlRows ?? [])
      .filter(r =>
        validMimes.has(r.mime_type) &&
        typeof r.file_size === 'number' &&
        r.file_size <= sizeLimit,
      )
      .map(r => ({
        picker_id:   `cml:${r.id}`,
        source:      'company_media_library',
        filename:    r.original_filename,
        media_type:  mediaType,
        mime_type:   r.mime_type,
        file_size:   r.file_size,
        preview_url: r.preview_url ?? null,
        _date:       r.created_at,
      }));

    // ── 9. Mapear LMU items (filtro + dedupe) ─────────────────────────────────────
    // s3_key NÃO é incluído na resposta — usado somente para validação de prefixo
    const allowedLmuPrefix = `clientes/${auth.companyId}/`;

    const lmuItems = (lmuRows ?? [])
      .filter(r =>
        !importedLmuIds.has(r.id) &&
        validMimes.has(r.mime_type) &&
        typeof r.file_size === 'number' &&
        r.file_size <= sizeLimit &&
        typeof r.s3_key === 'string' &&
        r.s3_key.startsWith(allowedLmuPrefix),
      )
      .map(r => ({
        picker_id:   `lmu:${r.id}`,
        source:      'lead_media_unified',
        filename:    r.original_filename,
        media_type:  mediaType,
        mime_type:   r.mime_type,
        file_size:   r.file_size,
        preview_url: r.preview_url ?? null,
        _date:       r.received_at,
      }));

    // ── 10. Merge + sort por data desc ─────────────────────────────────────────────
    const allItems = [...cmlItems, ...lmuItems].sort(
      (a, b) =>
        new Date(b._date ?? 0).getTime() -
        new Date(a._date ?? 0).getTime(),
    );

    // ── 11. Bounded output: máx OUTPUT_LIMIT ──────────────────────────────────────
    const truncated   = allItems.length > OUTPUT_LIMIT;
    // Remover _date antes de retornar (campo interno de sort)
    const finalItems  = allItems.slice(0, OUTPUT_LIMIT).map(({ _date, ...rest }) => rest);

    return res.status(200).json({
      items:     finalItems,
      truncated,
    });

  } catch (err) {
    console.error('[meta/media/picker] unexpected-error', { message: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}
