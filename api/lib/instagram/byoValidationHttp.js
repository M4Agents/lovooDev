// Validação e associação BYO. O frontend não reenvia segredo.
// A conta só é gravada se a descoberta atual da Meta a devolver.

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { authorizeByoCredentialWrite } from './byoCredentialAuth.js';
import { inspectByoSystemUser } from './byoMetaClient.js';
import { evaluateByoPocAccess } from './byoPocGate.js';
import { decryptByoSecret } from './byoTokenCrypto.js';
import { recordByoTokenInvalid } from './byoValidationDiagnostic.js';
import { fingerprintByoValidation } from './byoValidationFingerprint.js';

const BODY_LIMIT = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_RE = /^[0-9]{5,32}$/;
const MAX_VERSION = 2147483647;
const VALIDATABLE = new Set(['saved', 'pending', 'valid', 'failed']);
const RPC_STATUS = {
  rejected: 400,
  not_found: 404,
  conflict: 409,
  request_reused: 409,
  unavailable: 503,
};

function send(res, status, body) {
  res.status(status).json(body);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseBody(req, allowed) {
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
    if (!allowed.has(key)) return { error: 'rejected' };
  }
  const companyId = typeof body.company_id === 'string' ? body.company_id.toLowerCase() : '';
  const requestId = typeof body.request_id === 'string' ? body.request_id.toLowerCase() : '';
  const version = body.expected_version;
  if (!UUID_RE.test(companyId) || !UUID_RE.test(requestId)) return { error: 'rejected' };
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
    return { error: 'rejected' };
  }
  const value = { companyId, requestId, expectedVersion: version };
  if (allowed.has('instagram_account_id')) {
    if (typeof body.instagram_account_id !== 'string' || !ACCOUNT_RE.test(body.instagram_account_id)) {
      return { error: 'rejected' };
    }
    value.instagramAccountId = body.instagram_account_id;
  }
  return { value };
}

function publicAccounts(accounts) {
  return accounts.map((account) => ({
    instagram_account_id: account.instagram_account_id,
    instagram_username: account.instagram_username,
  }));
}

async function loadCredential(svc, companyId) {
  return svc
    .from('instagram_byo_company_credentials')
    .select('meta_app_id, app_secret_enc, suat_enc, validation_status, credential_version')
    .eq('company_id', companyId)
    .maybeSingle();
}

function versionConflict(row, expectedVersion) {
  return !row
    || row.credential_version !== expectedVersion
    || !VALIDATABLE.has(row.validation_status);
}

function mapRpc(data, companyId) {
  if (!data || typeof data !== 'object' || typeof data.result !== 'string') return null;
  if (data.result === 'applied' || data.result === 'idempotent') {
    if (typeof data.validation_status !== 'string') return null;
    if (typeof data.credential_version !== 'number' || !Number.isInteger(data.credential_version)) return null;
    return {
      status: 200,
      body: {
        ok: true,
        result: data.result,
        company_id: companyId,
        validation_status: data.validation_status,
        credential_version: data.credential_version,
        validation_error_code: data.validation_error_code ?? null,
      },
    };
  }
  const status = RPC_STATUS[data.result];
  if (!status) return null;
  return { status, body: { ok: false, error: data.result } };
}

