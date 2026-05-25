// =============================================================================
// parseSignedRequest — helper seguro para signed_request da Meta
//
// Usado por:
//   - POST /api/instagram/data-deletion
//   - POST /api/instagram/deauthorize
//
// Formato do signed_request:
//   <base64url_sig>.<base64url_payload>
//
// Algoritmo:
//   1. Split no primeiro '.'
//   2. base64url decode de sig e payload
//   3. Validar algorithm === 'HMAC-SHA256'
//   4. HMAC-SHA256(payload_raw_string, APP_SECRET)
//   5. timingSafeEqual para comparar assinaturas (sem timing attack)
//   6. Validar issued_at: rejeitar se > 1 hora (anti-replay)
//   7. Retornar payload ou null
//
// SEGURANÇA:
//   - Usa timingSafeEqual (padrão de verifyWebhookSignature.js)
//   - Nunca lança stacktrace para o caller
//   - user_id extraído exclusivamente do payload validado
//
// VARIÁVEL DE AMBIENTE:
//   INSTAGRAM_APP_SECRET — mesmo secret usado pelo webhook.js
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hora — anti-replay

/**
 * Decodifica base64url para Buffer.
 * Substitui '-' por '+' e '_' por '/' conforme RFC 4648 §5.
 *
 * @param {string} input
 * @returns {Buffer}
 */
function base64urlDecode(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

/**
 * Valida e decodifica um signed_request da Meta.
 *
 * @param {string} signedRequest  — valor do campo signed_request (form body)
 * @param {string} appSecret      — INSTAGRAM_APP_SECRET
 * @returns {{ user_id: string, algorithm: string, issued_at: number, expires?: number } | null}
 */
export function parseSignedRequest(signedRequest, appSecret) {
  try {
    if (typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
      return null;
    }
    if (!appSecret) {
      return null;
    }

    // ── 1. Separar no primeiro '.' ─────────────────────────────────────────
    const dotIndex   = signedRequest.indexOf('.');
    const encodedSig = signedRequest.slice(0, dotIndex);
    const payloadRaw = signedRequest.slice(dotIndex + 1); // string base64url usada no HMAC

    if (!encodedSig || !payloadRaw) return null;

    // ── 2. Decodificar ─────────────────────────────────────────────────────
    const sigBuffer = base64urlDecode(encodedSig);

    let payload;
    try {
      const payloadStr = base64urlDecode(payloadRaw).toString('utf8');
      payload = JSON.parse(payloadStr);
    } catch {
      return null;
    }

    // ── 3. Validar algoritmo ───────────────────────────────────────────────
    if (typeof payload.algorithm !== 'string' ||
        payload.algorithm.toUpperCase() !== 'HMAC-SHA256') {
      return null;
    }

    // ── 4. Calcular assinatura esperada ────────────────────────────────────
    // IMPORTANTE: o HMAC é calculado sobre a string base64url do payload
    // (payloadRaw), não sobre o payload decodificado.
    const expectedHmac = createHmac('sha256', appSecret)
      .update(payloadRaw, 'utf8')
      .digest();

    // ── 5. Comparação timing-safe ──────────────────────────────────────────
    if (sigBuffer.length !== expectedHmac.length) return null;

    const isValid = timingSafeEqual(sigBuffer, expectedHmac);
    if (!isValid) return null;

    // ── 6. Validar issued_at (anti-replay: máximo 1 hora) ─────────────────
    if (typeof payload.issued_at === 'number') {
      const ageMs = Date.now() - payload.issued_at * 1000;
      if (ageMs > MAX_AGE_MS) return null;
    }

    // ── 7. Validar user_id ─────────────────────────────────────────────────
    if (!payload.user_id) return null;

    return {
      user_id:    String(payload.user_id),
      algorithm:  payload.algorithm,
      issued_at:  payload.issued_at,
      expires:    payload.expires ?? undefined,
    };
  } catch {
    // Nunca expor stack para o caller
    return null;
  }
}
