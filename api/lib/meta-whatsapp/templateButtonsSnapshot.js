// =============================================================================
// templateButtonsSnapshot.js — Snapshot histórico sanitizado de botões
//
// Módulo puro: sem IO, sem DB, sem Graph, sem auth, sem env, sem logs.
// NÃO autoriza envio. Chamado somente após analyzeTemplate.supported
// e validateParameterValues.valid.
//
// Exports:
//   isSafeHttpUrl(href) — predicado HTTP/HTTPS absoluto (WHATWG; nunca toString)
//   isSafePhoneNumber(value) — predicado do número aprovado PHONE_NUMBER
//   buildTemplateButtonsSnapshot({ analysis, parameterValues })
//   sanitizeTemplateButtonsSnapshot(raw)
// =============================================================================

const MAX_BUTTONS = 10;
const MAX_INDEX   = 9;
const MAX_TEXT    = 64;
const MAX_HREF    = 2048;
const PLACEHOLDER = '{{1}}';
const RE_PLACEHOLDER = /\{\{([^}]*)\}\}/g;

// Teto Meta (20) + E.164 mínimo defensivo (8 dígitos). Não normaliza o valor.
const RE_SAFE_PHONE_NUMBER = /^\+?[0-9]{8,20}$/;
const MAX_PHONE_NUMBER_LEN = 20;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidIndex(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_INDEX;
}

function isValidText(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_TEXT;
}

function countPlaceholders(str) {
  const re = new RegExp(RE_PLACEHOLDER.source, 'g');
  let count = 0;
  while (re.exec(str) !== null) count += 1;
  return count;
}

function firstPlaceholderInner(str) {
  const re = new RegExp(RE_PLACEHOLDER.source, 'g');
  const match = re.exec(str);
  return match ? match[1] : null;
}

/**
 * Valida o número aprovado do botão PHONE_NUMBER.
 * Não trim, não normaliza, não aceita tel:/javascript:/espaços.
 * Fonte única da política usada pelo snapshot e pelo predicado send-ready.
 * Não autoriza envio por si só.
 */
export function isSafePhoneNumber(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_PHONE_NUMBER_LEN) return false;
  return RE_SAFE_PHONE_NUMBER.test(value);
}

/**
 * WHATWG URL só valida. Nunca persistir url.toString().
 * Fonte única da política HTTP/HTTPS usada pelo snapshot e pelo predicado
 * static-ready do engine. Não autoriza envio por si só.
 */
export function isSafeHttpUrl(href) {
  if (typeof href !== 'string' || href.length === 0 || href.length > MAX_HREF) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  return true;
}

function buildQuickReplySnapshot(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > MAX_BUTTONS) {
    return null;
  }

  const out = [];
  for (const button of buttons) {
    if (!isPlainObject(button)) return null;
    if (button.type !== 'QUICK_REPLY') return null;
    if (!isValidIndex(button.index)) return null;
    if (!isValidText(button.text)) return null;
    out.push({
      type:  'QUICK_REPLY',
      index: button.index,
      text:  button.text,
    });
  }

  if (out.length === 0) return null;
  return { v: 1, buttons: out };
}

/**
 * Snapshot 4C.5A: href = URL aprovada original. Sem suffix, sem parameter_values.
 * URL insegura → null (fail-closed). Não autoriza send.
 * @private
 */
function buildStaticUrlSnapshot(analysis) {
  if (analysis.headerMediaFormat != null) return null;

  const buttons = analysis.buttons;
  if (!Array.isArray(buttons) || buttons.length !== 1) return null;

  const button = buttons[0];
  if (!isPlainObject(button)) return null;
  if (button.type !== 'URL') return null;
  if (button.index !== 0) return null;
  if (button.url_kind !== 'static') return null;
  if (!isValidText(button.text)) return null;
  if (typeof button.url !== 'string' || button.url.trim().length === 0) return null;
  if (countPlaceholders(button.url) !== 0) return null;
  if (!isSafeHttpUrl(button.url)) return null;

  return {
    v: 1,
    buttons: [{
      type:  'URL',
      index: 0,
      text:  button.text,
      href:  button.url,
    }],
  };
}

