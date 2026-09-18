// =============================================================================
// pinCrypto — AES-256-GCM para PIN de registration Meta WhatsApp Cloud API
//
// Responsabilidade: cifrar/decifrar o PIN de 6 dígitos usado em
// POST /{phone_number_id}/register.
//
// Formato persistido: v1:<base64(IV[12] || authTag[16] || ciphertext[n])>
//
// Compatível com:
//   meta_whatsapp_credentials.registration_pin_enc
//
// Env var:
//   META_TOKEN_ENC_KEY_V1 = exatamente 64 chars hex (32 bytes / 256 bits)
//   Mesma chave de tokenCrypto.js nesta fase (MVP).
//   Rotação independente pode ser introduzida via prefixo v2: sem quebrar pins v1.
//
// Geração segura:
//   generateMetaRegistrationPin() usa crypto.randomInt — CSPRNG.
//   Resultado: string com exatamente 6 dígitos, incluindo leading zeros.
//   000000 é uma saída válida do espaço [0, 999999].
//
// SEGURANÇA:
//   - Fail closed: ENV ausente/inválida ou PIN fora de /^[0-9]{6}$/ causam THROW.
//   - PIN nunca logado, nunca retornado ao caller externo.
//   - API semanticamente separada de tokenCrypto.js (PIN não é token).
//   - encryptMetaToken/decryptMetaToken NÃO são chamados neste módulo.
//   - Erros de descriptografia são genéricos (previne oracle attacks).
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'crypto';

const IV_BYTES  = 12;
const TAG_BYTES = 16;

// Valida exatamente 64 chars hexadecimais (case-insensitive).
const HEX_64_RE = /^[0-9a-f]{64}$/i;

// Valida PIN de registration: exatamente 6 dígitos decimais.
const PIN_RE = /^[0-9]{6}$/;

// Base64 canônico estrito (RFC 4648 §4) — mesma regex de tokenCrypto.js.
const BASE64_STRICT_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// =============================================================================
// Carregamento de chave
// =============================================================================

/**
 * Carrega e valida a chave V1 a partir de META_TOKEN_ENC_KEY_V1.
 * Mesma chave de tokenCrypto.js no MVP — domínio de segurança compartilhado.
 *
 * @private
 * @returns {Buffer} Chave de 32 bytes
 * @throws {Error} Fail closed — qualquer violação causa throw imediato
 */
function getKeyV1() {
  const keyHex = process.env.META_TOKEN_ENC_KEY_V1;

  if (!keyHex) {
    throw new Error('[meta/pinCrypto] META_TOKEN_ENC_KEY_V1 não configurada');
  }

  if (!HEX_64_RE.test(keyHex)) {
    throw new Error('[meta/pinCrypto] META_TOKEN_ENC_KEY_V1 deve ter exatamente 64 chars hex');
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== 32) {
    throw new Error('[meta/pinCrypto] META_TOKEN_ENC_KEY_V1 deve ter exatamente 32 bytes');
  }

  return key;
}

// =============================================================================
// Decodificação Base64 estrita
// =============================================================================

/**
 * Decodifica Base64 com validação sintática estrita e round-trip canônico.
 * @private
 */
function decodeStrictBase64(payloadBase64) {
  if (!BASE64_STRICT_RE.test(payloadBase64)) {
    throw new Error('[meta/pinCrypto] Falha na descriptografia do PIN');
  }

  const decoded = Buffer.from(payloadBase64, 'base64');

  if (decoded.toString('base64') !== payloadBase64) {
    throw new Error('[meta/pinCrypto] Falha na descriptografia do PIN');
  }

  return decoded;
}

// =============================================================================
// Geração segura de PIN
// =============================================================================

/**
 * Gera um PIN de registration de 6 dígitos usando CSPRNG.
 *
 * Usa crypto.randomInt(0, 1_000_000) — range [0, 999_999].
 * Pad com zeros à esquerda para garantir exatamente 6 dígitos.
 * 000000 é uma saída válida do espaço; não é tratado como default ou fallback.
 *
 * @returns {string} PIN com exatamente 6 dígitos (ex: "042731", "000000", "999999")
 */
export function generateMetaRegistrationPin() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// =============================================================================
// Encrypt
// =============================================================================

/**
 * Criptografa um PIN de registration Meta WhatsApp com AES-256-GCM.
 *
 * @param {string} pin PIN de exatamente 6 dígitos decimais
 * @returns {string} Formato: "v1:<base64(IV[12] || authTag[16] || ciphertext[n])>"
 * @throws {Error} Se PIN inválido (não string, não 6 dígitos) ou chave não configurada
 */
export function encryptMetaRegistrationPin(pin) {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    throw new Error('[meta/pinCrypto] PIN inválido para criptografia — deve ter exatamente 6 dígitos');
  }

  const key = getKeyV1();
  const iv  = randomBytes(IV_BYTES);

  const cipher     = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  // Layout: IV(12) || authTag(16) || ciphertext(n)
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return `v1:${combined.toString('base64')}`;
}

// =============================================================================
// Decrypt
// =============================================================================

/**
 * Descriptografa um PIN de registration Meta WhatsApp.
 *
 * @param {string} encrypted Valor salvo no banco (formato "v1:...")
 * @returns {string} PIN plaintext com exatamente 6 dígitos
 * @throws {Error} Em caso de falha — mensagem genérica (previne oracle attacks)
 */
export function decryptMetaRegistrationPin(encrypted) {
  if (typeof encrypted !== 'string') {
    throw new Error('[meta/pinCrypto] Valor inválido para descriptografia');
  }

  const colonIdx = encrypted.indexOf(':');
  if (colonIdx < 0) {
    throw new Error('[meta/pinCrypto] Formato de PIN criptografado desconhecido');
  }

  const version = encrypted.slice(1, colonIdx);

  if (version === '1') {
    const key = getKeyV1();

    const combined = decodeStrictBase64(encrypted.slice(colonIdx + 1));

    // Mínimo: 12 bytes IV + 16 bytes authTag + ao menos 1 byte de ciphertext
    if (combined.length < IV_BYTES + TAG_BYTES + 1) {
      throw new Error('[meta/pinCrypto] Falha na descriptografia do PIN');
    }

    const iv         = combined.subarray(0, IV_BYTES);
    const authTag    = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let plaintext;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('[meta/pinCrypto] Falha na descriptografia do PIN');
    }

    // Pós-decrypt: validar que o plaintext é de fato um PIN válido.
    if (!PIN_RE.test(plaintext)) {
      throw new Error('[meta/pinCrypto] Falha na descriptografia do PIN');
    }

    return plaintext;
  }

  throw new Error('[meta/pinCrypto] Versão de criptografia desconhecida');
}
