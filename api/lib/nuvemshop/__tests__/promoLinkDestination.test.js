import { describe, expect, it } from 'vitest';
import { buildPromoDiscountUrl, normalizePromoDestination } from '../promoLinkDestination.js';

describe('destino do link promocional', () => {
  it('normaliza caminho da loja e remove query e fragmento', () => {
    expect(normalizePromoDestination('/live').path).toBe('/live');
    expect(normalizePromoDestination('/live/').path).toBe('/live');
    expect(normalizePromoDestination('/produtos/camiseta?utm=1#topo').path).toBe('/produtos/camiseta');
    expect(normalizePromoDestination('/').path).toBe('/');
  });

  it('mantém caminho acentuado e recusa codificação perigosa em várias camadas', () => {
    expect(normalizePromoDestination('/coleção').path).toBe('/coleção');
    expect(normalizePromoDestination('/caf%C3%A9').path).toBe('/café');
    expect(normalizePromoDestination('/produtos/camisa-básica').path).toBe('/produtos/camisa-básica');

    const blocked = [
      '/../admin',
      '/%2e%2e/admin',
      '/%252e%252e/admin',
      '/%25252e%25252e/admin',
      '//evil.example',
      '/%2f%2fevil.example',
      '/%252f%252fevil.example',
      '/%25252f%25252fevil.example',
      '/live\\admin',
      '/%5cadmin',
      '/%255cadmin',
      '/%2525255cadmin',
      '/%25252525255cadmin',
      '/%',
      '/100%',
    ];
    for (const destination of blocked) {
      expect(normalizePromoDestination(destination).ok, destination).toBe(false);
    }
    expect(normalizePromoDestination('https://valleron.store/%2e%2e/admin', ['valleron.store']).ok).toBe(false);
    expect(normalizePromoDestination('https://valleron.store/%252f%252fevil.example', ['valleron.store']).ok).toBe(false);
    expect(normalizePromoDestination('https://valleron.store/cole%C3%A7%C3%A3o', ['valleron.store']).path).toBe('/coleção');
  });

  it('aceita URL https do domínio informado e recusa o restante', () => {
    expect(normalizePromoDestination('https://valleron.store/live?x=1', ['valleron.store']).path).toBe('/live');
    expect(normalizePromoDestination('https://evil.example/live', ['valleron.store']).ok).toBe(false);
    expect(normalizePromoDestination('http://valleron.store/live', ['valleron.store']).ok).toBe(false);
    expect(normalizePromoDestination('//evil.example/live').ok).toBe(false);
    expect(normalizePromoDestination('/live\\admin').ok).toBe(false);
    expect(normalizePromoDestination('/../admin').ok).toBe(false);
    expect(normalizePromoDestination('javascript:alert(1)').ok).toBe(false);
    expect(normalizePromoDestination('live').ok).toBe(false);
  });

  it('monta o link nativo sem codificar a barra do destino', () => {
    expect(buildPromoDiscountUrl('https://valleron.store', 'FRETE LIVE', '/live')).toBe(
      'https://valleron.store/discount/FRETE%20LIVE?redirect_to=/live',
    );
  });
});
