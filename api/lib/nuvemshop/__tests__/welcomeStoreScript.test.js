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
    const css = document.getElementById('lovoo-welcome-spin').textContent;
    expect(css).toContain('overflow:hidden');
    expect(css).toContain('width:min(420px,100%)');
    expect(css).toContain('#lovoo-welcome [data-mobile-row]{display:flex;gap:8px;width:100%');
    expect(dialog.textContent).toContain('+55');
    expect(dialog.querySelector('input[name="email"]').type).toBe('email');
    expect(dialog.querySelector('input[name="phone"]').getAttribute('inputmode')).toBe('numeric');
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
    const delayed = vi.spyOn(window, 'setTimeout');
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Olá, Ana!'));
    expect(delayed.mock.calls.some((call) => call[1] === 5000)).toBe(true);
    expect(document.querySelector('[data-coupon-code]').textContent).toBe('CUPOM10');
    expect(document.body.textContent).toContain('Seu cupom está pronto para você utilizar.');
    expect(document.body.textContent).toContain('Continuar comprando');
    expect(document.body.textContent).toContain('Copiar cupom');
    expect(document.body.textContent).not.toContain('Enviamos seu cupom pelo WhatsApp');
    expect(document.body.textContent).not.toContain('receberá seu cupom');
    expect(document.querySelector('[data-whatsapp-notice]')).toBeNull();
    expect(localStorage.getItem('lovoo_welcome_suppress:7680914:11111111-1111-4111-8111-111111111111')).toBeTruthy();
    expect(window.__lovooNavigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(window.__lovooNavigate).toHaveBeenCalledWith('https://valleron.store/discount/CUPOM10?redirect_to=/');
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

  async function openForm() {
    vi.useFakeTimers();
    install('/');
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(10000);
  }

  function fillForm() {
    document.querySelector('input[name="name"]').value = 'Ana';
    document.querySelector('input[name="email"]').value = 'ana@valleron.store';
    const phone = document.querySelector('input[name="phone"]');
    phone.value = '11987654321';
    phone.dispatchEvent(new Event('input'));
    document.querySelector('input[name="coupon_consent"]').checked = true;
  }

  it('mostra o carregamento, bloqueia o segundo clique e preserva os campos no erro', async () => {
    await openForm();
    fillForm();
    let release;
    window.fetch = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const form = document.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const css = document.getElementById('lovoo-welcome-spin').textContent;
    expect(css).toContain('100dvh');
    expect(css).toContain('font-size:16px');
    expect(css).toContain('min-height:44px');
    expect(css).not.toContain('transform:scale');
    expect(getComputedStyle(document.querySelector('input[name="name"]')).fontSize).toBe('16px');
    expect(css).toContain('font-size:clamp(22px,6vw,26px)');
    expect(document.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(document.querySelector('[data-loading]')).not.toBeNull();
    expect(document.body.textContent).toContain('Confirmando seu cadastro…');
    expect(window.fetch).toHaveBeenCalledTimes(1);
    release({ ok: false, json: async () => ({ error: 'Não foi possível concluir o cadastro.' }) });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Não foi possível concluir o cadastro.'));
    expect(document.querySelector('input[name="name"]').value).toBe('Ana');
    expect(document.querySelector('input[name="email"]').value).toBe('ana@valleron.store');
    expect(document.querySelector('input[name="phone"]').value).toBe('(11) 98765-4321');
    expect(document.querySelector('button[type="submit"]').disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const firstAttempt = JSON.parse(window.fetch.mock.calls[0][1].body).attempt_id;
    const secondAttempt = JSON.parse(window.fetch.mock.calls[1][1].body).attempt_id;
    expect(secondAttempt).toBe(firstAttempt);
  });

  it('copia o código, antecipa a compra e fala de WhatsApp só quando o estado é conhecido', async () => {
    await openForm();
    fillForm();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        coupon_revealed: true,
        coupon_code: 'BEMVINDO10',
        apply_url: 'https://valleron.store/discount/BEMVINDO10?redirect_to=/',
        whatsapp_notice: 'scheduled',
        discount_applied: false,
      }),
    }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-coupon-code]').textContent).toBe('BEMVINDO10'));
    expect(document.getElementById('lovoo-welcome-spin').textContent).toContain('flex-wrap:wrap');
    expect(document.getElementById('lovoo-welcome-spin').textContent).not.toContain('transform:scale');
    expect(document.querySelector('[data-whatsapp-notice="scheduled"]').textContent).toBe('Você também receberá seu cupom pelo WhatsApp.');
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'Copiar cupom').click();
    expect(writeText).toHaveBeenCalledWith('BEMVINDO10');
    document.querySelector('a').click();
    expect(window.__lovooNavigate).toHaveBeenCalledWith('https://valleron.store/discount/BEMVINDO10?redirect_to=/');
    await vi.advanceTimersByTimeAsync(5000);
    expect(window.__lovooNavigate).toHaveBeenCalledTimes(1);
  });

  it('trata nome e cupom como texto e omite WhatsApp sem aviso confirmado', async () => {
    await openForm();
    document.querySelector('input[name="name"]').value = '<img src=x onerror=alert(1)>';
    document.querySelector('input[name="email"]').value = 'ana@valleron.store';
    const phone = document.querySelector('input[name="phone"]');
    phone.value = '11987654321';
    phone.dispatchEvent(new Event('input'));
    document.querySelector('input[name="coupon_consent"]').checked = true;
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        coupon_revealed: true,
        coupon_code: '<b>CUPOM</b>',
        apply_url: 'https://valleron.store/discount/CUPOM?redirect_to=/',
        whatsapp_notice: 'sent',
        discount_applied: false,
      }),
    }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-coupon-code]').textContent).toBe('<b>CUPOM</b>'));
    expect(document.querySelector('#lovoo-welcome-title').textContent).toBe('Olá, <img src=x onerror=alert(1)>!');
    expect(document.querySelector('#lovoo-welcome img, #lovoo-welcome b')).toBeNull();
    expect(document.querySelector('[data-whatsapp-notice]')).toBeNull();
    expect(document.body.textContent).not.toContain('Enviamos seu cupom pelo WhatsApp');
  });

  it('explica que o cupom é só para a primeira compra e permanece na loja', async () => {
    await openForm();
    fillForm();
    window.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({
        code: 'identity_conflict',
        outcome: 'existing_customer',
        coupon_revealed: false,
      }),
    }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-welcome-outcome="existing_customer"]')).not.toBeNull());
    expect(document.getElementById('lovoo-welcome-title').textContent).toBe('Olá, Ana!');
    expect(document.body.textContent).toContain('Este cupom é exclusivo para a primeira compra. Continue explorando nossas coleções e aproveite as ofertas da VALLERON.');
    expect(document.body.textContent).toContain('Continuar comprando');
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('[data-coupon-code]')).toBeNull();
    expect(localStorage.getItem('lovoo_welcome_suppress:7680914:11111111-1111-4111-8111-111111111111')).toBeTruthy();
    document.querySelector('[data-welcome-outcome="existing_customer"]').click();
    expect(document.getElementById('lovoo-welcome')).toBeNull();
    expect(window.__lovooNavigate).not.toHaveBeenCalled();
  });

  it('avisa quem já solicitou o cupom para conferir o WhatsApp', async () => {
    await openForm();
    fillForm();
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        outcome: 'already_requested',
        coupon_revealed: true,
        coupon_code: 'BEMVINDO10',
        apply_url: 'https://valleron.store/discount/BEMVINDO10?redirect_to=/',
        repeated: true,
      }),
    }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-welcome-outcome="already_requested"]')).not.toBeNull());
    expect(document.getElementById('lovoo-welcome-title').textContent).toBe('Olá, Ana!');
    expect(document.body.textContent).toContain('Você já solicitou seu cupom de boas-vindas. Confira a mensagem no seu WhatsApp para acessá-lo.');
    expect(document.querySelector('[data-coupon-code]')).toBeNull();
    expect(document.body.textContent).not.toContain('BEMVINDO10');
    await vi.advanceTimersByTimeAsync(5000);
    expect(window.__lovooNavigate).not.toHaveBeenCalled();
  });
});
