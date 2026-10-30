import { supabase } from '../lib/supabase';

const STATUS_PATH = '/api/instagram/byo-poc/status';

export type ByoStatusCredentials = {
  configured: boolean;
  validation_status: string;
  meta_app_id: string | null;
  validated_at: string | null;
  revoked_at: string | null;
  credential_version: number | null;
  validation_error_code: string | null;
  webhook_route_id?: string | null;
  webhook_enabled?: boolean;
  webhook_verify_configured?: boolean;
};

export type ByoStatusAccount = {
  id: string;
  company_id: string;
  instagram_account_id: string;
  system_user_id: string | null;
  instagram_username: string | null;
  encryption_version: number;
  scopes: string[];
  status: 'poc_enabled' | 'poc_disabled';
  status_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ByoStatusPayload = {
  ok: true;
  company_id: string;
  credentials: ByoStatusCredentials;
  account_status: 'not_connected' | 'poc_enabled' | 'poc_disabled';
  accounts: ByoStatusAccount[];
};

export type ByoStatusResult =
  | { kind: 'ok'; status: ByoStatusPayload }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'temporary' }
  | { kind: 'cancelled' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function projectCredentials(value: unknown): ByoStatusCredentials | null {
  if (!isRecord(value)) return null;
  if (typeof value.configured !== 'boolean') return null;
  if (typeof value.validation_status !== 'string') return null;
  if (!isNullableString(value.meta_app_id)) return null;
  if (!isNullableString(value.validated_at)) return null;
  if (!isNullableString(value.revoked_at)) return null;
  if (!isNullableString(value.validation_error_code)) return null;
  const version = value.credential_version;
  if (!(version === null || (typeof version === 'number' && Number.isInteger(version)))) return null;
  const routeId = value.webhook_route_id;
  if (!(routeId === undefined || routeId === null || (typeof routeId === 'string' && /^[0-9a-f]{64}$/.test(routeId)))) {
    return null;
  }
  if (value.webhook_enabled !== undefined && typeof value.webhook_enabled !== 'boolean') return null;
  if (value.webhook_verify_configured !== undefined && typeof value.webhook_verify_configured !== 'boolean') return null;

  return {
    configured: value.configured,
    validation_status: value.validation_status,
    meta_app_id: value.meta_app_id,
    validated_at: value.validated_at,
    revoked_at: value.revoked_at,
    credential_version: version,
    validation_error_code: value.validation_error_code,
    webhook_route_id: typeof routeId === 'string' ? routeId : null,
    webhook_enabled: value.webhook_enabled === true,
    webhook_verify_configured: value.webhook_verify_configured === true,
  };
}

function projectScopes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value.slice();
}

