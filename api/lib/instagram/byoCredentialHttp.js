// =============================================================================
// byoCredentialHttp — orquestração dos POST de credenciais BYO
//
// Não é rota. Liga gate, autorização, validação, cifra, fingerprint e a RPC.
// Segredos não entram em log nem na resposta. Revoke não usa a chave.
// =============================================================================

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { authorizeByoCredentialWrite } from './byoCredentialAuth.js';
import { fingerprintByoCredentialRequest } from './byoCredentialFingerprint.js';
import { validateByoCredentialBody, validateByoRevokeBody } from './byoCredentialPayload.js';
import { evaluateByoPocAccess } from './byoPocGate.js';
import { encryptByoSecret } from './byoTokenCrypto.js';

const BODY_LIMIT = 18432;
const ORIGIN_RE = /^prj_[A-Za-z0-9]{8,64}$/;
const SUCCESS = new Set(['applied', 'idempotent', 'already_revoked']);
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

function readHeader(req, name) {
  const headers = req?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

function acceptsJson(header) {
  if (typeof header !== 'string') return false;
  const parts = header.split(';').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts[0] !== 'application/json') return false;
  return parts.length === 1 || (parts.length === 2 && parts[1] === 'charset=utf-8');
}

function contentLengthExceeds(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  const limit = String(BODY_LIMIT);
  if (value.length !== limit.length) return value.length > limit.length;
  return value > limit;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

function parseBody(req) {
  const raw = req.body;
  if (raw == null || raw === '') return { error: 'invalid_json' };
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > BODY_LIMIT) return { error: 'payload_too_large' };
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

function originFor(operation) {
  if (operation !== 'set' && operation !== 'replace_app') return null;
  const project = process.env.VERCEL_PROJECT_ID;
  if (typeof project !== 'string' || !ORIGIN_RE.test(project)) return null;
  return project;
}

function encryptOperation(value, companyId) {
  const needsApp = value.operation === 'set'
    || value.operation === 'replace_app'
    || value.operation === 'rotate_secret';
  const needsSuat = value.operation === 'set'
    || value.operation === 'replace_app'
    || value.operation === 'rotate_suat';
  return {
    appSecretEnc: needsApp
      ? encryptByoSecret(value.appSecret, { companyId, field: 'app_secret' })
      : null,
    suatEnc: needsSuat
      ? encryptByoSecret(value.suat, { companyId, field: 'suat' })
      : null,
  };
}

function mapRpc(data, companyId) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const { result } = data;
  if (typeof result !== 'string') return null;
  if (SUCCESS.has(result)) {
    if (typeof data.validation_status !== 'string' || data.validation_status.length === 0) return null;
    if (
      typeof data.credential_version !== 'number'
      || !Number.isInteger(data.credential_version)
      || data.credential_version < 1
    ) return null;
    if (typeof data.configured !== 'boolean' || typeof data.stale !== 'boolean') return null;
    return {
      status: 200,
      body: {
        ok: true,
        result,
        company_id: companyId,
        validation_status: data.validation_status,
        credential_version: data.credential_version,
        configured: data.configured,
        stale: data.stale,
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(RPC_STATUS, result)) {
    return { status: RPC_STATUS[result], body: { error: result } };
  }
  return null;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {'credentials' | 'revoke'} mode
 */
export async function handleByoCredentialPost(req, res, mode) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (process.env.INSTAGRAM_BYO_POC_ENABLED !== 'true') {
    return send(res, 404, { error: 'not_found' });
  }
  if (req?.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }
  if (mode !== 'credentials' && mode !== 'revoke') {
    return send(res, 400, { error: 'rejected' });
  }
  if (!acceptsJson(readHeader(req, 'content-type'))) {
    return send(res, 415, { error: 'unsupported_media_type' });
  }
  if (contentLengthExceeds(readHeader(req, 'content-length'))) {
    return send(res, 413, { error: 'payload_too_large' });
  }

  const parsed = parseBody(req);
  if (parsed.error === 'payload_too_large') {
    return send(res, 413, { error: 'payload_too_large' });
  }
  if (parsed.error) return send(res, 400, { error: 'invalid_json' });

  const requested = typeof parsed.body.company_id === 'string' ? parsed.body.company_id : '';
  const gate = evaluateByoPocAccess({ requestedCompanyId: requested });
  if (!gate.ok) return send(res, gate.status, { error: gate.error });

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }

  let auth;
  try {
    auth = await authorizeByoCredentialWrite(req, svc, gate.companyId);
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }
  if (!auth.ok) return send(res, auth.status, { error: auth.error });
  if (typeof auth.userId !== 'string' || auth.userId.length === 0) {
    return send(res, 503, { error: 'unavailable' });
  }

  const validated = mode === 'revoke'
    ? validateByoRevokeBody(parsed.body)
    : validateByoCredentialBody(parsed.body);
  if (!validated.ok || validated.value.companyId !== gate.companyId) {
    return send(res, 400, { error: 'rejected' });
  }

  let sealed;
  let fingerprint;
  try {
    sealed = encryptOperation(validated.value, gate.companyId);
    fingerprint = fingerprintByoCredentialRequest(validated.value);
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }

  const params = {
    p_company_id: gate.companyId,
    p_actor_user_id: auth.userId,
    p_operation: validated.value.operation,
    p_expected_version: validated.value.expectedVersion == null ? null : validated.value.expectedVersion,
    p_request_id: validated.value.requestId,
    p_request_fingerprint: fingerprint,
    p_meta_app_id: validated.value.metaAppId ?? null,
    p_app_secret_enc: sealed.appSecretEnc,
    p_suat_enc: sealed.suatEnc,
    p_origin_project_id: originFor(validated.value.operation),
  };

  let rpc;
  try {
    rpc = await svc.rpc('instagram_byo_apply_credentials', params);
  } catch {
    return send(res, 503, { error: 'unavailable' });
  }
  if (!rpc || rpc.error) return send(res, 503, { error: 'unavailable' });

  const mapped = mapRpc(rpc.data, gate.companyId);
  if (!mapped) return send(res, 503, { error: 'unavailable' });
  return send(res, mapped.status, mapped.body);
}
