// =============================================================================
// tokenCrypto — AES-256-GCM para tokens Instagram
//
// Formato salvo: v1:<base64(IV[12] + authTag[16] + ciphertext)>
//
// Env var obrigatória:
//   INSTAGRAM_TOKEN_ENC_KEY_V1 = 64 chars hex (32 bytes)
//   Gerar com: openssl rand -hex 32
//
// Arquitetura para rotação de chave futura:
//   - Prefixo "v1:" identifica a versão de criptografia.
//   - Para v2: adicionar getKeyV2() e case 'v2' no decrypt.
//   - Nunca logar token, plaintext ou chave.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_BYTES  = 12;
const TAG_BYTES = 16;

function getKeyV1() {
  const keyHex = process.env.INSTAGRAM_TOKEN_ENC_KEY_V1;
  if (!keyHex) {
    throw new Error('[tokenCrypto] INSTAGRAM_TOKEN_ENC_KEY_V1 não configurada');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('[tokenCrypto] Chave deve ter 64 chars hex (32 bytes / 256 bits)');
  }
  return key;
}

/**
 * Criptografa um token Instagram com AES-256-GCM.
 * @param {string} token Plaintext token (nunca logar este valor)
 * @returns {string} Formato: "v1:<base64(IV + authTag + ciphertext)>"
 */
export function encryptInstagramToken(token) {
  const key = getKeyV1();
  const iv  = randomBytes(IV_BYTES);

  const cipher     = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag(); // 16 bytes by default

  // Layout: IV(12) ++ authTag(16) ++ ciphertext(n)
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return `v1:${combined.toString('base64')}`;
}

/**
 * Descriptografa um token Instagram criptografado.
 * @param {string} encrypted Valor salvo no banco (formato "v1:...")
 * @returns {string} Plaintext token (nunca expor ao frontend)
 * @throws {Error} Em caso de falha (mensagem genérica — nunca vaza razão real)
 */
export function decryptInstagramToken(encrypted) {
  if (typeof encrypted !== 'string') {
    throw new Error('[tokenCrypto] Valor inválido para descriptografia');
  }

  const colonIdx = encrypted.indexOf(':');
  if (colonIdx < 0) {
    throw new Error('[tokenCrypto] Formato de token desconhecido');
  }

  const version = encrypted.slice(1, colonIdx); // "1"

  if (version === '1') {
    const key = getKeyV1();
    let combined;
    try {
      combined = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');
    } catch {
      throw new Error('[tokenCrypto] Falha na descriptografia do token');
    }

    if (combined.length < IV_BYTES + TAG_BYTES + 1) {
      throw new Error('[tokenCrypto] Falha na descriptografia do token');
    }

    const iv         = combined.subarray(0, IV_BYTES);
    const authTag    = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Nunca vazar razão real (previne oracle attacks)
      throw new Error('[tokenCrypto] Falha na descriptografia do token');
    }
  }

  throw new Error(`[tokenCrypto] Versão de criptografia desconhecida: ${version}`);
}
