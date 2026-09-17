// =============================================================================
// selectionTokenCrypto — AES-256-GCM para continuation tokens de seleção de WABA
//
// Propósito exclusivo: criptografar/autenticar o payload de seleção gerado
// em /complete quando múltiplas WABAs são encontradas no caminho discovery.
//
// Formato persistido: v1:<base64(IV[12] || authTag[16] || ciphertext[n])>
//
// Env var obrigatória:
//   META_SELECTION_ENC_KEY_V1 = exatamente 64 chars hex (32 bytes / 256 bits)
//   Gerar com: openssl rand -hex 32
//
// KEY SEPARATION obrigatória:
//   NÃO reutilizar META_TOKEN_ENC_KEY_V1 — finalidade diferente.
//   NÃO reutilizar META_APP_SECRET — chave de outra camada Meta.
//
// Arquitetura para rotação de chave futura:
//   - Prefixo "v1:" identifica a versão de criptografia.
//   - Para v2: adicionar getKeyV2() e case 'v2' no decryptSelectionPayload.
//
// Payload esperado pelo encryptSelectionPayload:
//   {
//     v:    1,
//     uid:  <string UUID — user.id autenticado>,
//     cid:  <string UUID — company_id derivado do onboarding state>,
//     exp:  <number — epoch ms de expiração>,
//     opts: [{ w, p, d, n }] — candidatos não expostos ao cliente,
//     enc:  <string — ciphertext do access token Meta, já produzido por encryptMetaToken>,
//   }
//
// decryptSelectionPayload valida (nesta ordem):
//   1. Presença e formato do token (prefixo v1:, base64)
//   2. Autenticidade GCM (auth tag — tamper-evident)
//   3. JSON parse
//   4. Campos obrigatórios (v, uid, cid, exp, opts, enc)
//   5. Versão: v === 1
//   6. exp > Date.now() (expirado → throw)
//   7. uid e cid: UUID v4 válido
//   8. opts: array não vazio com cada item validado
//   9. enc: string prefixada com 'v'
//
// SEGURANÇA:
//   - Fail closed: ausência ou formato incorreto da chave causam THROW imediato.
//   - Sem fallback de chave. Sem geração automática. Sem chave default.
//   - Erros de descriptografia são genéricos (previne oracle attacks).
//   - Payload e chave nunca logados — nenhuma mensagem de erro expõe o plaintext.
//   - Caller (resolve-waba.js) mapeia qualquer throw para 400 invalid_continuation.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_BYTES  = 12;
const TAG_BYTES = 16;

// Regex para validar exatamente 64 chars hexadecimais (case-insensitive).
const HEX_64_RE = /^[0-9a-f]{64}$/i;

// Regex de Base64 canônico estrito (RFC 4648 §4) — idêntica à de tokenCrypto.js.
const BASE64_STRICT_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// UUID v4 básico — rejeita strings obviamente inválidas.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// Carregamento de chave
// =============================================================================

/**
 * Carrega e valida META_SELECTION_ENC_KEY_V1.
 * @private
 * @returns {Buffer} 32 bytes
 * @throws {Error} Fail closed
 */
function getKey() {
  const keyHex = process.env.META_SELECTION_ENC_KEY_V1;

  if (!keyHex) {
    throw new Error('[meta/selectionTokenCrypto] META_SELECTION_ENC_KEY_V1 não configurada');
  }

  if (!HEX_64_RE.test(keyHex)) {
    throw new Error('[meta/selectionTokenCrypto] META_SELECTION_ENC_KEY_V1 deve ter exatamente 64 chars hex (32 bytes)');
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== 32) {
    throw new Error('[meta/selectionTokenCrypto] META_SELECTION_ENC_KEY_V1 deve ter exatamente 64 chars hex (32 bytes)');
  }

  return key;
}

// =============================================================================
// Decodificação Base64 com validação estrita
// =============================================================================

/**
 * Decodifica Base64 com validação sintática estrita e round-trip canônico.
 * @private
 * @param {string} input
 * @returns {Buffer}
 * @throws {Error} Mensagem genérica — sem detalhes
 */
function decodeStrictBase64(input) {
  if (!BASE64_STRICT_RE.test(input)) {
    throw new Error('[meta/selectionTokenCrypto] Falha na descriptografia');
  }

  const decoded = Buffer.from(input, 'base64');

  if (decoded.toString('base64') !== input) {
    throw new Error('[meta/selectionTokenCrypto] Falha na descriptografia');
  }

  return decoded;
}

// =============================================================================
// Encrypt
// =============================================================================

/**
 * Criptografa um payload de seleção de WABA com AES-256-GCM.
 *
 * O payload é JSON-serializado e cifrado integralmente — nenhum campo fica
 * em plaintext no token (confidencialidade total + integridade GCM).
 *
 * Caller responsável por incluir `exp`, `uid`, `cid`, `opts` e `enc`.
 * Caller responsável por nunca logar o token retornado ou o payload.
 *
 * @param {object} payload Objeto a ser criptografado (nunca logar)
 * @returns {string} Formato: "v1:<base64(IV[12] || authTag[16] || ciphertext[n])>"
 * @throws {Error} Se payload inválido ou chave não configurada
 */
