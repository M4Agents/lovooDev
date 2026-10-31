import { supabase } from '../lib/supabase';

const PATH = '/api/instagram/modality';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[0-9]{5,32}$/;

export type ModalityName = 'official' | 'byo';

export type ModalityTarget = {
  eligible: boolean;
  block_reason: string | null;
};

export type ModalityBasis = 'registered' | 'compatibility' | 'none';

export type ModalityAccount = {
  instagram_account_id: string;
  operational_mode: ModalityName | null;
  mode_registered: boolean;
  mode_basis: ModalityBasis;
  official_receive_supported: boolean;
  official_connection: { id: string; status: string; username: string | null } | null;
  byo_account: {
    id: string;
    status: string;
    username: string | null;
    direct_ingest_enabled: boolean;
  } | null;
  direct_ingest_enabled: boolean;
  send_supported: boolean;
  byo_send_supported: false;
  targets: { official: ModalityTarget; byo: ModalityTarget };
};

export type ModalityState = {
  ok: true;
  company_id: string;
  switch_available: boolean;
  accounts: ModalityAccount[];
};

export type ModalityReadResult =
  | { kind: 'ok'; state: ModalityState }
  | { kind: 'denied' }
  | { kind: 'temporary' }
  | { kind: 'cancelled' };

export type ModalitySwitchInput = {
  companyId: string;
  instagramAccountId: string;
  targetMode: ModalityName;
  officialConnectionId: string;
  byoAccountId: string;
  confirmed: true;
};

export type ModalitySwitchResult =
  | { kind: 'ok'; reason: 'switched' | 'already_applied'; targetMode: ModalityName; movedCount: number }
  | { kind: 'confirmation_required' }
  | { kind: 'rejected' }
  | { kind: 'denied' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'temporary' }
  | { kind: 'cancelled' };

const BLOCKED = new Set([
  'company_inactive',
  'identity_mismatch',
  'ambiguous_instagram_account',
  'destination_not_ready',
  'modality_switch_disabled',
  'company_mismatch',
  'no_official_connection',
  'no_byo_account',
  'mode_conflict',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

async function sessionToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

function projectTarget(value: unknown): ModalityTarget | null {
  if (!isRecord(value) || typeof value.eligible !== 'boolean') return null;
  if (!(value.block_reason === null || typeof value.block_reason === 'string')) return null;
  return { eligible: value.eligible, block_reason: value.block_reason };
}

function projectAccount(value: unknown): ModalityAccount | null {
  if (!isRecord(value) || !ACCOUNT_ID.test(String(value.instagram_account_id ?? ''))) return null;
  if (value.operational_mode !== 'official' && value.operational_mode !== 'byo' && value.operational_mode !== null) {
    return null;
  }
  if (typeof value.mode_registered !== 'boolean') return null;
  if (value.mode_basis !== 'registered' && value.mode_basis !== 'compatibility' && value.mode_basis !== 'none') {
    return null;
  }
  if (typeof value.official_receive_supported !== 'boolean') return null;
  if (typeof value.direct_ingest_enabled !== 'boolean') return null;
  if (typeof value.send_supported !== 'boolean' || value.byo_send_supported !== false) return null;
  if (!isRecord(value.targets)) return null;
  const official = projectTarget(value.targets.official);
  const byo = projectTarget(value.targets.byo);
  if (!official || !byo) return null;

  let connection: ModalityAccount['official_connection'] = null;
  if (value.official_connection !== null) {
    if (!isRecord(value.official_connection) || !UUID.test(String(value.official_connection.id ?? ''))) return null;
    if (typeof value.official_connection.status !== 'string') return null;
    connection = {
      id: String(value.official_connection.id),
      status: value.official_connection.status,
      username: typeof value.official_connection.username === 'string' ? value.official_connection.username : null,
    };
  }

  let account: ModalityAccount['byo_account'] = null;
  if (value.byo_account !== null) {
    if (!isRecord(value.byo_account) || !UUID.test(String(value.byo_account.id ?? ''))) return null;
    if (typeof value.byo_account.direct_ingest_enabled !== 'boolean') return null;
    account = {
      id: String(value.byo_account.id),
      status: typeof value.byo_account.status === 'string' ? value.byo_account.status : '',
      username: typeof value.byo_account.username === 'string' ? value.byo_account.username : null,
      direct_ingest_enabled: value.byo_account.direct_ingest_enabled,
    };
  }

  return {
    instagram_account_id: String(value.instagram_account_id),
    operational_mode: value.operational_mode,
    mode_registered: value.mode_registered,
    mode_basis: value.mode_basis,
    official_receive_supported: value.official_receive_supported,
    official_connection: connection,
    byo_account: account,
    direct_ingest_enabled: value.direct_ingest_enabled,
    send_supported: value.send_supported,
    byo_send_supported: false,
    targets: { official, byo },
  };
}

export async function getInstagramModality(
  companyId: string,
  signal?: AbortSignal,
): Promise<ModalityReadResult> {
  if (signal?.aborted) return { kind: 'cancelled' };
  const token = await sessionToken();
  if (!token) return { kind: 'denied' };

  let response: Response;
  try {
    response = await fetch(`${PATH}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    return isAbort(error, signal) ? { kind: 'cancelled' } : { kind: 'temporary' };
  }

  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status !== 200) return { kind: 'temporary' };

  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || body.ok !== true || body.company_id !== companyId || !Array.isArray(body.accounts)) {
      return { kind: 'temporary' };
    }
    if (typeof body.switch_available !== 'boolean') return { kind: 'temporary' };
    const accounts: ModalityAccount[] = [];
    for (const item of body.accounts) {
      const account = projectAccount(item);
      if (!account) return { kind: 'temporary' };
      accounts.push(account);
    }
    return {
      kind: 'ok',
      state: { ok: true, company_id: companyId, switch_available: body.switch_available, accounts },
    };
  } catch {
    return { kind: 'temporary' };
  }
}

export async function switchInstagramModality(
  input: ModalitySwitchInput,
  signal?: AbortSignal,
): Promise<ModalitySwitchResult> {
  if (input.confirmed !== true) return { kind: 'confirmation_required' };
  if (signal?.aborted) return { kind: 'cancelled' };
  const token = await sessionToken();
  if (!token) return { kind: 'denied' };

  let response: Response;
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        company_id: input.companyId,
        instagram_account_id: input.instagramAccountId,
        target_mode: input.targetMode,
        official_connection_id: input.officialConnectionId,
        byo_account_id: input.byoAccountId,
        confirmed: true,
      }),
      signal,
    });
  } catch (error) {
    return isAbort(error, signal) ? { kind: 'cancelled' } : { kind: 'temporary' };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = isRecord(body) && typeof body.error === 'string' ? body.error : '';

  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status === 400 && error === 'confirmation_required') return { kind: 'confirmation_required' };
  if (response.status === 400) return { kind: 'rejected' };
  if (BLOCKED.has(error)) return { kind: 'blocked', reason: error };
  if (response.status !== 200 || !isRecord(body) || body.ok !== true) return { kind: 'temporary' };
  if (body.reason !== 'switched' && body.reason !== 'already_applied') return { kind: 'temporary' };
  if (body.target_mode !== 'official' && body.target_mode !== 'byo') return { kind: 'temporary' };
  if (typeof body.moved_count !== 'number' || !Number.isInteger(body.moved_count)) return { kind: 'temporary' };

  return {
    kind: 'ok',
    reason: body.reason,
    targetMode: body.target_mode,
    movedCount: body.moved_count,
  };
}
