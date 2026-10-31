// =============================================================================
// GET/POST /api/instagram/modality
//
// A troca só acontece na RPC switch_instagram_account_modality.
// O ator é o usuário do JWT. O corpo não escolhe papel nem conversa.
// =============================================================================

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { authorizeInstagramModalitySwitch } from './instagramModalityAuth.js';
import { describeInstagramModality } from './instagramModalityEligibility.js';
import { BYO_POC_ROLES, evaluateByoPocAccess } from './byoPocGate.js';
import { validateInstagramCaller } from './validateInstagramCaller.js';

function modalitySwitchEnabled() {
  return process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED === 'true';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_ID = /^[0-9]{5,32}$/;
const ALLOWED_BODY = new Set([
  'company_id',
  'instagram_account_id',
  'target_mode',
  'official_connection_id',
  'byo_account_id',
  'confirmed',
]);
const READ_ROLES = BYO_POC_ROLES;
const RPC_STATUS = {
  rejected: 400,
  forbidden: 403,
  company_mismatch: 404,
  company_inactive: 409,
  identity_mismatch: 409,
  ambiguous_instagram_account: 409,
  destination_not_ready: 409,
};

function send(res, status, body) {
  res.status(status).json(body);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseBody(req) {
  const raw = req.body;
  if (raw == null || raw === '') return { error: 'invalid_json' };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return { error: 'invalid_json' };
      return { body: parsed };
    } catch {
      return { error: 'invalid_json' };
    }
  }
  if (!isPlainObject(raw)) return { error: 'invalid_json' };
  return { body: raw };
}

function acceptsJson(header) {
  if (typeof header !== 'string') return false;
  const parts = header.split(';').map((part) => part.trim().toLowerCase()).filter(Boolean);
  return parts[0] === 'application/json' && (parts.length === 1 || parts[1] === 'charset=utf-8');
}

