// =============================================================================
// instagramState — state JWT assinado para proteção CSRF no OAuth Meta
//
// Implementação nativa (sem biblioteca externa) usando HMAC-SHA256.
//
// Formato do state: "<base64url(JSON payload)>.<base64url(HMAC-SHA256)>"
//
// Env var obrigatória:
//   INSTAGRAM_STATE_SECRET = string aleatória forte
//   Gerar com: openssl rand -base64 32
//
// Segurança:
//   - Comparação timing-safe previne timing attacks
//   - Expiração embutida no payload (padrão 10 minutos)
//   - Erros tipados (code) para mapeamento correto no callback
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(str) {
  return Buffer.from(str, 'base64url');
}

function getSecret() {
  const s = process.env.INSTAGRAM_STATE_SECRET;
  if (!s) throw new Error('[instagramState] INSTAGRAM_STATE_SECRET não configurada');
  return s;
}

/**
 * Gera um state JWT assinado com HMAC-SHA256.
 *
 * @param {{ user_id: string, company_id: string }} payload
 * @param {number} [ttlMs] TTL em ms (padrão 10 minutos)
 * @returns {string} state para incluir na URL OAuth
 */
export function signState(payload, ttlMs = STATE_TTL_MS) {
  const secret = getSecret();
  const full   = { ...payload, iat: Date.now(), exp: Date.now() + ttlMs };
  const data   = b64url(JSON.stringify(full));
  const sig    = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

/**
 * Verifica e retorna o payload de um state JWT.
 * Lança erro tipado (err.code) em caso de falha.
 *
 * @param {string} state
 * @returns {{ user_id: string, company_id: string, iat: number, exp: number }}
 */
export function verifyState(state) {
  const secret = getSecret();

  if (!state || typeof state !== 'string') {
    throw stateError('invalid_state', 'State ausente ou inválido');
  }

  const dotIdx = state.lastIndexOf('.');
  if (dotIdx < 1) {
    throw stateError('invalid_state', 'Formato de state inválido');
  }

  const data = state.slice(0, dotIdx);
  const sig  = state.slice(dotIdx + 1);

  // Timing-safe comparison
  const expectedSig = b64url(createHmac('sha256', secret).update(data).digest());
  const sigBuf      = Buffer.from(sig, 'base64url');
  const expBuf      = Buffer.from(expectedSig, 'base64url');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw stateError('invalid_state', 'Assinatura de state inválida');
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(data).toString('utf8'));
  } catch {
    throw stateError('invalid_state', 'Payload de state corrompido');
  }

  if (!payload.exp || Date.now() > payload.exp) {
    throw stateError('expired_state', 'State expirado');
  }

  if (!payload.user_id || !payload.company_id) {
    throw stateError('invalid_state', 'State incompleto');
  }

  return payload;
}

function stateError(code, message) {
  const err = new Error(message);
  err.code  = code;
  return err;
}
