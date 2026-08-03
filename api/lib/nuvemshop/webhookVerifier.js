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
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('[webhookVerifier] NUVEMSHOP_CLIENT_SECRET não configurada');
    return { ok: false, error: 'configuration_error' };
  }

  const signature = headers[HMAC_HEADER] ?? headers['X-Linkedstore-Hmac-Sha256'];
  if (!signature) {
    return { ok: false, error: 'missing_signature' };
  }

  let sigBuf;
  try {
    sigBuf = Buffer.from(signature, 'base64');
  } catch {
    return { ok: false, error: 'invalid_signature_format' };
  }

  const expected    = createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest();
  const expectedBuf = Buffer.from(expected);

  if (sigBuf.length !== expectedBuf.length) {
    return { ok: false, error: 'signature_mismatch' };
  }

  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: 'signature_mismatch' };
  }

  return { ok: true };
}
