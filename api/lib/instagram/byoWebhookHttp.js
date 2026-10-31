import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { decryptByoSecret } from './byoTokenCrypto.js';
import { parseDmEvents } from './parseInstagramWebhook.js';
import { verifyWebhookSignature } from './verifyWebhookSignature.js';
import {
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

  let payload;
  try {
    payload = JSON.parse(raw.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'rejected' });
  }

  try {
    const outcome = await persistDirectEvents(svc, loaded.data.company_id, payload);
    if (outcome === 'unavailable') return res.status(500).json({ error: 'unavailable' });
  } catch {
    return res.status(500).json({ error: 'unavailable' });
  }

  return res.status(200).json({ ok: true });
}

function timestampOf(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function accountEligible(account, companyId, instagramAccountId) {
  return Boolean(
    account
    && account.company_id === companyId
    && account.instagram_account_id === instagramAccountId
    && typeof account.id === 'string',
  );
}

async function loadByoAccount(svc, companyId, instagramAccountId) {
  return svc
    .from('instagram_byo_poc_accounts')
    .select('id, company_id, instagram_account_id')
    .eq('company_id', companyId)
    .eq('instagram_account_id', instagramAccountId)
    .maybeSingle();
}

function rpcArgs(companyId, account, event) {
  return {
    p_company_id: companyId,
    p_byo_account_id: account.id,
    p_instagram_account_id: account.instagram_account_id,
    p_ig_message_id: event.igMessageId,
    p_ig_thread_id: event.igThreadId,
    p_participant_ig_user_id: event.participantIgUserId,
    p_direction: event.direction,
    p_message_type: event.messageType,
    p_content: typeof event.content === 'string' ? event.content : null,
    p_media_url: typeof event.mediaUrl === 'string' ? event.mediaUrl : null,
    p_timestamp: timestampOf(event.timestamp),
    p_reply_to_ig_message_id: event.replyToIgMessageId ?? null,
    p_reply_to_content: null,
    p_reply_to_direction: null,
    p_participant_name: null,
    p_participant_username: null,
  };
}

async function persistDirectEvents(svc, companyId, payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return 'ok';

  const accounts = new Map();
  for (const entry of payload.entry) {
    let events = [];
    try {
      events = parseDmEvents(entry && typeof entry === 'object' ? entry : {});
    } catch {
      continue;
    }

    for (const event of events) {
      const instagramAccountId = String(event.instagramUserId ?? '');
      if (!accounts.has(instagramAccountId)) {
        const loaded = await loadByoAccount(svc, companyId, instagramAccountId);
        if (loaded.error) return 'unavailable';
        accounts.set(
          instagramAccountId,
          accountEligible(loaded.data, companyId, instagramAccountId) ? loaded.data : null,
        );
      }

      const account = accounts.get(instagramAccountId);
      if (!account) continue;

      const result = await svc.rpc('process_instagram_byo_dm_webhook', rpcArgs(companyId, account, event));
      if (!result || result.error || !result.data || typeof result.data !== 'object') return 'unavailable';
    }
  }

  return 'ok';
}
