// =============================================================================
// byoCredentialFingerprint — quadro byo-fp-v1
//
// O fingerprint não usa ciphertext e não usa a chave AES como chave HMAC.
// Operações secretas derivam uma subchave com HKDF-SHA256 e aplicam HMAC.
// revoke usa SHA-256 do quadro e não lê a chave.
//
// Quadro binário, concatenado, sem separador extra. Cada parte é:
//   <comprimento decimal dos bytes UTF-8>:<bytes UTF-8>
// O comprimento não tem zero à esquerda, salvo o valor zero, que não ocorre.
//
// Ordem:
//   1. byo-fp-v1
//   2. operation
//   3. campos da operação
//
// set e replace_app:
//   company_id, request_id, expected_version, meta_app_id, app_secret, suat
// rotate_secret:
//   company_id, request_id, expected_version, app_secret
// rotate_suat:
//   company_id, request_id, expected_version, suat
// revoke:
//   company_id, request_id, expected_version
//
// UUIDs entram em minúsculas. A versão inteira entra em decimal, sem zero
// à esquerda. No set, versão ausente ou null entra como os quatro bytes
// UTF-8 da palavra null. Segredos não sofrem trim nem normalização Unicode.
//
// Salt HKDF: lovoo-instagram-byo-fingerprint-v1
// Info HKDF: h1|<operation>
// IKM: 32 bytes de INSTAGRAM_BYO_TOKEN_ENC_KEY_V1
// Saída secreta: h1:<hmac-sha256 em hex minúsculo>
// Saída revoke:  s1:<sha256 em hex minúsculo>
// =============================================================================

import { createHash, createHmac, hkdfSync } from 'crypto';

const FORMAT = 'byo-fp-v1';
const SALT = 'lovoo-instagram-byo-fingerprint-v1';
const MAX_SECRET_BYTES = 4096;
const MAX_VERSION = 2147483647;
const SECRET_OPERATIONS = new Set(['set', 'replace_app', 'rotate_secret', 'rotate_suat']);
const OPERATIONS = new Set([...SECRET_OPERATIONS, 'revoke']);
const KEYS = new Set([
  'operation',
  'companyId',
  'requestId',
  'expectedVersion',
  'metaAppId',
  'appSecret',
  'suat',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_ID_RE = /^[0-9]{5,32}$/;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

const KEY_ERROR = '[byoCredentialFingerprint] Chave indisponível';
const INPUT_ERROR = '[byoCredentialFingerprint] Valor inválido';

function reject() {
  throw new Error(INPUT_ERROR);
}

function assertWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = value.charCodeAt(index + 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }
    reject();
  }
}

function canonicalUuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) reject();
  return value.toLowerCase();
}

function encodeVersion(operation, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) {
    if (operation !== 'set') reject();
    return 'null';
  }
  if (
    typeof expectedVersion !== 'number'
    || !Number.isInteger(expectedVersion)
    || expectedVersion < 1
    || expectedVersion > MAX_VERSION
  ) {
    reject();
  }
  return String(expectedVersion);
}

function requireSecret(value) {
  if (typeof value !== 'string') reject();
  assertWellFormed(value);
  if (value.includes('\u0000')) reject();
  const size = Buffer.byteLength(value, 'utf8');
  if (size < 1 || size > MAX_SECRET_BYTES) reject();
  return value;
}

function requireAppId(value) {
  if (typeof value !== 'string' || !APP_ID_RE.test(value)) reject();
  return value;
}

function forbid(value) {
  if (value !== undefined) reject();
}

function encodePart(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`${bytes.length}:`, 'ascii'), bytes]);
}

function buildFrame(operation, fields) {
  return Buffer.concat([
    encodePart(FORMAT),
    encodePart(operation),
    ...fields.map(encodePart),
  ]);
}

function readKey() {
  const keyHex = process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
  if (!keyHex || !HEX_64_RE.test(keyHex)) {
    throw new Error(KEY_ERROR);
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(KEY_ERROR);
  }
  return key;
}

function fingerprintSecret(operation, frame) {
  const subkey = Buffer.from(hkdfSync(
    'sha256',
    readKey(),
    Buffer.from(SALT, 'utf8'),
    Buffer.from(`h1|${operation}`, 'utf8'),
    32,
  ));
  const mac = createHmac('sha256', subkey).update(frame).digest('hex');
  return `h1:${mac}`;
}

function fingerprintRevoke(frame) {
  return `s1:${createHash('sha256').update(frame).digest('hex')}`;
}

function fieldsFor(input) {
  const operation = input.operation;
  const companyId = canonicalUuid(input.companyId);
  const requestId = canonicalUuid(input.requestId);
  const expectedVersion = encodeVersion(operation, input.expectedVersion);

  if (operation === 'set' || operation === 'replace_app') {
    return [
      companyId,
      requestId,
      expectedVersion,
      requireAppId(input.metaAppId),
      requireSecret(input.appSecret),
      requireSecret(input.suat),
    ];
  }
  if (operation === 'rotate_secret') {
    forbid(input.metaAppId);
    forbid(input.suat);
    return [companyId, requestId, expectedVersion, requireSecret(input.appSecret)];
  }
  if (operation === 'rotate_suat') {
    forbid(input.metaAppId);
    forbid(input.appSecret);
    return [companyId, requestId, expectedVersion, requireSecret(input.suat)];
  }
  forbid(input.metaAppId);
  forbid(input.appSecret);
  forbid(input.suat);
  return [companyId, requestId, expectedVersion];
}

/**
 * @param {{
 *   operation: 'set' | 'replace_app' | 'rotate_secret' | 'rotate_suat' | 'revoke',
 *   companyId: string,
 *   requestId: string,
 *   expectedVersion?: number | null,
 *   metaAppId?: string,
 *   appSecret?: string,
 *   suat?: string,
 * }} input
 * @returns {string}
 */
export function fingerprintByoCredentialRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) reject();
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) reject();
  }
  if (!OPERATIONS.has(input.operation)) reject();

  const frame = buildFrame(input.operation, fieldsFor(input));
  if (SECRET_OPERATIONS.has(input.operation)) {
    return fingerprintSecret(input.operation, frame);
  }
  return fingerprintRevoke(frame);
}
