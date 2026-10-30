import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const WEBHOOK_ROUTE_BYTES = 32;
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
const HEX_64 = /^[0-9a-f]{64}$/;
const ELIGIBLE_STATUSES = new Set(['saved', 'pending', 'valid', 'failed']);

export function createWebhookSecret() {
  return randomBytes(WEBHOOK_ROUTE_BYTES).toString('hex');
}

export function hashWebhookVerifyToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function webhookRouteIdValid(value) {
  return typeof value === 'string' && HEX_64.test(value);
}

export function verifyTokenMatches(presented, storedHash) {
  const presentedHash = hashWebhookVerifyToken(typeof presented === 'string' ? presented : '');
  if (!HEX_64.test(storedHash) || !HEX_64.test(presentedHash)) return false;
  return timingSafeEqual(Buffer.from(presentedHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

export function credentialCanHostWebhook(row) {
  return Boolean(
    row
    && ELIGIBLE_STATUSES.has(row.validation_status)
    && row.webhook_enabled === true
    && webhookRouteIdValid(row.webhook_route_id)
    && HEX_64.test(row.webhook_verify_token_hash ?? '')
    && typeof row.app_secret_enc === 'string'
    && row.app_secret_enc.length > 0,
  );
}

export function classifyByoWebhookPayload(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return 'ignored';
  let kind = 'other';
  for (const entry of payload.entry) {
    if (Array.isArray(entry?.messaging) && entry.messaging.length > 0) kind = 'dm';
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    if (changes.some((change) => change?.field === 'comments')) kind = 'comment';
  }
  return kind;
}

export async function readLimitedRawBody(req, limit = WEBHOOK_BODY_LIMIT) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > limit) return { ok: false };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return { ok: false };
    chunks.push(buffer);
  }
  return { ok: true, body: Buffer.concat(chunks) };
}