export function encryptSelectionPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[meta/selectionTokenCrypto] Payload inválido para criptografia');
  }

  const key = getKey();
  const iv  = randomBytes(IV_BYTES);

  let plaintext;
  try {
    plaintext = JSON.stringify(payload);
  } catch {
    throw new Error('[meta/selectionTokenCrypto] Payload não serializável');
  }

  const cipher     = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag(); // 16 bytes — GCM authentication tag

  // Layout: IV(12) || authTag(16) || ciphertext(n)
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return `v1:${combined.toString('base64')}`;
}

// =============================================================================
// Decrypt + Validate
// =============================================================================

/**
 * Descriptografa e valida um continuation token de seleção de WABA.
 *
 * Qualquer falha — adulteração, expiração, schema inválido, chave incorreta —
 * lança Error genérico sem detalhes de infra. O caller deve mapear para
 * 400 { error: 'invalid_continuation' } sem repassar a mensagem.
 *
 * @param {string} token Formato "v1:<base64...>"
 * @returns {{ v: number, uid: string, cid: string, exp: number, opts: Array, enc: string }}
 * @throws {Error} Mensagem genérica — caller não deve expô-la ao cliente
 */
export function decryptSelectionPayload(token) {
  // ── 1. Tipo e prefixo ──────────────────────────────────────────────────────
  if (typeof token !== 'string') {
    throw new Error('[meta/selectionTokenCrypto] Formato de token inválido');
  }

  const colonIdx = token.indexOf(':');
  if (colonIdx < 2 || token[0] !== 'v') {
    throw new Error('[meta/selectionTokenCrypto] Formato de token inválido');
  }

  const version = token.slice(1, colonIdx);
  if (version !== '1') {
    throw new Error('[meta/selectionTokenCrypto] Versão de token não suportada');
  }

  // ── 2. Decodificar Base64 ─────────────────────────────────────────────────
  const key      = getKey();
  const combined = decodeStrictBase64(token.slice(colonIdx + 1));

  // Mínimo: 12 bytes IV + 16 bytes authTag + 1 byte ciphertext
  if (combined.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('[meta/selectionTokenCrypto] Falha na descriptografia');
  }

  const iv         = combined.subarray(0, IV_BYTES);
  const authTag    = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);

  // ── 3. Descriptografar (GCM verifica auth tag atomicamente) ──────────────
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Falha de autenticação GCM (adulteração) — mensagem genérica anti-oracle
    throw new Error('[meta/selectionTokenCrypto] Falha na descriptografia');
  }

  // ── 4. JSON parse ─────────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new Error('[meta/selectionTokenCrypto] Payload corrompido');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[meta/selectionTokenCrypto] Schema inválido');
  }

  // ── 5. Versão do payload ──────────────────────────────────────────────────
  if (payload.v !== 1) {
    throw new Error('[meta/selectionTokenCrypto] Versão de payload inválida');
  }

  // ── 6. Expiração ──────────────────────────────────────────────────────────
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('[meta/selectionTokenCrypto] Campo exp inválido');
  }
  if (payload.exp < Date.now()) {
    throw new Error('[meta/selectionTokenCrypto] Token expirado');
  }

  // ── 7. uid e cid ─────────────────────────────────────────────────────────
  if (typeof payload.uid !== 'string' || !UUID_RE.test(payload.uid)) {
    throw new Error('[meta/selectionTokenCrypto] Campo uid inválido');
  }
  if (typeof payload.cid !== 'string' || !UUID_RE.test(payload.cid)) {
    throw new Error('[meta/selectionTokenCrypto] Campo cid inválido');
  }

  // ── 8. opts ──────────────────────────────────────────────────────────────
  if (!Array.isArray(payload.opts) || payload.opts.length === 0) {
    throw new Error('[meta/selectionTokenCrypto] Campo opts inválido');
  }

  for (const opt of payload.opts) {
    if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
      throw new Error('[meta/selectionTokenCrypto] Item de opts inválido');
    }
    // w (waba_id): string não vazia
    if (typeof opt.w !== 'string' || opt.w.length === 0) {
      throw new Error('[meta/selectionTokenCrypto] opt.w inválido');
    }
    // p (phone_number_id): string não vazia
    if (typeof opt.p !== 'string' || opt.p.length === 0) {
      throw new Error('[meta/selectionTokenCrypto] opt.p inválido');
    }
    // d (display_phone_number): string ou null
    if (opt.d !== null && typeof opt.d !== 'string') {
      throw new Error('[meta/selectionTokenCrypto] opt.d inválido');
    }
    // n (verified_name): string ou null
    if (opt.n !== null && typeof opt.n !== 'string') {
      throw new Error('[meta/selectionTokenCrypto] opt.n inválido');
    }
  }

  // ── 9. enc ────────────────────────────────────────────────────────────────
  // Deve ser um ciphertext versionado (ex: "v1:...") produzido por encryptMetaToken.
  if (typeof payload.enc !== 'string' || !payload.enc.startsWith('v')) {
    throw new Error('[meta/selectionTokenCrypto] Campo enc inválido');
  }

  return payload;
}
