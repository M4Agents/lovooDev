// Diagnóstico explícito do SUAT BYO. Não grava validação nem assina webhooks.

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { authorizeByoCredentialWrite } from './byoCredentialAuth.js';
import { evaluateByoPocAccess } from './byoPocGate.js';
import { decryptByoSecret } from './byoTokenCrypto.js';
import { readUnifiedLoginDiagnostic } from './byoUnifiedLoginRead.js';

const BODY_LIMIT = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function send(res, status, body) {
  res.status(status).json(body);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseCompany(req) {
  const raw = req.body;
  let body = raw;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > BODY_LIMIT) return { error: 'payload_too_large' };
    try {
      body = JSON.parse(raw);
    } catch {
      return { error: 'rejected' };
    }
  }
  if (!isPlainObject(body)) return { error: 'rejected' };
  for (const key of Object.keys(body)) {
    if (key !== 'company_id') return { error: 'rejected' };
  }
  const companyId = typeof body.company_id === 'string' ? body.company_id.toLowerCase() : '';
  if (!UUID_RE.test(companyId)) return { error: 'rejected' };
  return { companyId };
}

function diagnostic(errorCode) {
  return {
    app_identity: 'indeterminate',
    instagram_basic: 'indeterminate',
    instagram_manage_messages: 'indeterminate',
    instagram_manage_comments: 'indeterminate',
    expected_account: 'indeterminate',
    unified_login_read: 'indeterminate',
    webhook_subscription: 'indeterminate',
    error_code: errorCode,
  };
}

async function loadCredential(svc, companyId) {
  return svc
    .from('instagram_byo_company_credentials')
    .select('meta_app_id, app_secret_enc, suat_enc')
    .eq('company_id', companyId)
    .maybeSingle();
}

async function loadAccountIds(svc, companyId) {
  return svc
    .from('instagram_byo_poc_accounts')
    .select('instagram_account_id')
    .eq('company_id', companyId);
}

export async function handleByoDiscoveryDiagnostic(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  const parsed = parseCompany(req);
  if (parsed.error === 'payload_too_large') return send(res, 413, { ok: false, error: 'payload_too_large' });
  if (parsed.error) return send(res, 400, { ok: false, error: 'rejected' });

  const gate = evaluateByoPocAccess({ requestedCompanyId: parsed.companyId });
  if (!gate.ok) return send(res, gate.status, { ok: false, error: gate.error });

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return send(res, 503, diagnostic('unavailable'));
  }

  const auth = await authorizeByoCredentialWrite(req, svc, gate.companyId);
  if (!auth.ok) return send(res, auth.status, { ok: false, error: auth.error });

  const loaded = await loadCredential(svc, gate.companyId);
  if (loaded.error) return send(res, 503, diagnostic('unavailable'));
  if (!loaded.data) return send(res, 404, diagnostic('not_found'));

  const accounts = await loadAccountIds(svc, gate.companyId);
  if (accounts.error || !Array.isArray(accounts.data)) return send(res, 503, diagnostic('unavailable'));
  const rows = accounts.data;
  const onlyId = rows.length === 1 ? rows[0]?.instagram_account_id : null;
  const expectedAccountIds = typeof onlyId === 'string'
    ? [onlyId]
    : (rows.length === 0 ? [] : ['multiple', 'multiple']);

  let appSecret;
  let suat;
  try {
    appSecret = decryptByoSecret(loaded.data.app_secret_enc, {
      companyId: gate.companyId,
      field: 'app_secret',
    });
    suat = decryptByoSecret(loaded.data.suat_enc, {
      companyId: gate.companyId,
      field: 'suat',
    });
  } catch {
    return send(res, 503, diagnostic('unavailable'));
  }

  const report = await readUnifiedLoginDiagnostic({
    appId: loaded.data.meta_app_id,
    appSecret,
    suat,
    expectedAccountIds,
  });
  return send(res, 200, report);
}
