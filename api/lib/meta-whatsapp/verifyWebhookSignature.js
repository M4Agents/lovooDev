// =============================================================================
// verifyWebhookSignature — Validação HMAC SHA-256 de webhooks Meta WhatsApp
//
// Módulo exclusivo do namespace meta-whatsapp.
// Não importa nem reutiliza implementação do módulo Instagram.
//
// Padrão Meta (WhatsApp Cloud API):
//   X-Hub-Signature-256: sha256=<64 hex chars>
//   Assinatura = HMAC-SHA256(rawBody, META_APP_SECRET)
//
// CRÍTICO:
//   - rawBody deve ser lido ANTES de qualquer parsing do body.
//   - O arquivo webhook.js deve exportar: export const config = { api: { bodyParser: false } }
//   - readRawBody pertence à Fase 2C — não implementado aqui.
//
// SEGURANÇA:
//   - Usa timingSafeEqual para prevenir timing attacks.
//   - Nunca lança exceção por assinatura malformada — retorna false (fail-closed).
//   - Nunca loga secret, signature ou rawBody.
//   - Entrada inválida em qualquer parâmetro → false imediato (sem throw).
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

// Regex para validar exatamente 64 chars hexadecimais (case-insensitive).
// Garante que signatures com comprimento incorreto ou chars não-hex são
// rejeitadas antes de Buffer.from(), evitando comparações silenciosamente erradas.
const HEX_64_RE = /^[0-9a-f]{64}$/i;

/**
 * Valida o header X-Hub-Signature-256 de um webhook Meta WhatsApp.
 *
 * Usa comparação timing-safe para prevenir timing attacks.
 * Nunca lança exceção por entrada malformada — retorna false (fail-closed).
 *
 * @param {Buffer}  rawBody         Body bruto da request (Buffer, não vazio)
 * @param {string}  signatureHeader Valor do header X-Hub-Signature-256
 *                                  Formato esperado: "sha256=<64 hex chars>"
 * @param {string}  appSecret       META_APP_SECRET (nunca logar)
 * @returns {boolean} true somente se a assinatura for criptograficamente válida
 */
export function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
  // ── Validação de entrada (fail-closed — qualquer entrada inválida → false) ─

  // rawBody deve ser um Buffer não vazio
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;

  // signatureHeader deve ser string com prefixo obrigatório
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;

  // appSecret deve ser string não vazia
  if (typeof appSecret !== 'string' || appSecret.length === 0) return false;

  // Extrair a parte hex após "sha256="
  const receivedHex = signatureHeader.slice(7);

  // Validar que é exatamente 64 chars hex (32 bytes) — rejeita tamanhos incorretos
  if (!HEX_64_RE.test(receivedHex)) return false;

  // ── Cálculo HMAC ──────────────────────────────────────────────────────────
  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Comprimentos devem ser iguais antes de timingSafeEqual (32 bytes cada)
  if (receivedBuf.length !== expectedBuf.length) return false;

  // Comparação timing-safe — previne ataques de timing channel
  return timingSafeEqual(receivedBuf, expectedBuf);
}
