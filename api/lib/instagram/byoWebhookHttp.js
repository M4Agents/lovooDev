import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { decryptByoSecret } from './byoTokenCrypto.js';
import { verifyWebhookSignature } from './verifyWebhookSignature.js';
import {
  classifyByoWebhookPayload,
  credentialCanHostWebhook,
  readLimitedRawBody,
  verifyTokenMatches,
  webhookRouteIdValid,
} from './byoWebhook.js';

const CHALLENGE_RE = /^[A-Za-z0-9._-]{1,256}$/;

function routeIdOf(req) {
  const value = req.query?.routeId;
  return typeof value === 'string' ? value : '';
}

async function loadRoute(svc, routeId) {
  return svc
    .from('instagram_byo_company_credentials')
    .select('company_id, validation_status, webhook_enabled, webhook_route_id, webhook_verify_token_hash, app_secret_enc')
    .eq('webhook_route_id', routeId)
    .maybeSingle();
}

export async function handleByoWebhook(req, res) {
  const routeId = routeIdOf(req);
  if (!webhookRouteIdValid(routeId)) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') return handleGet(req, res, routeId);
  if (req.method === 'POST') return handlePost(req, res, routeId);
  return res.status(405).json({ error: 'method_not_allowed' });
}

async function handleGet(req, res, routeId) {
  if (req.query?.['hub.mode'] !== 'subscribe' || !CHALLENGE_RE.test(String(req.query?.['hub.challenge'] ?? ''))) {
    return res.status(403).json({ error: 'forbidden' });
  }

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(403).json({ error: 'forbidden' });
  }

  const loaded = await loadRoute(svc, routeId);
  if (loaded.error || !loaded.data) return res.status(404).json({ error: 'not_found' });
  if (!credentialCanHostWebhook(loaded.data)) return res.status(403).json({ error: 'forbidden' });
  if (!verifyTokenMatches(req.query?.['hub.verify_token'], loaded.data.webhook_verify_token_hash)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  return res.status(200).send(String(req.query['hub.challenge']));
}

async function handlePost(req, res, routeId) {
  const raw = await readLimitedRawBody(req);
  if (!raw.ok) return res.status(413).json({ error: 'payload_too_large' });

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const loaded = await loadRoute(svc, routeId);
  if (loaded.error || !loaded.data) return res.status(404).json({ error: 'not_found' });
  if (!credentialCanHostWebhook(loaded.data)) return res.status(401).json({ error: 'invalid_signature' });

  let appSecret = '';
  try {
    appSecret = decryptByoSecret(loaded.data.app_secret_enc, {
      companyId: loaded.data.company_id,
      field: 'app_secret',
    });
  } catch {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const signature = req.headers?.['x-hub-signature-256'] ?? '';
  if (!verifyWebhookSignature(raw.body, signature, appSecret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  try {
    classifyByoWebhookPayload(JSON.parse(raw.body.toString('utf8')));
  } catch {
    classifyByoWebhookPayload(null);
  }

  return res.status(200).json({ ok: true });
}
