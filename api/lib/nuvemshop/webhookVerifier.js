// =============================================================================
// webhookVerifier — verifica assinatura HMAC dos webhooks Nuvemshop
//
// A Nuvemshop assina cada requisição com:
//   Header: X-Linkedstore-Hmac-Sha256: Base64(HMAC-SHA256(client_secret, raw_body))
//
// Segurança:
//   - Comparação timing-safe (timingSafeEqual) — previne timing attacks
//   - Raw body lido antes de qualquer parsing (necessário para HMAC correto)
//   - client_secret nunca logado
//   - Falha genérica — sem vazar razão real
//
// Env var obrigatória:
//   NUVEMSHOP_CLIENT_SECRET
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

const HMAC_HEADER = 'x-linkedstore-hmac-sha256';

/**
 * Verifica a assinatura HMAC de um webhook Nuvemshop.
 *
 * @param {string} rawBody  Body cru como string UTF-8 (não parseado)
 * @param {object} headers  Headers da requisição (lowercased)
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyNuvemshopHmac(rawBody, headers) {
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    console.error('[webhookVerifier] NUVEMSHOP_CLIENT_SECRET não configurada');
    return { ok: false, error: 'configuration_error' };
  }

  const signature = headers[HMAC_HEADER] ?? headers['X-Linkedstore-Hmac-Sha256'];
  if (!signature) {
    return { ok: false, error: 'missing_signature' };
  }

  // HMAC esperado (bytes brutos)
  const expectedBytes = createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest();

  // Diagnóstico seguro: não loga secret nem payload — só tamanhos e formato
  const sigTrimmed = signature.trim();
  const isHex      = /^[0-9a-f]{64}$/i.test(sigTrimmed);
  const isBase64   = /^[A-Za-z0-9+/]{43}={0,1}$/.test(sigTrimmed);

  console.log('[webhookVerifier] diag body_len=%d sig_len=%d is_hex=%s is_base64=%s secret_len=%d',
    rawBody.length, sigTrimmed.length, isHex, isBase64, clientSecret.length);

  // Tentar verificação em hex (formato que a Nuvemshop pode usar)
  if (isHex) {
    const expectedHex = expectedBytes.toString('hex');
    if (expectedHex === sigTrimmed.toLowerCase()) return { ok: true };
    console.warn('[webhookVerifier] hex_mismatch');
    return { ok: false, error: 'signature_mismatch' };
  }

  // Tentar verificação em base64
  let sigBuf;
  try {
    sigBuf = Buffer.from(sigTrimmed, 'base64');
  } catch {
    return { ok: false, error: 'invalid_signature_format' };
  }

  if (sigBuf.length !== expectedBytes.length) {
    console.warn('[webhookVerifier] length_mismatch sig=%d expected=%d', sigBuf.length, expectedBytes.length);
    return { ok: false, error: 'signature_mismatch' };
  }

  if (!timingSafeEqual(sigBuf, expectedBytes)) {
    console.warn('[webhookVerifier] value_mismatch sig_prefix=%s', sigTrimmed.slice(0, 8));
    return { ok: false, error: 'signature_mismatch' };
  }

  return { ok: true };
}
