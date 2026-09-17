// =============================================================================
// POST /api/whatsapp/meta/onboarding/resolve-waba
//
// Responsabilidade: completar a conexão Meta WhatsApp quando o /complete
// retornou { status: 'selection_required' } com múltiplas WABAs/phones.
//
// O usuário escolhe explicitamente um número via selected_index.
// O backend valida o continuation token AEAD, revalida RBAC + feature flag
// e persiste a instância usando o RPC atômico existente.
//
// Fluxo (ordem obrigatória):
//   A. Method guard (POST only)
//   B. Bearer token extraction
//   C. Supabase admin client
//   D. JWT auth → user autenticado (ANTES de confiar no continuation token)
//   E. Body validation + rejeição de campos proibidos
//   F. decryptSelectionPayload → valida AEAD + schema + expiração
//   G. uid binding: payload.uid === user.id
//   H. RBAC revalidation via validateMetaCaller (membership + role + feature flag)
//   I. Bounds check: selected_index em [0, opts.length)
//   J. Extrair selected = payload.opts[selected_index]
//   K. Persistência atômica via rpc_create_meta_whatsapp_connection
//   L. Resposta sanitizada (mesmo shape de /complete)
//
// Segurança:
//   - JWT validado ANTES de decryptSelectionPayload
//   - company_id derivado do token AEAD (payload.cid) — nunca do body
//   - user_id derivado do JWT — nunca do body
//   - waba_id e phone_number_id vêm do token AEAD — nunca do body
//   - access token ciphertext vem do token AEAD — nunca em plaintext
//   - validateMetaCaller revalida membership, role, partner e feature flag
//   - Qualquer token adulterado, expirado ou com schema inválido → 400
//   - 23505 (duplicate) → 409 sem expor owner
//
// Limitação de MVP (stateless):
//   O continuation token não é single-use verdadeiro. Um mesmo token pode ser
//   usado com indexes diferentes dentro do TTL de 10 minutos (replay com index
//   diferente pode criar múltiplas instâncias se phone_number_ids forem distintos).
//   Replay com mesmo index resulta em 409 (unique constraint DB).
//   Esta é uma limitação de produto conhecida e documentada do MVP.
//   Single-use verdadeiro exigiria migration para tabela de nonce server-side.
// =============================================================================

import { getSupabaseAdmin }                         from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES }   from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptSelectionPayload }                  from '../../../lib/meta-whatsapp/selectionTokenCrypto.js';

// Campos que NÃO devem estar presentes no body — qualquer um rejeita com 400.
// Previne que o cliente tente controlar tenant, identidade ou credenciais.
const _FORBIDDEN_BODY_FIELDS = new Set([
  'company_id',
  'user_id',
  'waba_id',
  'phone_number_id',
  'access_token',
]);

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Extrai Bearer token do header Authorization.
 * @private
 */
function extractBearerToken(req) {
  const authHeader = req.headers?.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return token.length > 0 ? token : null;
}

/**
 * Extrai a versão numérica de um ciphertext versionado "v<N>:<base64>".
 * Retorna null se o formato for inválido.
 * @private
 * @param {string} enc
 * @returns {number|null}
 */
