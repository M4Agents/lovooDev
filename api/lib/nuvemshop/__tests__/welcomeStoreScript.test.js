/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(resolve(import.meta.dirname, '../../../../public/nuvemshop-welcome.js'), 'utf8');

const CONFIG = {
  campaign_id: '11111111-1111-4111-8111-111111111111',
  title: 'Bem-vindo',
  description: 'Primeira compra',
  image_url: null,
  button_label: 'Quero meu cupom',
  background_color: '#ffffff',
  text_color: '#111111',
  button_color: '#111827',
  consent_text: 'Aceito receber o cupom',
  promo_consent_text: 'Aceito promoções',
  delay_seconds: 10,
  resurface_days: 7,
};

function install(pathname = '/', html = '<script data-lovoo-welcome data-store-id="7680914" data-endpoint="/api/nuvemshop/welcome-popup/public"></script>') {
  document.body.innerHTML = html;
  window.history.pushState({}, '', pathname);
  localStorage.clear();
  sessionStorage.clear();
  window.__lovooNavigate = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          coupon_revealed: true,
          coupon_code: 'CUPOM10',
          apply_url: 'https://valleron.store/discount/CUPOM10?redirect_to=/',
          discount_applied: false,
        }),
      };
    }
    return { ok: true, json: async () => ({ config: CONFIG }) };
  }));
  window.eval(SOURCE);
}

describe('formulário da loja', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('abre na home depois do atraso, com máscara, aceite e sem vazamento horizontal', async () => {
    vi.useFakeTimers();
    install('/');
    await vi.runAllTicks();
    expect(document.getElementById('lovoo-welcome')).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    const dialog = document.getElementById('lovoo-welcome');
    expect(dialog).not.toBeNull();
    expect(dialog.style.overflow).toBe('hidden');
    expect(dialog.textContent).toContain('+55');
    expect(dialog.querySelector('[data-mobile-row]').style.width).toBe('100%');
    expect(dialog.querySelector('input[name="email"]').type).toBe('email');
    expect(dialog.querySelector('input[name="phone"]').getAttribute('inputmode')).toBe('numeric');
    const card = dialog.firstElementChild;
    expect(card.style.width.replace(/\s/g, '')).toContain('min(420px,100%)');
    expect(dialog.textContent).toContain('Aceito receber o cupom');
    expect(dialog.textContent).toContain('Aceito promoções');
    expect(dialog.querySelector('input[name="promo_consent"]').required).toBe(false);
    expect(dialog.querySelector('input[name="coupon_consent"]').required).toBe(true);
  });

  it('não abre fora da home e suprime antes de redirecionar', async () => {
    vi.useFakeTimers();
    install('/produtos');
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById('lovoo-welcome')).toBeNull();

    document.body.innerHTML = '';
    install('/');
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(10000);
    const phone = document.querySelector('input[name="phone"]');
    phone.value = '11987654321';
    phone.dispatchEvent(new Event('input'));
    expect(phone.value).toBe('(11) 98765-4321');
    document.querySelector('input[name="name"]').value = 'Ana';
    document.querySelector('input[name="email"]').value = 'ana@valleron.store';
    document.querySelector('input[name="coupon_consent"]').checked = true;
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('CUPOM10'));
    expect(localStorage.getItem('lovoo_welcome_suppress:7680914:11111111-1111-4111-8111-111111111111')).toBeTruthy();
    expect(window.__lovooNavigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1200);
    expect(window.__lovooNavigate).toHaveBeenCalledWith('https://valleron.store/discount/CUPOM10?redirect_to=/');
    expect(document.body.textContent).toContain('Aplicar cupom');
    expect(document.body.textContent).toContain('Copiar código');
    expect(document.body.textContent).not.toContain('desconto aplicado');
  });

  it('grava a supressão ao fechar', async () => {
    vi.useFakeTimers();
    install('/');
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(10000);
    document.querySelector('[aria-label="Fechar pop-up"]').click();
    expect(document.getElementById('lovoo-welcome')).toBeNull();
    expect(localStorage.getItem('lovoo_welcome_suppress:7680914:11111111-1111-4111-8111-111111111111')).toBeTruthy();
  });

  it('lê loja e endpoint HTTPS no src quando o script não tem atributos data-*', async () => {
    vi.useFakeTimers();
    install(
      '/?store_id=000&endpoint=http://evil.test/collect',
      '<script src="https://app.lovoocrm.com/nuvemshop-welcome.js?store_id=7680914&endpoint=https%3A%2F%2Fapp.lovoocrm.com%2Fapi%2Fnuvemshop%2Fwelcome-popup%2Fpublic"></script>',
    );
    await vi.runAllTicks();
    expect(fetch).toHaveBeenCalledWith(
      'https://app.lovoocrm.com/api/nuvemshop/welcome-popup/public?store_id=7680914',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('não usa a loja da página e recusa endpoint que não é HTTPS', async () => {
    install(
      '/?store_id=7680914&endpoint=https://app.lovoocrm.com/api/nuvemshop/welcome-popup/public',
      '<script src="https://app.lovoocrm.com/nuvemshop-welcome.js?store_id=7680914&endpoint=http://evil.test/collect"></script>',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
