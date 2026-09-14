// =============================================================================
// tokenCrypto — AES-256-GCM para tokens Meta WhatsApp Cloud API
//
// Formato persistido: v1:<base64(IV[12] || authTag[16] || ciphertext[n])>
//
// Compatível com:
//   meta_whatsapp_credentials.encryption_version = 1
//
// Env var obrigatória:
//   META_TOKEN_ENC_KEY_V1 = exatamente 64 chars hex (32 bytes / 256 bits)
//   Gerar com: openssl rand -hex 32
//
// Arquitetura para rotação de chave futura:
//   - Prefixo "v1:" identifica a versão de criptografia.
//   - Para v2: adicionar getKeyV2() e case 'v2' no decryptMetaToken.
//   - Nunca logar token, plaintext, ciphertext ou chave.
//
// SEGURANÇA:
//   - Fail closed: ausência ou formato incorreto da chave causam THROW imediato.
//   - Sem fallback de chave. Sem chave default. Sem geração automática.
//   - Não reutilizar chave de Instagram ou Nuvemshop.
//   - Erros de descriptografia são genéricos (previne oracle attacks).
//   - Base64 validado com sintaxe estrita + round-trip canônico antes do decode.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_BYTES  = 12;
const TAG_BYTES = 16;

// Regex para validar exatamente 64 chars hexadecimais (case-insensitive).
// Garante que ENVs com tamanho incorreto ou chars não-hex sejam rejeitadas
// antes mesmo do Buffer.from(), evitando decodificações silenciosamente erradas.
const HEX_64_RE = /^[0-9a-f]{64}$/i;

// Regex de Base64 canônico estrito (RFC 4648 §4).
//
// Estrutura:
//   - Zero ou mais grupos completos de 4 chars válidos: [A-Za-z0-9+/]{4}
//   - Grupo final opcional:
//       • 2 chars + "==" → 1 byte de dados
//       • 3 chars + "="  → 2 bytes de dados
//   - String vazia é aceita (0 bytes; rejeitada a seguir pelo check de tamanho)
//
// Rejeita:
//   - Whitespace (espaço, \t, \n)
//   - Qualquer char fora de A-Za-z0-9+/=
//   - "=" em posição inválida (ex: "AA=A", "AAAA=")
//   - Padding excessivo ("===", "====")
//   - Conteúdo após o padding ("AA==BB")
//   - Comprimentos estruturalmente inválidos (length % 4 === 1, ex: "A", "AAAAA")
const BASE64_STRICT_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// =============================================================================
// Carregamento de chave
// =============================================================================

/**
 * Carrega e valida a chave V1 a partir de META_TOKEN_ENC_KEY_V1.
 *
 * Valida (em ordem):
 *   1. Presença da variável de ambiente
 *   2. Exatamente 64 chars hexadecimais (case-insensitive)
 *   3. Decode para exatamente 32 bytes
 *
 * @private
 * @returns {Buffer} Chave de 32 bytes
 * @throws {Error} Fail closed — qualquer violação causa throw imediato
 */
function getKeyV1() {
  const keyHex = process.env.META_TOKEN_ENC_KEY_V1;

  if (!keyHex) {
    throw new Error('[meta/tokenCrypto] META_TOKEN_ENC_KEY_V1 não configurada');
  }

  if (!HEX_64_RE.test(keyHex)) {
    throw new Error('[meta/tokenCrypto] META_TOKEN_ENC_KEY_V1 deve ter exatamente 64 chars hex (32 bytes / 256 bits)');
  }

  const key = Buffer.from(keyHex, 'hex');

  // Dupla verificação pós-decode — garante 32 bytes independente da regex
  if (key.length !== 32) {
    throw new Error('[meta/tokenCrypto] META_TOKEN_ENC_KEY_V1 deve ter exatamente 64 chars hex (32 bytes / 256 bits)');
  }

  return key;
}

// =============================================================================
// Decodificação Base64 com validação estrita
// =============================================================================