function buildDynamicUrlSnapshot(analysis, parameterValues) {
  if (analysis.headerMediaFormat != null) return null;
  if (analysis.parameter_format !== 'POSITIONAL') return null;

  const buttons = analysis.buttons;
  if (!Array.isArray(buttons) || buttons.length !== 1) return null;

  const button = buttons[0];
  if (!isPlainObject(button)) return null;
  if (button.type !== 'URL') return null;
  if (button.index !== 0) return null;
  if (!isValidText(button.text)) return null;
  if (typeof button.url !== 'string') return null;
  if (!button.url.endsWith(PLACEHOLDER)) return null;
  if (countPlaceholders(button.url) !== 1) return null;
  if (firstPlaceholderInner(button.url) !== '1') return null;

  if (!isPlainObject(parameterValues)) return null;
  const urlValues = parameterValues.url;
  if (!isPlainObject(urlValues)) return null;
  const keys = Object.keys(urlValues);
  if (keys.length !== 1 || keys[0] !== '0') return null;

  const suffix = urlValues['0'];
  if (typeof suffix !== 'string' || suffix.trim().length === 0) return null;

  const href = button.url.slice(0, -PLACEHOLDER.length) + suffix;
  if (!isSafeHttpUrl(href)) return null;

  return {
    v: 1,
    buttons: [{
      type:  'URL',
      index: 0,
      text:  button.text,
      href,
    }],
  };
}

/**
 * Snapshot 4C.5B.B: phone_number = valor original da definição aprovada.
 * Número inválido → null (fail-closed, sem lançar). Não autoriza send.
 * @private
 */
function buildPhoneNumberSnapshot(analysis) {
  if (analysis.headerMediaFormat != null) return null;

  const buttons = analysis.buttons;
  if (!Array.isArray(buttons) || buttons.length !== 1) return null;

  const button = buttons[0];
  if (!isPlainObject(button)) return null;
  if (button.type !== 'PHONE_NUMBER') return null;
  if (button.index !== 0) return null;
  if (!isValidText(button.text)) return null;
  if (!isSafePhoneNumber(button.phone_number)) return null;

  return {
    v: 1,
    buttons: [{
      type:         'PHONE_NUMBER',
      index:        0,
      text:         button.text,
      phone_number: button.phone_number,
    }],
  };
}

/**
 * Constrói wrapper v1 sanitizado ou null.
 * Não lança. Não autoriza send.
 *
 * @param {{ analysis?: object, parameterValues?: object }} input
 * @returns {{ v: 1, buttons: object[] } | null}
 */
export function buildTemplateButtonsSnapshot(input = {}) {
  const analysis = input?.analysis;
  if (!isPlainObject(analysis) || analysis.supported !== true) return null;

  const buttons = analysis.buttons;
  if (!Array.isArray(buttons) || buttons.length === 0) return null;

  if (buttons.every(b => b?.type === 'QUICK_REPLY')) {
    return buildQuickReplySnapshot(buttons);
  }

  if (buttons.length === 1 && buttons[0]?.type === 'URL') {
    if (buttons[0].url_kind === 'static') {
      return buildStaticUrlSnapshot(analysis);
    }
    return buildDynamicUrlSnapshot(analysis, input.parameterValues);
  }

  if (buttons.length === 1 && buttons[0]?.type === 'PHONE_NUMBER') {
    return buildPhoneNumberSnapshot(analysis);
  }

  return null;
}

/**
 * Sanitiza JSONB arbitrário para o DTO público.
 * Nunca lança. Nunca devolve wrapper `v`.
 *
 * @param {unknown} raw
 * @returns {object[] | null}
 */
export function sanitizeTemplateButtonsSnapshot(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== 1) return null;
  if (!Array.isArray(raw.buttons)) return null;
  if (raw.buttons.length < 1 || raw.buttons.length > MAX_BUTTONS) return null;

  const out = [];
  for (const button of raw.buttons) {
    if (!isPlainObject(button)) continue;

    if (button.type === 'QUICK_REPLY') {
      if (Object.prototype.hasOwnProperty.call(button, 'payload')) continue;
      if (!isValidIndex(button.index) || !isValidText(button.text)) continue;
      out.push({
        type:  'QUICK_REPLY',
        index: button.index,
        text:  button.text,
      });
      continue;
    }

    if (button.type === 'URL') {
      if (!isValidIndex(button.index) || !isValidText(button.text)) continue;
      if (typeof button.href !== 'string' || !isSafeHttpUrl(button.href)) continue;
      out.push({
        type:  'URL',
        index: button.index,
        text:  button.text,
        href:  button.href,
      });
      continue;
    }

    if (button.type === 'PHONE_NUMBER') {
      if (!isValidIndex(button.index) || !isValidText(button.text)) continue;
      if (!isSafePhoneNumber(button.phone_number)) continue;
      out.push({
        type:         'PHONE_NUMBER',
        index:        button.index,
        text:         button.text,
        phone_number: button.phone_number,
      });
    }
  }

  return out.length === 0 ? null : out;
}