export async function handleByoValidationPost(req, res, mode) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  const allowed = new Set(['company_id', 'request_id', 'expected_version']);
  if (mode === 'associate') allowed.add('instagram_account_id');
  const parsed = parseBody(req, allowed);
  if (parsed.error === 'payload_too_large') return send(res, 413, { ok: false, error: 'payload_too_large' });
  if (parsed.error) return send(res, 400, { ok: false, error: 'rejected' });

  const gate = evaluateByoPocAccess({ requestedCompanyId: parsed.value.companyId });
  if (!gate.ok) return send(res, gate.status, { ok: false, error: gate.error });

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return send(res, 503, { ok: false, error: 'unavailable' });
  }

  const auth = await authorizeByoCredentialWrite(req, svc, gate.companyId);
  if (!auth.ok) return send(res, auth.status, { ok: false, error: auth.error });

  const loaded = await loadCredential(svc, gate.companyId);
  if (loaded.error) return send(res, 503, { ok: false, error: 'unavailable' });
  if (!loaded.data) return send(res, 404, { ok: false, error: 'not_found' });
  if (versionConflict(loaded.data, parsed.value.expectedVersion)) {
    return send(res, 409, { ok: false, error: 'conflict' });
  }
  if (mode === 'associate' && loaded.data.validation_status !== 'valid') {
    return send(res, 409, { ok: false, error: 'conflict' });
  }

  let appSecret;
  let suat;
  try {
    appSecret = decryptByoSecret(loaded.data.app_secret_enc, { companyId: gate.companyId, field: 'app_secret' });
    suat = decryptByoSecret(loaded.data.suat_enc, { companyId: gate.companyId, field: 'suat' });
  } catch {
    return send(res, 503, { ok: false, error: 'unavailable' });
  }

  const inspection = await inspectByoSystemUser({
    appId: loaded.data.meta_app_id,
    appSecret,
    suat,
  });
  if (!inspection.ok && !inspection.definitive) {
    return send(res, 503, { ok: false, error: 'meta_unavailable' });
  }
  if (!inspection.ok && inspection.code === 'token_invalid') {
    recordByoTokenInvalid({
      requestId: parsed.value.requestId,
      companyId: gate.companyId,
      diagnostic: inspection.diagnostic,
    });
  }

  if (mode === 'associate') {
    if (!inspection.ok) return send(res, 409, { ok: false, error: 'conflict' });
    const match = inspection.accounts.find((account) => (
      account.instagram_account_id === parsed.value.instagramAccountId
    ));
    if (!match) return send(res, 422, { ok: false, error: 'account_not_discovered' });

    const fingerprint = fingerprintByoValidation({
      operation: 'associate_account',
      companyId: gate.companyId,
      requestId: parsed.value.requestId,
      expectedVersion: parsed.value.expectedVersion,
      instagramAccountId: match.instagram_account_id,
    });
    const rpc = await svc.rpc('instagram_byo_associate_account', {
      p_company_id: gate.companyId,
      p_actor_user_id: auth.userId,
      p_request_id: parsed.value.requestId,
      p_expected_version: parsed.value.expectedVersion,
      p_request_fingerprint: fingerprint,
      p_instagram_account_id: match.instagram_account_id,
      p_instagram_username: match.instagram_username,
      p_system_user_id: inspection.systemUserId,
      p_scopes: inspection.scopes,
    });
    if (rpc.error) return send(res, 503, { ok: false, error: 'unavailable' });
    const mapped = mapRpc(rpc.data, gate.companyId);
    if (!mapped) return send(res, 503, { ok: false, error: 'unavailable' });
    if (mapped.status === 200) {
      mapped.body.account = {
        instagram_account_id: match.instagram_account_id,
        instagram_username: match.instagram_username,
      };
    }
    return send(res, mapped.status, mapped.body);
  }

  const nextStatus = inspection.ok ? 'valid' : 'failed';
  const errorCode = inspection.ok ? null : inspection.code;
  const fingerprint = fingerprintByoValidation({
    operation: 'validate',
    companyId: gate.companyId,
    requestId: parsed.value.requestId,
    expectedVersion: parsed.value.expectedVersion,
  });
  const rpc = await svc.rpc('instagram_byo_record_validation', {
    p_company_id: gate.companyId,
    p_actor_user_id: auth.userId,
    p_request_id: parsed.value.requestId,
    p_expected_version: parsed.value.expectedVersion,
    p_request_fingerprint: fingerprint,
    p_next_status: nextStatus,
    p_error_code: errorCode,
  });
  if (rpc.error) return send(res, 503, { ok: false, error: 'unavailable' });
  const mapped = mapRpc(rpc.data, gate.companyId);
  if (!mapped) return send(res, 503, { ok: false, error: 'unavailable' });
  if (mapped.status === 200) {
    mapped.body.accounts = inspection.ok ? publicAccounts(inspection.accounts) : [];
    if (!inspection.ok) mapped.body.validation_error_code = inspection.code;
  }
  return send(res, mapped.status, mapped.body);
}
