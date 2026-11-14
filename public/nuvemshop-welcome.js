/*
Substituição futura da prova carregada pelo GTM. Esta entrega não altera a tag.

Quando a publicação for autorizada:
1. Publicar este arquivo no projeto loovocrm, remoto production (M4Agents/loovocrm).
2. No GTM, substituir o script da prova (nuvemshop-welcome-proof.js, lovoo_popup_test=1)
   por este arquivo, na home. A loja e o endpoint vêm dos atributos data-*
   ou, se o GTM não copiar atributos, da query do src deste arquivo.
3. Remover o parâmetro lovoo_popup_test=1.
4. Não alterar m4track, Cashing, a tag em revisão #12661 nem a atribuição de checkout #9213.
5. Aplicar antes a migration de habilitação e ligar a campanha no painel.
   Enquanto enabled=false, este script não recebe configuração nem cupom.

Não chama m4track e não emite os eventos dele. Lê visitor_id, session_id e UTMs
somente se já existirem.
*/
(function () {
  'use strict';

  var script = welcomeScript();
  var params = scriptParams(script);
  var storeId = (script && script.getAttribute('data-store-id')) || (params && params.get('store_id')) || '';
  var rawEndpoint = (script && script.getAttribute('data-endpoint')) || (params && params.get('endpoint')) || '';
  var endpoint = rawEndpoint ? validEndpoint(rawEndpoint) : '/api/nuvemshop/welcome-popup/public';
  var startedAt = Date.now();
  if (!/^\d+$/.test(storeId) || !endpoint) return;
  if (location.pathname !== '/' && location.pathname !== '') return;

  function welcomeScript() {
    if (document.currentScript) return document.currentScript;
    var marked = document.querySelector('script[data-lovoo-welcome]');
    if (marked) return marked;
    var nodes = document.getElementsByTagName('script');
    for (var i = nodes.length - 1; i >= 0; i -= 1) {
      if ((nodes[i].getAttribute('src') || '').indexOf('nuvemshop-welcome.js') !== -1) return nodes[i];
    }
    return null;
  }

  function scriptParams(node) {
    var src = node && node.getAttribute('src');
    if (!src) return null;
    try { return new URL(src, 'https://app.lovoocrm.com').searchParams; } catch (e) { return null; }
  }

  function validEndpoint(value) {
    if (value.charAt(0) === '/' && value.charAt(1) !== '/') return value;
    try {
      var url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch (e) { return null; }
  }

  var DDDS = {
    '11': 1, '12': 1, '13': 1, '14': 1, '15': 1, '16': 1, '17': 1, '18': 1, '19': 1,
    '21': 1, '22': 1, '24': 1, '27': 1, '28': 1,
    '31': 1, '32': 1, '33': 1, '34': 1, '35': 1, '37': 1, '38': 1,
    '41': 1, '42': 1, '43': 1, '44': 1, '45': 1, '46': 1, '47': 1, '48': 1, '49': 1,
    '51': 1, '53': 1, '54': 1, '55': 1,
    '61': 1, '62': 1, '63': 1, '64': 1, '65': 1, '66': 1, '67': 1, '68': 1, '69': 1,
    '71': 1, '73': 1, '74': 1, '75': 1, '77': 1, '79': 1,
    '81': 1, '82': 1, '83': 1, '84': 1, '85': 1, '86': 1, '87': 1, '88': 1, '89': 1,
    '91': 1, '92': 1, '93': 1, '94': 1, '95': 1, '96': 1, '97': 1, '98': 1, '99': 1
  };

  function readVisitor() {
    try { return localStorage.getItem('lovocrm_visitor_id') || null; } catch (e) { return null; }
  }

  function readSession() {
    try { return window.M4Track && window.M4Track.config && window.M4Track.config.sessionId || null; } catch (e) { return null; }
  }

  function readUtms() {
    var params = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    var utm = {};
    keys.forEach(function (key) {
      if (params.get(key)) utm[key] = params.get(key).slice(0, 255);
    });
    if (Object.keys(utm).length) return utm;
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var name = localStorage.key(i);
        if (name && name.indexOf('lovocrm_utm_first:') === 0) {
          var parsed = JSON.parse(localStorage.getItem(name) || '{}');
          keys.forEach(function (key) { if (parsed[key]) utm[key] = String(parsed[key]).slice(0, 255); });
          break;
        }
      }
    } catch (e) { /* ausência de UTM não bloqueia o cadastro */ }
    return utm;
  }

  function normalizeEmail(value) {
    var email = String(value || '').trim().toLowerCase();
    if (!email || email.length > 254 || /\s/.test(email)) return null;
    var at = email.indexOf('@');
    if (at <= 0 || at !== email.lastIndexOf('@')) return null;
    var local = email.slice(0, at);
    var domain = email.slice(at + 1);
    if (!/^[a-z0-9._%+-]+$/.test(local)) return null;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.indexOf('..') >= 0) return null;
    return email;
  }

  function nationalDigits(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 13 && digits.indexOf('55') === 0) digits = digits.slice(2);
    return digits;
  }

  function maskPhone(value) {
    var core = nationalDigits(value).slice(0, 11);
    if (!core) return '';
    var out = '(' + core.slice(0, Math.min(2, core.length));
    if (core.length >= 2) out += ')';
    if (core.length > 2) out += ' ' + core.slice(2, Math.min(7, core.length));
    if (core.length > 7) out += '-' + core.slice(7);
    return out;
  }

  function validPhone(value) {
    var digits = nationalDigits(value);
    if (digits.length !== 11 || !DDDS[digits.slice(0, 2)] || digits.charAt(2) !== '9') return null;
    return digits;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function suppressKey(campaignId) {
    return 'lovoo_welcome_suppress:' + storeId + ':' + campaignId;
  }

  function suppressed(campaignId, days) {
    try {
      var raw = localStorage.getItem(suppressKey(campaignId));
      if (!raw) return false;
      return Date.now() < Number(raw) + days * 24 * 60 * 60 * 1000;
    } catch (e) { return false; }
  }

  function suppress(campaignId, days) {
    try { localStorage.setItem(suppressKey(campaignId), String(Date.now())); } catch (e) { /* segue o fluxo */ }
    return days;
  }

  function attemptFor(payload) {
    var key = 'lovoo_welcome_attempt:' + storeId + ':' + payload;
    try {
      var current = sessionStorage.getItem(key);
      if (current) return current;
      var created = uuid();
      sessionStorage.setItem(key, created);
      return created;
    } catch (e) { return uuid(); }
  }

  function render(config) {
    if (document.getElementById('lovoo-welcome')) return;
    var root = document.createElement('section');
    root.id = 'lovoo-welcome';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'lovoo-welcome-title');
    var card = document.createElement('div');
    card.setAttribute('data-welcome-card', 'true');
    card.style.cssText = 'background:' + (config.background_color || '#ffffff') + ';color:' + (config.text_color || '#111827') + ';';
    var header = document.createElement('div');
    header.setAttribute('data-welcome-header', 'true');
    var body = document.createElement('div');
    body.setAttribute('data-welcome-body', 'true');

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fechar';
    close.setAttribute('data-close', 'true');
    close.setAttribute('aria-label', 'Fechar pop-up');
    close.onclick = function () { suppress(config.campaign_id, config.resurface_days || 7); root.remove(); };

    var title = document.createElement('h2');
    title.id = 'lovoo-welcome-title';
    title.textContent = config.title || 'Bem-vindo';
    var description = document.createElement('p');
    description.textContent = config.description || '';
    if (config.image_url) {
      var image = document.createElement('img');
      image.src = config.image_url;
      image.alt = '';
      body.appendChild(image);
    }

    var form = document.createElement('form');
    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.minHeight = '1.2em';

    function field(labelText, input) {
      var label = document.createElement('label');
      label.appendChild(document.createTextNode(labelText));
      label.appendChild(input);
      return label;
    }

    var name = document.createElement('input');
    name.name = 'name';
    name.required = true;
    name.maxLength = 80;
    name.autocomplete = 'name';
    var email = document.createElement('input');
    email.name = 'email';
    email.type = 'email';
    email.required = true;
    email.autocomplete = 'email';
    var phoneRow = document.createElement('div');
    phoneRow.setAttribute('data-mobile-row', 'true');
    var prefix = document.createElement('span');
    prefix.textContent = '+55';
    var phone = document.createElement('input');
    phone.name = 'phone';
    phone.type = 'tel';
    phone.inputMode = 'numeric';
    phone.autocomplete = 'tel';
    phone.placeholder = '(11) 99999-9999';
    phone.required = true;
    phone.addEventListener('input', function () { phone.value = maskPhone(phone.value); });
    phoneRow.appendChild(prefix);
    phoneRow.appendChild(phone);

    var couponConsent = document.createElement('input');
    couponConsent.type = 'checkbox';
    couponConsent.name = 'coupon_consent';
    couponConsent.required = true;
    var promoConsent = document.createElement('input');
    promoConsent.type = 'checkbox';
    promoConsent.name = 'promo_consent';
    var honey = document.createElement('input');
    honey.name = 'company_website';
    honey.tabIndex = -1;
    honey.autocomplete = 'off';
    honey.style.cssText = 'position:absolute;left:-9999px;';

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = config.button_label || 'Quero meu cupom';
    submit.style.background = config.button_color || '#111827';
    var sending = false;

    if (!document.getElementById('lovoo-welcome-spin')) {
      var spin = document.createElement('style');
      spin.id = 'lovoo-welcome-spin';
      spin.textContent = [
        '@keyframes lovoo-spin{to{transform:rotate(360deg)}}',
        '#lovoo-welcome,#lovoo-welcome *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:normal;text-transform:none;}',
        '#lovoo-welcome{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;padding:16px;background:rgba(15,23,42,.45);overflow:hidden;font-size:14px;line-height:1.35;-webkit-text-size-adjust:100%;}',
        '#lovoo-welcome [data-welcome-card]{width:min(420px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;padding:12px 16px 16px;}',
        '#lovoo-welcome [data-welcome-header]{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex:0 0 auto;}',
        '#lovoo-welcome [data-welcome-body]{overflow:auto;min-height:0;overscroll-behavior:contain;}',
        '#lovoo-welcome h2{margin:0;font-size:clamp(22px,6vw,26px);font-weight:700;line-height:1.2;overflow-wrap:anywhere;}',
        '#lovoo-welcome p,#lovoo-welcome label{margin:0;font-size:14px;line-height:1.35;}',
        '#lovoo-welcome [data-close]{flex:0 0 auto;min-width:44px;min-height:44px;margin:-8px -8px 0 0;padding:8px;border:0;background:transparent;color:inherit;font-size:14px;cursor:pointer;}',
        '#lovoo-welcome form{display:grid;gap:8px;margin-top:8px;}',
        '#lovoo-welcome label{display:grid;gap:2px;}',
        '#lovoo-welcome label[data-consent]{display:flex;align-items:center;gap:8px;min-height:44px;}',
        '#lovoo-welcome input:not([type="checkbox"]){width:100%;height:44px;min-width:0;margin:0;padding:0 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:inherit;font-size:16px;line-height:1.2;}',
        '#lovoo-welcome [data-mobile-row]{display:flex;gap:8px;width:100%;min-width:0;}',
        '#lovoo-welcome [data-mobile-row] span{display:flex;align-items:center;height:44px;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-size:16px;}',
        '#lovoo-welcome [data-mobile-row] input{flex:1;}',
        '#lovoo-welcome label[data-consent] input{width:20px;height:20px;margin:0;flex:0 0 20px;}',
        '#lovoo-welcome button[type="submit"],#lovoo-welcome [data-confirmation-actions] a,#lovoo-welcome [data-confirmation-actions] button{min-height:44px;border-radius:8px;font-size:16px;line-height:1.2;}',
        '#lovoo-welcome button[type="submit"]{width:100%;border:0;padding:0 12px;color:#fff;cursor:pointer;}',
        '#lovoo-welcome [data-coupon-code]{margin:8px 0;font-size:22px;font-weight:700;line-height:1.2;letter-spacing:.04em;text-align:center;overflow-wrap:anywhere;}',
        '#lovoo-welcome [data-confirmation-actions]{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}',
        '#lovoo-welcome [data-confirmation-actions] a,#lovoo-welcome [data-confirmation-actions] button{flex:1 1 140px;min-width:0;box-sizing:border-box;padding:0 12px;text-align:center;text-decoration:none;cursor:pointer;}',
        '#lovoo-welcome img{display:block;width:100%;max-width:100%;max-height:72px;height:auto;object-fit:cover;border-radius:12px;margin:8px 0;}'
      ].join('');
      document.head.appendChild(spin);
    }

    form.appendChild(field('Nome', name));
    form.appendChild(field('E-mail', email));
    var phoneLabel = document.createElement('label');
    phoneLabel.style.cssText = '';
    phoneLabel.appendChild(document.createTextNode('WhatsApp'));
    phoneLabel.appendChild(phoneRow);
    form.appendChild(phoneLabel);
    form.appendChild(checkLabel(couponConsent, config.consent_text || 'Aceito receber o cupom.'));
    if (config.promo_consent_text) form.appendChild(checkLabel(promoConsent, config.promo_consent_text));
    form.appendChild(honey);
    form.appendChild(submit);
    form.appendChild(status);

    function showSending() {
      sending = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      status.textContent = '';
      var spinner = document.createElement('span');
      spinner.setAttribute('data-loading', 'true');
      spinner.style.cssText = 'display:inline-block;width:14px;height:14px;margin-right:8px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:lovoo-spin .8s linear infinite;';
      status.appendChild(spinner);
      status.appendChild(document.createTextNode('Confirmando seu cadastro…'));
    }

    function showError(message) {
      sending = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      status.textContent = message;
    }

    function showConfirmation(result, givenName) {
      var code = result.body.coupon_code;
      var applyUrl = result.body.apply_url;
      var notice = result.body.whatsapp_notice;
      suppress(config.campaign_id, config.resurface_days || 7);
      form.remove();
      title.id = 'lovoo-welcome-title';
      title.textContent = 'Olá, ' + givenName + '!';
      description.textContent = 'Seu cupom está pronto para você utilizar.';
      var codeLine = document.createElement('p');
      codeLine.setAttribute('data-coupon-code', 'true');
      codeLine.appendChild(document.createTextNode(code));
      body.appendChild(codeLine);
      if (notice === 'scheduled') {
        var whatsapp = document.createElement('p');
        whatsapp.setAttribute('data-whatsapp-notice', 'scheduled');
        whatsapp.appendChild(document.createTextNode('Você também receberá seu cupom pelo WhatsApp.'));
        body.appendChild(whatsapp);
      }
      var actions = document.createElement('div');
      actions.setAttribute('data-confirmation-actions', 'true');
      var goShopping = document.createElement('a');
      goShopping.href = applyUrl;
      goShopping.textContent = 'Continuar comprando';
      goShopping.style.background = config.button_color || '#111827';
      goShopping.style.color = '#fff';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copiar cupom';
      copy.style.border = '1px solid currentColor';
      copy.style.background = 'transparent';
      copy.style.color = 'inherit';
      copy.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code);
      };
      actions.appendChild(goShopping);
      actions.appendChild(copy);
      body.appendChild(actions);
      var left = false;
      function leave() {
        if (left) return;
        left = true;
        window.clearTimeout(timer);
        if (typeof window.__lovooNavigate === 'function') window.__lovooNavigate(applyUrl);
        else location.assign(applyUrl);
      }
      goShopping.addEventListener('click', function (clickEvent) {
        clickEvent.preventDefault();
        leave();
      });
      var timer = window.setTimeout(leave, 5000);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (sending) return;
      var emailValue = normalizeEmail(email.value);
      var phoneValue = validPhone(phone.value);
      if (!name.value.trim() || !emailValue || !phoneValue || !couponConsent.checked) {
        status.textContent = 'Revise nome, e-mail, WhatsApp e o aceite do cupom.';
        return;
      }
      var givenName = name.value.trim();
      var payloadKey = [config.campaign_id, givenName, emailValue, phoneValue, couponConsent.checked, promoConsent.checked].join('|');
      var attemptId = attemptFor(payloadKey);
      showSending();
      fetch(endpoint + '?store_id=' + encodeURIComponent(storeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          attempt_id: attemptId,
          name: name.value.trim(),
          email: emailValue,
          phone: phoneValue,
          coupon_consent: true,
          promo_consent: promoConsent.checked === true,
          visitor_id: readVisitor(),
          session_id: readSession(),
          utm: readUtms(),
          company_website: honey.value
        })
      }).then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
        .then(function (result) {
          if (!result.body || result.body.coupon_revealed !== true || !result.body.coupon_code || !result.body.apply_url) {
            showError((result.body && result.body.error) || 'Não foi possível concluir o cadastro.');
            return;
          }
          showConfirmation(result, givenName);
        })
        .catch(function () {
          showError('Não foi possível enviar agora. Tente novamente.');
        });
    });

    header.appendChild(title);
    header.appendChild(close);
    body.appendChild(description);
    body.appendChild(form);
    card.appendChild(header);
    card.appendChild(body);
    root.appendChild(card);
    document.body.appendChild(root);
    close.focus();
  }

  function checkLabel(input, text) {
    var label = document.createElement('label');
    label.setAttribute('data-consent', 'true');
    label.appendChild(input);
    label.appendChild(document.createTextNode(text));
    return label;
  }

  fetch(endpoint + '?store_id=' + encodeURIComponent(storeId), { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (body) {
      var config = body && body.config;
      if (!config || !config.campaign_id) return;
      if (suppressed(config.campaign_id, config.resurface_days || 7)) return;
      var delay = (Number(config.delay_seconds) || 10) * 1000;
      var remaining = Math.max(0, delay - (Date.now() - startedAt));
      window.setTimeout(function () { render(config); }, remaining);
    })
    .catch(function () { /* loja sem publicação não mostra o pop-up */ });
})();