function parseEncVersion(enc) {
  if (typeof enc !== 'string') return null;
  const colonIdx = enc.indexOf(':');
  if (colonIdx < 2 || enc[0] !== 'v') return null;
  const vStr = enc.slice(1, colonIdx);
  const vNum = Number(vStr);
  if (!Number.isInteger(vNum) || vNum < 1) return null;
  return vNum;
}

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  // ── A. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── B. Bearer token ────────────────────────────────────────────────────────
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── C. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Catch defensivo externo — throws inesperados
  try {

  // ── D. JWT auth — ANTES de confiar em qualquer campo do body/token ─────────
  const { data: { user }, error: authErr } = await svc.auth.getUser(bearerToken);
  if (authErr || !user) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── E. Body validation ─────────────────────────────────────────────────────
  const body = req.body ?? {};

  // Rejeitar campos proibidos — previne submissão de identidade/tenant/token pelo cliente.
  for (const field of _FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
  }

  const { continuation_token, selected_index } = body;

  // continuation_token: string não vazia
  if (typeof continuation_token !== 'string' || continuation_token.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // selected_index: integer >= 0
  // Rejeitar: string, float, negative, NaN, undefined
  if (
    typeof selected_index !== 'number' ||
    !Number.isInteger(selected_index) ||
    selected_index < 0
  ) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // ── F. Descriptografar + validar continuation token ───────────────────────
  // decryptSelectionPayload lança em qualquer falha — adulteração, expiração,
  // schema inválido, versão inválida, chave ausente.
  // Todos os casos → 400 invalid_continuation sem detalhes internos.
  let payload;
  try {
    payload = decryptSelectionPayload(continuation_token);
  } catch {
    return res.status(400).json({ error: 'invalid_continuation' });
  }

  // ── G. uid binding ─────────────────────────────────────────────────────────
  // O token é bound ao usuário que iniciou o /complete.
  // Outro usuário com JWT válido não pode usar o token — previne CSRF cross-user.
  if (payload.uid !== user.id) {
    return res.status(400).json({ error: 'invalid_continuation' });
  }

  // ── H. RBAC revalidation ───────────────────────────────────────────────────
  // Revalida membership, role, partner assignment e feature flag para payload.cid.
  // Garante que role removida ou flag desabilitada entre os dois steps → 403.
  // company_id vem exclusivamente do token AEAD — não do body.
  const auth = await validateMetaCaller(req, svc, payload.cid, { roles: META_CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── I. Bounds check ────────────────────────────────────────────────────────
  if (selected_index >= payload.opts.length) {
    return res.status(400).json({ error: 'invalid_selection' });
  }

  // ── J. Opção selecionada ───────────────────────────────────────────────────
  // Todos os campos (w, p, d, n) foram validados por decryptSelectionPayload.
  const selected = payload.opts[selected_index];

  // ── K. Versão de criptografia do access token ──────────────────────────────
  // Derivada do prefixo do ciphertext (ex: "v1:..." → 1).
  // Nunca hardcoded — suporta rotação de chave futura.
  const encVersion = parseEncVersion(payload.enc);
  if (encVersion === null) {
    // enc malformado — não deveria ocorrer se decryptSelectionPayload passou,
    // mas validação defensiva explícita.
    return res.status(400).json({ error: 'invalid_continuation' });
  }

  // ── L. Persistência atômica via RPC ──────────────────────────────────────
  // Mesmo RPC de /complete — INSERT atômico em instances + credentials.
  // company_id = payload.cid (do token AEAD — não do body).
  // connected_by = user.id (do JWT — não do body).
  // access_token_enc = payload.enc (ciphertext original — nunca em plaintext).
  const { data: rpcRows, error: rpcErr } = await svc.rpc(
    'rpc_create_meta_whatsapp_connection',
    {
      p_company_id:         payload.cid,
      p_connected_by:       user.id,
      p_waba_id:            selected.w,
      p_phone_number_id:    selected.p,
      p_phone_number:       selected.d,
      p_verified_name:      selected.n,
      p_display_name:       null,
      p_access_token_enc:   payload.enc,
      p_encryption_version: encVersion,
    },
  );

  if (rpcErr) {
    // 23505 — phone_number_id já conectado (ativo).
    // Mesmo comportamento de /complete: sem oracle cross-tenant.
    if (rpcErr.code === '23505') {
      return res.status(409).json({ error: 'phone_number_already_connected' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }

  const instance = Array.isArray(rpcRows) ? rpcRows[0] : null;
  if (!instance) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── M. Resposta sanitizada ─────────────────────────────────────────────────
  // Shape idêntico ao de /complete — 6 campos públicos.
  // Campos NUNCA retornados: ciphertext, company_id, user_id, enc, waba/phone IDs internos.
  return res.status(200).json({
    instance: {
      id:              instance.instance_id,
      phone_number_id: instance.phone_number_id,
      waba_id:         instance.waba_id,
      phone_number:    instance.phone_number,
      verified_name:   instance.verified_name ?? null,
      status:          instance.status,
    },
  });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos pelos catches específicos.
    return res.status(500).json({ error: 'internal_error' });
  }
}
