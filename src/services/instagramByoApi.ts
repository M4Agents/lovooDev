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

  return {
    configured: value.configured,
    validation_status: value.validation_status,
    meta_app_id: value.meta_app_id,
    validated_at: value.validated_at,
    revoked_at: value.revoked_at,
    credential_version: version,
    validation_error_code: value.validation_error_code,
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