function projectAccount(value: unknown): ByoStatusAccount | null {
  if (!isRecord(value)) return null;
  const scopes = projectScopes(value.scopes);
  const version = value.encryption_version;
  if (
    typeof value.id !== 'string'
    || typeof value.company_id !== 'string'
    || typeof value.instagram_account_id !== 'string'
    || !isNullableString(value.system_user_id)
    || !isNullableString(value.instagram_username)
    || typeof version !== 'number'
    || !Number.isInteger(version)
    || scopes === null
    || (value.status !== 'poc_enabled' && value.status !== 'poc_disabled')
    || !isNullableString(value.status_reason)
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    company_id: value.company_id,
    instagram_account_id: value.instagram_account_id,
    system_user_id: value.system_user_id,
    instagram_username: value.instagram_username,
    encryption_version: version,
    scopes,
    status: value.status,
    status_reason: value.status_reason,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function projectPayload(value: unknown, companyId: string): ByoStatusPayload | null {
  if (!isRecord(value) || value.ok !== true || value.company_id !== companyId) return null;
  const credentials = projectCredentials(value.credentials);
  const accountStatus = value.account_status;
  if (!credentials) return null;
  if (
    accountStatus !== 'not_connected'
    && accountStatus !== 'poc_enabled'
    && accountStatus !== 'poc_disabled'
  ) {
    return null;
  }
  if (!Array.isArray(value.accounts)) return null;

  const accounts: ByoStatusAccount[] = [];
  for (const item of value.accounts) {
    const account = projectAccount(item);
    if (!account) return null;
    accounts.push(account);
  }

  return {
    ok: true,
    company_id: companyId,
    credentials,
    account_status: accountStatus,
    accounts,
  };
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

export async function getInstagramByoStatus(
  companyId: string,
  signal?: AbortSignal,
): Promise<ByoStatusResult> {
  if (signal?.aborted) return { kind: 'cancelled' };

  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? '';
  } catch {
    return { kind: 'temporary' };
  }
  if (!token) return { kind: 'denied' };

  let response: Response;
  try {
    const url = `${STATUS_PATH}?company_id=${encodeURIComponent(companyId)}`;
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    return isAbort(error, signal) ? { kind: 'cancelled' } : { kind: 'temporary' };
  }

  if (response.status === 404) return { kind: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status === 500) return { kind: 'temporary' };
  if (response.status !== 200) return { kind: 'temporary' };

  try {
    const body: unknown = await response.json();
    const status = projectPayload(body, companyId);
    if (!status) return { kind: 'temporary' };
    return { kind: 'ok', status };
  } catch {
    return { kind: 'temporary' };
  }
}

const CREDENTIALS_PATH = '/api/instagram/byo-poc/credentials';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_ID_RE = /^[0-9]{5,32}$/;
const MAX_SECRET_BYTES = 4096;
const MAX_VERSION = 2147483647;

export type ByoSetMode =
  | { kind: 'initial' }
  | { kind: 'revoked'; expectedVersion: number }
  | { kind: 'blocked' };

export type ByoSetInput = {
  companyId: string;
  requestId: string;
  metaAppId: string;
  appSecret: string;
  suat: string;
  expectedVersion?: number;
};

export type ByoSetSuccess = {
  ok: true;
  result: 'applied' | 'idempotent' | 'already_revoked';
  company_id: string;
  validation_status: string;
  credential_version: number;
  configured: boolean;
  stale: boolean;
};

export type ByoSetResult =
  | { kind: 'ok'; body: ByoSetSuccess }
  | { kind: 'rejected' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'conflict' }
  | { kind: 'request_reused' }
  | { kind: 'too_large' }
  | { kind: 'unsupported_media' }
  | { kind: 'service_unavailable' }
  | { kind: 'network' }
  | { kind: 'session_unavailable' }
  | { kind: 'temporary' };

export function resolveByoSetMode(credentials: ByoStatusCredentials): ByoSetMode {
  if (credentials.configured) return { kind: 'blocked' };
  if (credentials.validation_status === 'revoked') {
    const version = credentials.credential_version;
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= MAX_VERSION) {
      return { kind: 'revoked', expectedVersion: version };
    }
    return { kind: 'blocked' };
  }
  if (credentials.validation_status === 'not_configured' && credentials.credential_version == null) {
    return { kind: 'initial' };
  }
  return { kind: 'blocked' };
}

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = value.charCodeAt(index + 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function validSecret(value: string): boolean {
  if (!wellFormed(value) || value.includes('\u0000')) return false;
  const size = new TextEncoder().encode(value).length;
  return size >= 1 && size <= MAX_SECRET_BYTES;
}

function setPayload(input: ByoSetInput): Record<string, string | number> | null {
  if (!UUID_RE.test(input.companyId) || !UUID_RE.test(input.requestId)) return null;
  if (!APP_ID_RE.test(input.metaAppId)) return null;
  if (!validSecret(input.appSecret) || !validSecret(input.suat)) return null;
  const payload: Record<string, string | number> = {
    company_id: input.companyId.toLowerCase(),
    request_id: input.requestId.toLowerCase(),
    operation: 'set',
    meta_app_id: input.metaAppId,
    app_secret: input.appSecret,
    suat: input.suat,
  };
  if (input.expectedVersion === undefined) return payload;
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > MAX_VERSION) {
    return null;
  }
  payload.expected_version = input.expectedVersion;
  return payload;
}

function projectSetSuccess(value: unknown, companyId: string): ByoSetSuccess | null {
  if (!isRecord(value) || value.ok !== true || value.company_id !== companyId) return null;
  if (value.result !== 'applied' && value.result !== 'idempotent' && value.result !== 'already_revoked') return null;
  if (typeof value.validation_status !== 'string' || value.validation_status.length === 0) return null;
  const version = value.credential_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (typeof value.configured !== 'boolean' || typeof value.stale !== 'boolean') return null;
  return {
    ok: true,
    result: value.result,
    company_id: companyId,
    validation_status: value.validation_status,
    credential_version: version,
    configured: value.configured,
    stale: value.stale,
  };
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === 'string') return body.error;
  } catch {
    return null;
  }
  return null;
}

export async function setInstagramByoCredentials(input: ByoSetInput): Promise<ByoSetResult> {
  const payload = setPayload(input);
  if (!payload) return { kind: 'rejected' };

  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? '';
  } catch {
    return { kind: 'session_unavailable' };
  }
  if (!token) return { kind: 'session_unavailable' };

  let response: Response;
  try {
    response = await fetch(CREDENTIALS_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { kind: 'network' };
  }

  if (response.status === 400) return { kind: 'rejected' };
  if (response.status === 401) return { kind: 'unauthorized' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404) return { kind: 'unavailable' };
  if (response.status === 413) return { kind: 'too_large' };
  if (response.status === 415) return { kind: 'unsupported_media' };
  if (response.status === 503) return { kind: 'service_unavailable' };
  if (response.status === 409) {
    const code = await errorCode(response);
    if (code === 'conflict') return { kind: 'conflict' };
    if (code === 'request_reused') return { kind: 'request_reused' };
    return { kind: 'temporary' };
  }
  if (response.status !== 200) return { kind: 'temporary' };

  try {
    const body: unknown = await response.json();
    const success = projectSetSuccess(body, payload.company_id as string);
    if (!success) return { kind: 'temporary' };
    return { kind: 'ok', body: success };
  } catch {
    return { kind: 'temporary' };
  }
}
