// Domínio público da loja, lido de GET /store.
// original_domain e hosts da plataforma não entram no link.
// O valor em nuvemshop_connections.store_domain não é lido nem atualizado.

import { resolveClient } from './couponSync.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function fail(status, code, message, extra = {}) {
  return { ok: false, error: { status, code, message, ...extra } };
}

export function clearPublicStoreOriginCache() {
  cache.clear();
}

function hostOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isPlatformStoreHost(host) {
  return /(?:^|\.)lojavirtualnuvem\.com\.br$/i.test(host)
    || /(?:^|\.)mitiendanube\.com$/i.test(host)
    || /(?:^|\.)nuvemshop\.com\.br$/i.test(host);
}

export function resolvePublicStoreOrigin(store) {
  const original = hostOf(store?.original_domain);
  const custom = [];
  for (const entry of store?.domains ?? []) {
    const host = hostOf(entry);
    if (!host || host === original || isPlatformStoreHost(host) || custom.includes(host)) continue;
    custom.push(host);
  }

  const mainRaw = typeof store?.url_with_protocol === 'string' ? store.url_with_protocol.trim() : '';
  const mainHost = mainRaw.toLowerCase().startsWith('https://') ? hostOf(mainRaw) : null;
  if (mainHost && mainHost !== original && !isPlatformStoreHost(mainHost)) {
    const allowedHosts = [mainHost, ...custom.filter((host) => host !== mainHost)];
    return { ok: true, origin: `https://${mainHost}`, host: mainHost, allowedHosts };
  }

  if (custom.length === 1) {
    return { ok: true, origin: `https://${custom[0]}`, host: custom[0], allowedHosts: custom };
  }
  if (custom.length > 1) {
    return fail(409, 'public_domain_choice', 'Escolha o domínio público da loja.', { hosts: custom });
  }
  return fail(409, 'public_domain_unavailable', 'Não há domínio público confirmado para esta loja.');
}

export function originFromChoice(decision, requestedHost) {
  if (decision.ok) return decision;
  if (decision.error?.code !== 'public_domain_choice') return decision;
  const host = String(requestedHost ?? '').trim().toLowerCase();
  const hosts = decision.error.hosts ?? [];
  if (!hosts.includes(host) || isPlatformStoreHost(host)) {
    return fail(400, 'public_domain_choice', 'Escolha um domínio público da loja.', { hosts });
  }
  return { ok: true, origin: `https://${host}`, host, allowedHosts: hosts };
}

export function publicStoreOriginCacheSize() {
  return cache.size;
}

function dropExpired(now) {
  for (const [cacheKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cacheKey);
  }
}

export async function loadPublicStoreOrigin({
  companyId,
  storeId,
  svc,
  requestedHost,
  now = Date.now(),
}) {
  dropExpired(now);
  const key = `${companyId}:${storeId}`;
  const cached = cache.get(key);
  if (cached) {
    return originFromChoice(cached.value, requestedHost);
  }

  let client;
  try {
    ({ client } = await resolveClient({ svc, companyId, storeId }));
  } catch (error) {
    return { ok: false, error };
  }

  let store;
  try {
    store = await client.get('store', {
      fields: 'domains,original_domain,url_with_protocol',
    });
  } catch {
    return fail(503, 'store_unavailable', 'A loja não está disponível agora.');
  }

  const decision = resolvePublicStoreOrigin(store);
  if (decision.ok || decision.error?.code === 'public_domain_choice') {
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, value: decision });
  }
  return originFromChoice(decision, requestedHost);
}
