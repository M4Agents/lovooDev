// =============================================================================
// verifyWebhookSignature — Raw body reading + Validação HMAC SHA-256
//
// Módulo exclusivo do namespace meta-whatsapp.
// Não importa nem reutiliza implementação do módulo Instagram.
//
// Padrão Meta (WhatsApp Cloud API):
//   X-Hub-Signature-256: sha256=<64 hex chars>
//   Assinatura = HMAC-SHA256(rawBody, META_APP_SECRET)
//
// Funções exportadas:
//   readRawBody(req, maxBytes?)        — lê body bruto com limite defensivo
//   verifyMetaWebhookSignature(...)    — valida HMAC SHA-256
//
// CRÍTICO:
//   - readRawBody deve ser chamado ANTES de qualquer parsing do body.
//   - O arquivo webhook.js deve exportar: export const config = { api: { bodyParser: false } }
//   - Limite de 1 MB é uma decisão defensiva Lovoo — não um requisito Meta documentado.
//
// SEGURANÇA:
//   - Usa timingSafeEqual para prevenir timing attacks.
//   - Nunca lança exceção por assinatura malformada — retorna false (fail-closed).
//   - Nunca loga secret, signature ou rawBody.
//   - Entrada inválida em qualquer parâmetro → false imediato (sem throw).
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

// Limite defensivo para leitura de raw body (1 MB).
// Decisão Lovoo — Meta não documenta tamanho máximo de payload de webhook.
const RAW_BODY_MAX_BYTES = 1_048_576; // 1 MB

/**
 * Lê o body bruto da request como Buffer com limite explícito de tamanho.
 * Deve ser chamado ANTES de qualquer acesso a req.body ou JSON.parse.
 * Compatível com Vercel Node.js runtime com bodyParser: false.
 *
 * O limite é aplicado durante a leitura do stream — não após carregar o body completo.
 * Isso evita consumo excessivo de memória com payloads grandes.
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} [maxBytes=RAW_BODY_MAX_BYTES] — limite em bytes
 * @returns {Promise<Buffer>}
 * @throws {Object} com code='body_too_large' se exceder o limite
 */
export async function readRawBody(req, maxBytes = RAW_BODY_MAX_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

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