async function readCompanyActive(svc, companyId) {
  const { data, error } = await svc
    .from('companies')
    .select('status, deleted_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) return { ok: false };
  if (!data) return { ok: true, active: false };
  return { ok: true, active: data.status === 'active' && data.deleted_at == null };
}

export async function loadModality(svc, companyId) {
  const company = await readCompanyActive(svc, companyId);
  if (!company.ok) return { ok: false };

  const [connections, accounts, operations, credential] = await Promise.all([
    svc.from('instagram_connections')
      .select('id, status, instagram_username, instagram_user_id, ig_webhook_id')
      .eq('company_id', companyId),
    svc.from('instagram_byo_poc_accounts')
      .select('id, instagram_account_id, instagram_username, status, status_reason, direct_ingest_enabled')
      .eq('company_id', companyId),
    svc.from('instagram_account_operations')
      .select('instagram_account_id, mode, official_connection_id, byo_account_id')
      .eq('company_id', companyId),
    // O predicado confirma a presença do segredo sem trazê-lo ao processo.
    // Uma coluna booleana evitaria até essa leitura e exigiria migration.
    svc.from('instagram_byo_company_credentials')
      .select('validation_status, webhook_enabled, webhook_route_id, webhook_verify_token_hash')
      .eq('company_id', companyId)
      .not('app_secret_enc', 'is', null)
      .neq('app_secret_enc', '')
      .not('suat_enc', 'is', null)
      .neq('suat_enc', '')
      .maybeSingle(),
  ]);

  if (connections.error || accounts.error || operations.error || credential.error) {
    return { ok: false };
  }

  return {
    ok: true,
    accounts: describeInstagramModality({
      companyActive: company.active,
      connections: connections.data ?? [],
      accounts: accounts.data ?? [],
      operations: operations.data ?? [],
      credential: credential.data
        ? { ...credential.data, secret_present: true, suat_present: true }
        : null,
    }),
  };
}

function mapRpc(data, companyId) {
  if (!isPlainObject(data) || typeof data.reason !== 'string') return null;
  if (data.reason === 'switched' || data.reason === 'already_applied') {
    if (data.ok !== true) return null;
    if (data.target_mode !== 'official' && data.target_mode !== 'byo') return null;
    if (typeof data.moved_count !== 'number' || !Number.isInteger(data.moved_count) || data.moved_count < 0) {
      return null;
    }
    return {
      status: 200,
      body: {
        ok: true,
        reason: data.reason,
        company_id: companyId,
        target_mode: data.target_mode,
        moved_count: data.moved_count,
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(RPC_STATUS, data.reason)) {
    return { status: RPC_STATUS[data.reason], body: { error: data.reason } };
  }
  return null;
}

async function ownedPair(svc, companyId, connectionId, byoId, accountId) {
  const connection = await svc
    .from('instagram_connections')
    .select('id, instagram_user_id, ig_webhook_id')
    .eq('id', connectionId)
    .eq('company_id', companyId)
    .maybeSingle();
  const account = await svc
    .from('instagram_byo_poc_accounts')
    .select('id, instagram_account_id')
    .eq('id', byoId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (connection.error || account.error) return { ok: false, status: 503, error: 'unavailable' };
  if (!connection.data || !account.data) return { ok: false, status: 404, error: 'company_mismatch' };
  const sameAccount = account.data.instagram_account_id === accountId
    && (
      connection.data.instagram_user_id === accountId
      || connection.data.ig_webhook_id === accountId
    );
  if (!sameAccount) return { ok: false, status: 409, error: 'identity_mismatch' };
  return { ok: true };
}

async function handleGet(req, res) {
  const rawCompanyId = typeof req.query?.company_id === 'string' ? req.query.company_id : '';
  const gate = evaluateByoPocAccess({ requestedCompanyId: rawCompanyId });
  if (!gate.ok) return send(res, gate.status, { error: gate.error });

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }

  const auth = await validateInstagramCaller(req, svc, gate.companyId, { roles: READ_ROLES });
  if (!auth.ok) return send(res, auth.status, { error: auth.error });

  const loaded = await loadModality(svc, gate.companyId);
  if (!loaded.ok) return send(res, 503, { error: 'unavailable' });
  return send(res, 200, {
    ok: true,
    company_id: gate.companyId,
    switch_available: modalitySwitchEnabled(),
    accounts: loaded.accounts,
  });
}

async function handlePost(req, res) {
  const contentType = req.headers?.['content-type'] ?? req.headers?.['Content-Type'];
  if (!acceptsJson(contentType)) return send(res, 415, { error: 'unsupported_media_type' });

  const parsed = parseBody(req);
  if (parsed.error) return send(res, 400, { error: 'invalid_json' });
  const body = parsed.body;
  if (Object.keys(body).some((key) => !ALLOWED_BODY.has(key))) {
    return send(res, 400, { error: 'rejected' });
  }
  if (body.confirmed !== true) return send(res, 400, { error: 'confirmation_required' });

  const gate = evaluateByoPocAccess({
    requestedCompanyId: typeof body.company_id === 'string' ? body.company_id : '',
  });
  if (!gate.ok) return send(res, gate.status, { error: gate.error });

  const accountId = typeof body.instagram_account_id === 'string' ? body.instagram_account_id : '';
  const connectionId = typeof body.official_connection_id === 'string' ? body.official_connection_id : '';
  const byoId = typeof body.byo_account_id === 'string' ? body.byo_account_id : '';
  if (
    !ACCOUNT_ID.test(accountId)
    || !UUID.test(connectionId)
    || !UUID.test(byoId)
    || (body.target_mode !== 'official' && body.target_mode !== 'byo')
  ) {
    return send(res, 400, { error: 'rejected' });
  }

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }

  let auth;
  try {
    auth = await authorizeInstagramModalitySwitch(req, svc, gate.companyId);
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }
  if (!auth.ok) return send(res, auth.status, { error: auth.error });
  if (!modalitySwitchEnabled()) return send(res, 409, { error: 'modality_switch_disabled' });

  const pair = await ownedPair(svc, gate.companyId, connectionId, byoId, accountId);
  if (!pair.ok) return send(res, pair.status, { error: pair.error });

  let rpc;
  try {
    rpc = await svc.rpc('switch_instagram_account_modality', {
      p_company_id: gate.companyId,
      p_actor_id: auth.userId,
      p_instagram_account_id: accountId,
      p_target_mode: body.target_mode,
      p_official_connection_id: connectionId,
      p_byo_account_id: byoId,
    });
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }
  if (rpc.error) return send(res, 503, { error: 'unavailable' });

  const mapped = mapRpc(rpc.data, gate.companyId);
  if (!mapped) return send(res, 503, { error: 'unavailable' });
  return send(res, mapped.status, mapped.body);
}

export async function handleInstagramModality(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return send(res, 405, { error: 'method_not_allowed' });
}
