// =============================================================================
// byoTokenCrypto — AES-256-GCM da integração Instagram BYO
//
// Formato: byo1:<base64(IV[12] || authTag[16] || ciphertext)>
// AAD: company_id + "|" + campo (app_secret ou suat)
//
// Chave exclusiva: INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 (64 hex / 32 bytes).
// Não lê INSTAGRAM_TOKEN_ENC_KEY_V1 nem META_TOKEN_ENC_KEY_V1.
// Não registra plaintext, ciphertext, IV, tag ou chave.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'byo1:';
const FIELDS = new Set(['app_secret', 'suat']);
const HEX_64_RE = /^[0-9a-f]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64_STRICT_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const KEY_ERROR = '[byoTokenCrypto] Chave indisponível';
const INPUT_ERROR = '[byoTokenCrypto] Valor inválido para criptografia';
const DECRYPT_ERROR = '[byoTokenCrypto] Falha na descriptografia';

function getKey() {
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

function assertContext(companyId, field) {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    throw new Error(INPUT_ERROR);
  }
  if (!FIELDS.has(field)) {
    throw new Error(INPUT_ERROR);
  }
}

function additionalData(companyId, field) {
  return Buffer.from(`${companyId}|${field}`, 'utf8');
}

function decodeStrictBase64(payload) {
  if (!BASE64_STRICT_RE.test(payload)) {
    throw new Error(DECRYPT_ERROR);
  }
  const decoded = Buffer.from(payload, 'base64');
  if (decoded.toString('base64') !== payload) {
    throw new Error(DECRYPT_ERROR);
  }
  return decoded;
}

/**
 * @param {string} plaintext
 * @param {{ companyId: string, field: 'app_secret' | 'suat' }} context
 * @returns {string}
 */
export function encryptByoSecret(plaintext, context) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error(INPUT_ERROR);
  }
  assertContext(context?.companyId, context?.field);

  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData(context.companyId, context.field));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return `${PREFIX}${combined.toString('base64')}`;
}

/**
 * @param {string} encrypted
 * @param {{ companyId: string, field: 'app_secret' | 'suat' }} context
 * @returns {string}
 */
export function decryptByoSecret(encrypted, context) {
  if (typeof encrypted !== 'string' || !encrypted.startsWith(PREFIX)) {
    throw new Error(DECRYPT_ERROR);
  }
  assertContext(context?.companyId, context?.field);

  const key = getKey();
  const combined = decodeStrictBase64(encrypted.slice(PREFIX.length));
  if (combined.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error(DECRYPT_ERROR);
  }

  const iv = combined.subarray(0, IV_BYTES);
  const authTag = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(additionalData(context.companyId, context.field));
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(DECRYPT_ERROR);
  }
}