/**
 * Decodifica um payload Base64 com validação sintática estrita e verificação
 * de representação canônica.
 *
 * Etapas:
 *   1. Valida sintaxe com BASE64_STRICT_RE — rejeita chars inválidos,
 *      padding malformado, whitespace e comprimentos inválidos antes do decode.
 *   2. Decodifica com Buffer.from.
 *   3. Verifica round-trip canônico: decoded.toString('base64') === payload.
 *      Rejeita representações não canônicas que Buffer.from aceitaria
 *      permissivamente (ex: "AB==" para o mesmo byte que "AA==").
 *
 * Qualquer falha lança o mesmo erro genérico — sem vazar detalhe interno.
 *
 * @private
 * @param {string} payloadBase64 - String após "v1:" no token criptografado
 * @returns {Buffer} Bytes decodificados
 * @throws {Error} Mensagem genérica de falha na descriptografia
 */
function decodeStrictBase64(payloadBase64) {
  // 1. Validação sintática estrita — antes de qualquer decode
  if (!BASE64_STRICT_RE.test(payloadBase64)) {
    throw new Error('[meta/tokenCrypto] Falha na descriptografia do token');
  }

  // 2. Decode
  const decoded = Buffer.from(payloadBase64, 'base64');

  // 3. Round-trip canônico — rejeita representações não canônicas que
  //    passariam pela regex mas decodificam para bytes diferentes dos esperados
  //    (ex: bits de padding com valor não-zero em "AB==" vs "AA==")
  if (decoded.toString('base64') !== payloadBase64) {
    throw new Error('[meta/tokenCrypto] Falha na descriptografia do token');
  }

  return decoded;
}

// =============================================================================
// Encrypt
// =============================================================================

/**
 * Criptografa um token Meta WhatsApp com AES-256-GCM.
 *
 * @param {string} plaintext Token plaintext (nunca logar este valor)
 * @returns {string} Formato: "v1:<base64(IV[12] || authTag[16] || ciphertext[n])>"
 * @throws {Error} Se plaintext inválido ou chave não configurada
 */
export function encryptMetaToken(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('[meta/tokenCrypto] Token inválido para criptografia');
  }

  const key = getKeyV1();
  const iv  = randomBytes(IV_BYTES);

  const cipher     = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag(); // 16 bytes por padrão do Node.js GCM

  // Layout: IV(12) || authTag(16) || ciphertext(n)
  // combined.toString('base64') produz sempre Base64 canônico
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return `v1:${combined.toString('base64')}`;
}

// =============================================================================
// Decrypt
// =============================================================================

/**
 * Descriptografa um token Meta WhatsApp criptografado.
 *
 * @param {string} encrypted Valor salvo no banco (formato "v1:...")
 * @returns {string} Plaintext do token (nunca expor ao frontend)
 * @throws {Error} Em caso de falha — mensagem genérica (previne oracle attacks)
 */
export function decryptMetaToken(encrypted) {
  if (typeof encrypted !== 'string') {
    throw new Error('[meta/tokenCrypto] Valor inválido para descriptografia');
  }

  const colonIdx = encrypted.indexOf(':');
  if (colonIdx < 0) {
    throw new Error('[meta/tokenCrypto] Formato de token desconhecido');
  }

  // Extrai o número de versão entre "v" e ":"
  // Para "v1:...", colonIdx = 2 → slice(1, 2) = "1"
  const version = encrypted.slice(1, colonIdx);

  if (version === '1') {
    const key = getKeyV1();

    // Validação estrita + decode canônico — substitui Buffer.from direto
    const combined = decodeStrictBase64(encrypted.slice(colonIdx + 1));

    // Mínimo: 12 bytes IV + 16 bytes authTag + ao menos 1 byte de ciphertext
    if (combined.length < IV_BYTES + TAG_BYTES + 1) {
      throw new Error('[meta/tokenCrypto] Falha na descriptografia do token');
    }

    const iv         = combined.subarray(0, IV_BYTES);
    const authTag    = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Nunca vazar razão real — previne oracle attacks
      throw new Error('[meta/tokenCrypto] Falha na descriptografia do token');
    }
  }

  // Versão não suportada — mensagem genérica, sem refletir o valor do caller
  throw new Error('[meta/tokenCrypto] Versão de criptografia desconhecida');
}
