// Consulta graph.facebook.com com o SUAT já armazenado.

import { classifyMetaFailure, interpretAssignedPages, interpretDebugToken } from './byoMetaDiscovery.js';

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const GRAPH_VERSION = 'v21.0';
const MAX_BODY = 1_000_000;
const MAX_PAGES = 4;

function temporary() {
  return { ok: false, code: 'temporary', definitive: false };
}

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith(`${GRAPH_ORIGIN}/`)) return null;
  return value;
}

async function readJson(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { ok: false, failure: temporary() };
  }
  let text = '';
  try {
    text = await response.text();
  } catch {
    return { ok: false, failure: temporary() };
  }
  if (text.length > MAX_BODY) return { ok: false, failure: temporary() };
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, failure: temporary() };
    }
  }
  if (!response.ok) return { ok: false, failure: classifyMetaFailure(response.status, body) };
  return { ok: true, body };
}

export async function inspectByoSystemUser({
  appId,
  appSecret,
  suat,
  fetchImpl = fetch,
}) {
  const debugUrl = new URL(`${GRAPH_ORIGIN}/debug_token`);
  debugUrl.searchParams.set('input_token', suat);
  debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);
  const debug = await readJson(fetchImpl, debugUrl);
  if (!debug.ok) return debug.failure;

  const token = interpretDebugToken(debug.body, appId);
  if (!token.ok) return token;

  const first = new URL(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${token.systemUserId}/assigned_pages`);
  first.searchParams.set('fields', 'id,instagram_business_account{id,username}');
  first.searchParams.set('limit', '50');
  first.searchParams.set('access_token', suat);

  const accounts = [];
  const seen = new Set();
  let next = first.toString();
  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    const payload = await readJson(fetchImpl, next);
    if (!payload.ok) return payload.failure;
    const parsed = interpretAssignedPages(payload.body);
    if (!parsed.ok) return parsed;
    for (const account of parsed.accounts) {
      if (seen.has(account.instagram_account_id)) continue;
      seen.add(account.instagram_account_id);
      accounts.push(account);
    }
    next = safeNext(payload.body?.paging?.next);
  }

  return {
    ok: true,
    systemUserId: token.systemUserId,
    scopes: token.scopes,
    accounts,
  };
}
