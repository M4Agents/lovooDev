// =============================================================================
// verifyWebhookSignature — Leitura de raw body + validação HMAC SHA-256
//
// Padrão Meta (Facebook/Instagram):
//   X-Hub-Signature-256: sha256=<hex>
//   Assinatura = HMAC-SHA256(rawBody, INSTAGRAM_APP_SECRET)
//
// CRÍTICO:
//   - readRawBody deve ser chamado ANTES de qualquer parsing do body.
//   - O arquivo webhook.js deve exportar: export const config = { api: { bodyParser: false } }
//   - Usar timingSafeEqual para evitar timing attacks.
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Lê o body bruto da request como Buffer.
 * Deve ser chamado antes de qualquer acesso a req.body.
 * Compatível com Vercel Node.js runtime com bodyParser: false.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Valida o header X-Hub-Signature-256 da Meta.
 * Usa comparação timing-safe para prevenir timing attacks.
 *
 * @param {Buffer}  rawBody    Body bruto da request
 * @param {string}  signature  Valor do header X-Hub-Signature-256 (formato "sha256=<hex>")
 * @param {string}  appSecret  INSTAGRAM_APP_SECRET
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature, appSecret) {
  if (!signature || !appSecret || !rawBody?.length) return false;

  if (!signature.startsWith('sha256=')) return false;
  const receivedHex = signature.slice(7);

  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (receivedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(receivedBuf, expectedBuf);
}
