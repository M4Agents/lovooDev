import { supabase } from '../lib/supabase';

const VALIDATE_PATH = '/api/instagram/byo-poc/validate';
const ACCOUNTS_PATH = '/api/instagram/byo-poc/accounts';

export type ByoDiscoveredAccount = {
  instagram_account_id: string;
  instagram_username: string | null;
};

export type ByoValidationCallResult =
  | {
    kind: 'ok';
    validationStatus: string;
    credentialVersion: number;
    errorCode: string | null;
    accounts: ByoDiscoveredAccount[];
    account: ByoDiscoveredAccount | null;
  }
  | { kind: 'conflict' | 'denied' | 'temporary' | 'not_discovered' | 'rejected' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectAccount(value: unknown): ByoDiscoveredAccount | null {
  if (!isRecord(value) || typeof value.instagram_account_id !== 'string') return null;
  if (!(value.instagram_username === null || typeof value.instagram_username === 'string')) return null;
  return {
    instagram_account_id: value.instagram_account_id,
    instagram_username: value.instagram_username,
  };
}

async function postJson(path: string, body: Record<string, unknown>): Promise<ByoValidationCallResult> {
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
    response = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'temporary' };
  }

  if (response.status === 409) return { kind: 'conflict' };
  if (response.status === 422) return { kind: 'not_discovered' };
  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status === 400) return { kind: 'rejected' };
  if (response.status !== 200) return { kind: 'temporary' };

  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.ok !== true) return { kind: 'temporary' };
    if (typeof payload.validation_status !== 'string') return { kind: 'temporary' };
    if (typeof payload.credential_version !== 'number' || !Number.isInteger(payload.credential_version)) {
      return { kind: 'temporary' };
    }
    const accounts = Array.isArray(payload.accounts)
      ? payload.accounts.map(projectAccount).filter((item): item is ByoDiscoveredAccount => item !== null)
      : [];
    return {
      kind: 'ok',
      validationStatus: payload.validation_status,
      credentialVersion: payload.credential_version,
      errorCode: typeof payload.validation_error_code === 'string' ? payload.validation_error_code : null,
      accounts,
      account: projectAccount(payload.account),
    };
  } catch {
    return { kind: 'temporary' };
  }
}

export function validateInstagramByoWithMeta(input: {
  companyId: string;
  requestId: string;
  expectedVersion: number;
}) {
  return postJson(VALIDATE_PATH, {
    company_id: input.companyId,
    request_id: input.requestId,
    expected_version: input.expectedVersion,
  });
}

export function associateInstagramByoAccount(input: {
  companyId: string;
  requestId: string;
  expectedVersion: number;
  instagramAccountId: string;
}) {
  return postJson(ACCOUNTS_PATH, {
    company_id: input.companyId,
    request_id: input.requestId,
    expected_version: input.expectedVersion,
    instagram_account_id: input.instagramAccountId,
  });
}
