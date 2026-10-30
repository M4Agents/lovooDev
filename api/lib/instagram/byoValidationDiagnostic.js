// Observabilidade da falha token_invalid. Só entram campos já normalizados.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGES = new Set(['debug_token', 'user_id_validation', 'assigned_pages']);
const REASONS = new Set(['is_valid_false', 'user_id_invalid', 'meta_oauth_error']);

export function metaNumber(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 999999) return null;
  return value;
}

export function metaErrorNumbers(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return { meta_error_code: null, meta_error_subcode: null };
  }
  return {
    meta_error_code: metaNumber(error.code),
    meta_error_subcode: metaNumber(error.error_subcode ?? error.subcode),
  };
}

function uuidOrNull(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

export function recordByoTokenInvalid({ requestId, companyId, diagnostic }) {
  const stage = diagnostic?.stage;
  const reason = diagnostic?.reason;
  if (!STAGES.has(stage) || !REASONS.has(reason)) return;
  const entry = {
    event: 'instagram_byo_validation_failure',
    request_id: uuidOrNull(requestId),
    company_id: uuidOrNull(companyId),
    stage,
    reason,
    meta_error_code: metaNumber(diagnostic.meta_error_code),
    meta_error_subcode: metaNumber(diagnostic.meta_error_subcode),
    public_code: 'token_invalid',
  };
  console.info(JSON.stringify(entry));
}
