import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../couponSync.js', () => ({
  resolveClient: vi.fn(),
}));

import { resolveClient } from '../couponSync.js';
import {
  clearPublicStoreOriginCache,
  isPlatformStoreHost,
  loadPublicStoreOrigin,
  publicStoreOriginCacheSize,
  resolvePublicStoreOrigin,
} from '../promoStoreOrigin.js';

describe('domínio público da loja', () => {
  beforeEach(() => {
    clearPublicStoreOriginCache();
    vi.clearAllMocks();
  });

  it('não usa o host antigo da plataforma quando há URL principal', () => {
    expect(isPlatformStoreHost('valentro.lojavirtualnuvem.com.br')).toBe(true);
    const resolved = resolvePublicStoreOrigin({
      original_domain: 'valentro.lojavirtualnuvem.com.br',
      url_with_protocol: 'https://valleron.store',
      domains: ['http://valleron.store', 'http://www.valleron.store', 'http://valentro.lojavirtualnuvem.com.br'],
    });
    expect(resolved).toMatchObject({ ok: true, origin: 'https://valleron.store', host: 'valleron.store' });
  });

  it('pede escolha quando a URL principal ainda é o host da plataforma', () => {
    const resolved = resolvePublicStoreOrigin({
      original_domain: 'valentro.lojavirtualnuvem.com.br',
      url_with_protocol: 'https://valentro.lojavirtualnuvem.com.br',
      domains: ['http://valleron.store', 'http://www.valleron.com.br'],
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.error.hosts).toEqual(['valleron.store', 'www.valleron.com.br']);
  });

  it('reutiliza a leitura da loja na cópia seguinte', async () => {
    const get = vi.fn(async () => ({
      original_domain: 'valentro.lojavirtualnuvem.com.br',
      url_with_protocol: 'https://valleron.store',
      domains: ['http://valleron.store'],
    }));
    resolveClient.mockResolvedValue({ client: { get } });
    const first = await loadPublicStoreOrigin({ companyId: 'c', storeId: '1', svc: {}, now: 1_000 });
    const second = await loadPublicStoreOrigin({ companyId: 'c', storeId: '1', svc: {}, now: 2_000 });
    expect(first.origin).toBe('https://valleron.store');
    expect(second.origin).toBe('https://valleron.store');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('remove as leituras vencidas ao consultar de novo', async () => {
    const get = vi.fn(async () => ({
      original_domain: 'valentro.lojavirtualnuvem.com.br',
      url_with_protocol: 'https://valleron.store',
      domains: ['http://valleron.store'],
    }));
    resolveClient.mockResolvedValue({ client: { get } });
    const ttl = 10 * 60 * 1000;
    await loadPublicStoreOrigin({ companyId: 'c', storeId: '1', svc: {}, now: 1_000 });
    await loadPublicStoreOrigin({ companyId: 'c', storeId: '2', svc: {}, now: 1_000 });
    expect(publicStoreOriginCacheSize()).toBe(2);
    await loadPublicStoreOrigin({ companyId: 'c', storeId: '1', svc: {}, now: 1_000 + ttl });
    expect(publicStoreOriginCacheSize()).toBe(1);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
