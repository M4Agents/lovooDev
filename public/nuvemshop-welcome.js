/*
Substituição futura da prova carregada pelo GTM. Esta entrega não altera a tag.

Quando a publicação for autorizada:
1. Publicar este arquivo no projeto loovocrm, remoto production (M4Agents/loovocrm).
2. No GTM, substituir o script da prova (nuvemshop-welcome-proof.js, lovoo_popup_test=1)
   por este arquivo, na home, com data-store-id da loja.
3. Remover o parâmetro lovoo_popup_test=1.
4. Não alterar m4track, Cashing, a tag em revisão #12661 nem a atribuição de checkout #9213.
5. Aplicar antes a migration de habilitação e ligar a campanha no painel.
   Enquanto enabled=false, este script não recebe configuração nem cupom.

Não chama m4track e não emite os eventos dele. Lê visitor_id, session_id e UTMs
somente se já existirem.
*/
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-lovoo-welcome]');
  var storeId = script && script.getAttribute('data-store-id');
  var endpoint = (script && script.getAttribute('data-endpoint')) || '/api/nuvemshop/welcome-popup/public';
  var startedAt = Date.now();
  if (!storeId || !/^\d+$/.test(storeId)) return;
  if (location.pathname !== '/' && location.pathname !== '') return;

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
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.45);padding:16px;box-sizing:border-box;overflow:hidden;';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;border-radius:16px;padding:20px;background:' + (config.background_color || '#ffffff') + ';color:' + (config.text_color || '#111827') + ';';

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fechar';
    close.setAttribute('aria-label', 'Fechar pop-up');
    close.style.cssText = 'float:right;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;';
    close.onclick = function () { suppress(config.campaign_id, config.resurface_days || 7); root.remove(); };

    var title = document.createElement('h2');
    title.id = 'lovoo-welcome-title';
    title.textContent = config.title || 'Bem-vindo';
    title.style.margin = '0 0 8px';
    var description = document.createElement('p');
    description.textContent = config.description || '';
    if (config.image_url) {
      var image = document.createElement('img');
      image.src = config.image_url;
      image.alt = '';
      image.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;border-radius:12px;margin-bottom:12px;';
      card.appendChild(image);
    }

    var form = document.createElement('form');
    form.style.cssText = 'display:grid;gap:10px;clear:both;';
    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.minHeight = '1.2em';

    function field(labelText, input) {
      var label = document.createElement('label');
      label.style.cssText = 'display:grid;gap:4px;font-size:14px;';
      label.appendChild(document.createTextNode(labelText));
      input.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:10px;font:inherit;';
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
    phoneRow.style.cssText = 'display:flex;gap:8px;width:100%;box-sizing:border-box;';
    var prefix = document.createElement('span');
    prefix.textContent = '+55';
    prefix.style.cssText = 'display:flex;align-items:center;padding:0 10px;border:1px solid #d1d5db;border-radius:8px;';
    var phone = document.createElement('input');
    phone.name = 'phone';
    phone.type = 'tel';
    phone.inputMode = 'numeric';
    phone.autocomplete = 'tel';
    phone.placeholder = '(11) 99999-9999';
    phone.required = true;
    phone.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:10px;font:inherit;';
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
    submit.style.cssText = 'width:100%;border:0;border-radius:8px;padding:12px;font:inherit;cursor:pointer;background:' + (config.button_color || '#111827') + ';color:#fff;';

    form.appendChild(field('Nome', name));
    form.appendChild(field('E-mail', email));
    var phoneLabel = document.createElement('label');
    phoneLabel.style.cssText = 'display:grid;gap:4px;font-size:14px;';
    phoneLabel.appendChild(document.createTextNode('WhatsApp'));
    phoneLabel.appendChild(phoneRow);
    form.appendChild(phoneLabel);
    form.appendChild(checkLabel(couponConsent, config.consent_text || 'Aceito receber o cupom.'));
    if (config.promo_consent_text) form.appendChild(checkLabel(promoConsent, config.promo_consent_text));
    form.appendChild(honey);
    form.appendChild(submit);
    form.appendChild(status);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var emailValue = normalizeEmail(email.value);
      var phoneValue = validPhone(phone.value);
      if (!name.value.trim() || !emailValue || !phoneValue || !couponConsent.checked) {
        status.textContent = 'Revise nome, e-mail, WhatsApp e o aceite do cupom.';
        return;
      }
      var payloadKey = [config.campaign_id, name.value.trim(), emailValue, phoneValue, couponConsent.checked, promoConsent.checked].join('|');
      submit.disabled = true;
      status.textContent = 'Enviando…';
      fetch(endpoint + '?store_id=' + encodeURIComponent(storeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          attempt_id: attemptFor(payloadKey),
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
          submit.disabled = false;
          if (!result.body || result.body.coupon_revealed !== true) {
            status.textContent = (result.body && result.body.error) || 'Não foi possível concluir o cadastro.';
            return;
          }
          status.textContent = 'Cadastro recebido. Seu código: ' + result.body.coupon_code + '. O desconto só vale depois de aplicado no carrinho.';
          var actions = document.createElement('div');
          actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
          var apply = document.createElement('a');
          apply.href = result.body.apply_url;
          apply.textContent = 'Aplicar cupom';
          var copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = 'Copiar código';
          copy.onclick = function () {
            if (navigator.clipboard) navigator.clipboard.writeText(result.body.coupon_code);
          };
          actions.appendChild(apply);
          actions.appendChild(copy);
          form.appendChild(actions);
          suppress(config.campaign_id, config.resurface_days || 7);
          window.setTimeout(function () {
            if (typeof window.__lovooNavigate === 'function') window.__lovooNavigate(result.body.apply_url);
            else location.assign(result.body.apply_url);
          }, 1200);
        })
        .catch(function () {
          submit.disabled = false;
          status.textContent = 'Não foi possível enviar agora. Tente novamente.';
        });
    });

    card.appendChild(close);
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(form);
    root.appendChild(card);
    document.body.appendChild(root);
    close.focus();
  }

  function checkLabel(input, text) {
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;gap:8px;align-items:flex-start;font-size:14px;';
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
