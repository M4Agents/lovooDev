// Interpreta respostas do Graph API para um System User Access Token.
// Não chama a rede. Um type diferente de SYSTEM_USER é recusado.

const ID_RE = /^[0-9]{5,32}$/;
const SCOPE_RE = /^[a-z0-9_]{1,64}$/;
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const REQUIRED_SCOPES = ['instagram_basic', 'pages_show_list'];

function scopesOf(data) {
  const found = new Set();
  if (Array.isArray(data.scopes)) {
    for (const scope of data.scopes) {
      if (typeof scope === 'string' && SCOPE_RE.test(scope)) found.add(scope);
    }
  }
  if (Array.isArray(data.granular_scopes)) {
    for (const entry of data.granular_scopes) {
      const scope = entry?.scope;
      if (typeof scope === 'string' && SCOPE_RE.test(scope)) found.add(scope);
    }
  }
  return [...found].sort();
}

export function interpretDebugToken(body, expectedAppId) {
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'temporary', definitive: false };
  }
  if (data.is_valid !== true) {
    return { ok: false, code: 'token_invalid', definitive: true };
  }
  if (String(data.app_id ?? '') !== String(expectedAppId)) {
    return { ok: false, code: 'token_wrong_app', definitive: true };
  }
  if (data.type !== 'SYSTEM_USER') {
    return { ok: false, code: 'token_type_unsupported', definitive: true };
  }
  const systemUserId = String(data.user_id ?? '');
  if (!ID_RE.test(systemUserId)) {
    return { ok: false, code: 'token_invalid', definitive: true };
  }
  const scopes = scopesOf(data);
  if (REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    return { ok: false, code: 'insufficient_permissions', definitive: true };
  }
  return { ok: true, systemUserId, scopes };
}

export function interpretAssignedPages(body) {
  if (!Array.isArray(body?.data)) {
    return { ok: false, code: 'temporary', definitive: false };
  }
  const accounts = [];
  const seen = new Set();
  for (const page of body.data) {
    const account = page?.instagram_business_account;
    const instagramAccountId = String(account?.id ?? '');
    if (!ID_RE.test(instagramAccountId) || seen.has(instagramAccountId)) continue;
    seen.add(instagramAccountId);
    const rawName = account?.username;
    const instagramUsername = typeof rawName === 'string' && USERNAME_RE.test(rawName)
      ? rawName
      : null;
    accounts.push({ instagram_account_id: instagramAccountId, instagram_username: instagramUsername });
  }
  return { ok: true, accounts };
}

export function classifyMetaFailure(status, body) {
  const code = body?.error?.code;
  if (code === 190 || code === 102) {
    return { ok: false, code: 'token_invalid', definitive: true };
  }
  if (status === 429 || status >= 500 || code === 1 || code === 2 || code === 4 || code === 17) {
    return { ok: false, code: 'temporary', definitive: false };
  }
  return { ok: false, code: 'temporary', definitive: false };
}
