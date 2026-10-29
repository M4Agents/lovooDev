// =============================================================================
// byoCredentialPayload — contrato do body das credenciais BYO
//
// Função pura. Não lê ambiente, não cifra e não acessa banco.
// A saída usa os nomes do helper de fingerprint:
//   companyId, requestId, expectedVersion, metaAppId, appSecret, suat, operation
//
// O futuro handler mede o body bruto, com teto de 18 KiB.
// Content-Length, quando existir, é só um aviso. Este módulo não reconstrói
// o tamanho com JSON.stringify. Os limites por campo valem mesmo sem o header.
// =============================================================================

const REJECTED = Object.freeze({ ok: false, error: 'rejected' });
const MAX_SECRET_BYTES = 4096;
const MAX_VERSION = 2147483647;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_ID_RE = /^[0-9]{5,32}$/;
const CREDENTIAL_OPERATIONS = new Set(['set', 'replace_app', 'rotate_secret', 'rotate_suat']);
const CREDENTIAL_KEYS = new Set([
  'company_id',
  'request_id',
  'operation',
  'expected_version',
  'meta_app_id',
  'app_secret',
  'suat',
]);
const REVOKE_KEYS = new Set(['company_id', 'request_id', 'expected_version']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = value.charCodeAt(index + 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return null;
  return value.toLowerCase();
}

function version(value, optional) {
  if (value === undefined || value === null) return optional ? null : undefined;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 1
    || value > MAX_VERSION
  ) {
    return undefined;
  }
  return value;
}

function secret(value) {
  if (typeof value !== 'string' || !isWellFormed(value) || value.includes('\u0000')) return null;
  const size = Buffer.byteLength(value, 'utf8');
  if (size < 1 || size > MAX_SECRET_BYTES) return null;
  return value;
}

function appId(value) {
  if (typeof value !== 'string' || !APP_ID_RE.test(value)) return null;
  return value;
}

function knownKeys(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function absent(body, key) {
  return !Object.hasOwn(body, key);
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: 'rejected' }}
 */
export function validateByoCredentialBody(body) {
  if (!isPlainObject(body) || !knownKeys(body, CREDENTIAL_KEYS)) return REJECTED;
  if (!CREDENTIAL_OPERATIONS.has(body.operation)) return REJECTED;

  const companyId = uuid(body.company_id);
  const requestId = uuid(body.request_id);
  if (!companyId || !requestId) return REJECTED;

  const optionalVersion = body.operation === 'set';
  if (!optionalVersion && absent(body, 'expected_version')) return REJECTED;
  const expectedVersion = version(body.expected_version, optionalVersion);
  if (expectedVersion === undefined) return REJECTED;

  const value = { operation: body.operation, companyId, requestId, expectedVersion };

  if (body.operation === 'set' || body.operation === 'replace_app') {
    const metaAppId = appId(body.meta_app_id);
    const appSecret = secret(body.app_secret);
    const suat = secret(body.suat);
    if (!metaAppId || !appSecret || !suat) return REJECTED;
    return { ok: true, value: { ...value, metaAppId, appSecret, suat } };
  }

  if (body.operation === 'rotate_secret') {
    if (!absent(body, 'meta_app_id') || !absent(body, 'suat')) return REJECTED;
    const appSecret = secret(body.app_secret);
    if (!appSecret) return REJECTED;
    return { ok: true, value: { ...value, appSecret } };
  }

  if (!absent(body, 'meta_app_id') || !absent(body, 'app_secret')) return REJECTED;
  const suat = secret(body.suat);
  if (!suat) return REJECTED;
  return { ok: true, value: { ...value, suat } };
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: { operation: 'revoke', companyId: string, requestId: string, expectedVersion: number } } | { ok: false, error: 'rejected' }}
 */
export function validateByoRevokeBody(body) {
  if (!isPlainObject(body) || !knownKeys(body, REVOKE_KEYS)) return REJECTED;
  if (!absent(body, 'operation')) return REJECTED;
  const companyId = uuid(body.company_id);
  const requestId = uuid(body.request_id);
  if (!companyId || !requestId || absent(body, 'expected_version')) return REJECTED;
  const expectedVersion = version(body.expected_version, false);
  if (expectedVersion === undefined) return REJECTED;
  return { ok: true, value: { operation: 'revoke', companyId, requestId, expectedVersion } };
}
