import { supabase } from '../lib/supabase';
import type { ByoStatusCredentials } from './instagramByoApi';

const CREDENTIALS_PATH = '/api/instagram/byo-poc/credentials';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_ID_RE = /^[0-9]{5,32}$/;
const MAX_SECRET_BYTES = 4096;
const MAX_VERSION = 2147483647;
const ACTIVE_STATUS = new Set(['saved', 'pending', 'valid', 'failed']);

export type ByoReplaceMode =
  | { kind: 'ready'; expectedVersion: number }
  | { kind: 'blocked' };

export type ByoReplaceInput = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
  metaAppId: string;
  appSecret: string;
  suat: string;
};

export type ByoRotateSecretInput = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
  appSecret: string;
};

export type ByoReplaceSuccess = {
  ok: true;
  result: 'applied' | 'idempotent' | 'already_revoked';
  company_id: string;
  validation_status: string;
  credential_version: number;
  configured: boolean;
  stale: boolean;
};

export type ByoReplaceResult =
  | { kind: 'ok'; body: ByoReplaceSuccess }
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

export type ByoRotateSecretResult = ByoReplaceResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function validVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_VERSION;
}

function resolveActiveCredentialMode(credentials: ByoStatusCredentials): ByoReplaceMode {
  if (credentials.configured !== true) return { kind: 'blocked' };
  if (!ACTIVE_STATUS.has(credentials.validation_status)) return { kind: 'blocked' };
  const version = credentials.credential_version;
  if (typeof version !== 'number' || !validVersion(version)) return { kind: 'blocked' };
  return { kind: 'ready', expectedVersion: version };
}

export function resolveByoReplaceMode(credentials: ByoStatusCredentials): ByoReplaceMode {
  return resolveActiveCredentialMode(credentials);
}

export function resolveByoRotateSecretMode(credentials: ByoStatusCredentials): ByoReplaceMode {
  return resolveActiveCredentialMode(credentials);
}

function rotateSecretPayload(input: ByoRotateSecretInput): Record<string, string | number> | null {
  if (!UUID_RE.test(input.companyId) || !UUID_RE.test(input.requestId)) return null;
  if (!validVersion(input.expectedVersion)) return null;
  if (!validSecret(input.appSecret)) return null;
  return {
    company_id: input.companyId.toLowerCase(),
    request_id: input.requestId.toLowerCase(),
    operation: 'rotate_secret',
    expected_version: input.expectedVersion,
    app_secret: input.appSecret,
  };
}

function replacePayload(input: ByoReplaceInput): Record<string, string | number> | null {
  if (!UUID_RE.test(input.companyId) || !UUID_RE.test(input.requestId)) return null;
  if (!validVersion(input.expectedVersion)) return null;
  if (!APP_ID_RE.test(input.metaAppId)) return null;
  if (!validSecret(input.appSecret) || !validSecret(input.suat)) return null;
  return {
    company_id: input.companyId.toLowerCase(),
    request_id: input.requestId.toLowerCase(),
    operation: 'replace_app',
    expected_version: input.expectedVersion,
    meta_app_id: input.metaAppId,
    app_secret: input.appSecret,
    suat: input.suat,
  };
}

function projectSuccess(value: unknown, companyId: string): ByoReplaceSuccess | null {
  if (!isRecord(value) || value.ok !== true || value.company_id !== companyId) return null;
  if (value.result !== 'applied' && value.result !== 'idempotent' && value.result !== 'already_revoked') {
    return null;
  }
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

async function postByoCredentials(
  payload: Record<string, string | number> | null,
): Promise<ByoReplaceResult> {
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
    const success = projectSuccess(body, payload.company_id as string);
    if (!success) return { kind: 'temporary' };
    return { kind: 'ok', body: success };
  } catch {
    return { kind: 'temporary' };
  }
}

export function replaceInstagramByoApp(input: ByoReplaceInput): Promise<ByoReplaceResult> {
  return postByoCredentials(replacePayload(input));
}

export function rotateInstagramByoSecret(input: ByoRotateSecretInput): Promise<ByoRotateSecretResult> {
  return postByoCredentials(rotateSecretPayload(input));
}
