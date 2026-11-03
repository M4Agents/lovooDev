// Leitura diagnóstica do Unified Login. Não grava credencial e não assina webhooks.

import {
  interpretAssignedInstagramAccounts,
  reportEffectiveScopes,
} from './byoMetaDiscovery.js';

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const ACCOUNTS_URL = `${GRAPH_ORIGIN}/v26.0/me/assigned_instagram_accounts`;
const MAX_BODY = 1_000_000;
const MAX_PAGES = 4;
const TIMEOUT_MS = 10_000;
const SCOPE_RE = /^[a-z0-9_]{1,64}$/;
const DENIED_CODES = new Set([10, 102, 190, 200, 294]);

function blank(errorCode) {
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

function scopeFields(scopes) {
  const report = reportEffectiveScopes(scopes);
  return {
    instagram_basic: report.instagram_basic ? 'present' : 'absent',
    instagram_manage_messages: report.instagram_manage_messages ? 'present' : 'absent',
    instagram_manage_comments: report.instagram_manage_comments ? 'present' : 'absent',
  };
}

function scopesOf(data) {
  const found = [];
  const push = (value) => {
    if (typeof value === 'string' && SCOPE_RE.test(value) && !found.includes(value)) found.push(value);
  };
  if (Array.isArray(data?.scopes)) {
    for (const scope of data.scopes) push(scope);
  }
  if (Array.isArray(data?.granular_scopes)) {
    for (const entry of data.granular_scopes) push(entry?.scope);
  }
  return found;
}

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith(`${GRAPH_ORIGIN}/`)) return null;
  return value;
}

function denied(body) {
  const code = body?.error?.code;
  return typeof code === 'number' && DENIED_CODES.has(code);
}

async function readLimited(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, kind: 'transport' };
  }
  let text = '';
  try {
    text = await response.text();
  } catch {
    return { ok: false, kind: 'transport' };
  }
  if (text.length > MAX_BODY) return { ok: false, kind: 'transport' };
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, kind: 'invalid_json' };
    }
  }
  if (!response.ok) return { ok: false, kind: 'http', body };
  return { ok: true, body };
}

function expectedAccount(expectedAccountIds, accounts) {
  if (!Array.isArray(expectedAccountIds) || expectedAccountIds.length !== 1) return 'indeterminate';
  const expected = expectedAccountIds[0];
  return accounts.some((account) => account.instagram_account_id === expected) ? 'found' : 'not_found';
}

async function readAssignedAccounts(fetchImpl, suat) {
  const first = new URL(ACCOUNTS_URL);
  first.searchParams.set('fields', 'id,username');
  first.searchParams.set('limit', '50');
  first.searchParams.set('access_token', suat);
  const accounts = [];
  const seen = new Set();
  let next = first.toString();
  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    const loaded = await readLimited(fetchImpl, next);
    if (!loaded.ok) {
      return loaded.kind === 'http' && denied(loaded.body)
        ? { ok: false, outcome: 'incompatible' }
        : { ok: false, outcome: 'indeterminate' };
    }
    const parsed = interpretAssignedInstagramAccounts(loaded.body);
    if (!parsed.ok) return { ok: false, outcome: 'indeterminate' };
    for (const account of parsed.accounts) {
      if (seen.has(account.instagram_account_id)) continue;
      seen.add(account.instagram_account_id);
      accounts.push(account);
    }
    next = safeNext(loaded.body?.paging?.next);
  }
  return { ok: true, accounts };
}

export async function readUnifiedLoginDiagnostic({
  appId,
  appSecret,
  suat,
  expectedAccountIds,
  fetchImpl = fetch,
}) {
  const debugUrl = new URL(`${GRAPH_ORIGIN}/debug_token`);
  debugUrl.searchParams.set('input_token', suat);
  debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);
  const debug = await readLimited(fetchImpl, debugUrl.toString());
  if (!debug.ok) return blank('meta_unavailable');

  const data = debug.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.is_valid !== true) {
    return blank(null);
  }

  const appIdentity = String(data.app_id ?? '') === String(appId ?? '')
    ? 'compatible'
    : (data.app_id == null || data.app_id === '' ? 'indeterminate' : 'incompatible');
  const scopes = scopeFields(scopesOf(data));
  if (appIdentity !== 'compatible' || data.type !== 'SYSTEM_USER') {
    return {
      ...blank(null),
      app_identity: appIdentity,
      ...scopes,
    };
  }

  const assigned = await readAssignedAccounts(fetchImpl, suat);
  if (!assigned.ok) {
    return {
      ...blank(assigned.outcome === 'indeterminate' ? 'meta_unavailable' : null),
      app_identity: 'compatible',
      ...scopes,
      unified_login_read: assigned.outcome,
    };
  }

  return {
    app_identity: 'compatible',
    ...scopes,
    expected_account: expectedAccount(expectedAccountIds, assigned.accounts),
    unified_login_read: 'compatible',
    webhook_subscription: 'indeterminate',
    error_code: null,
  };
}
