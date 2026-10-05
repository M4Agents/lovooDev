// =============================================================================
// templateButtonsSnapshot.js — Snapshot histórico sanitizado de botões
//
// Módulo puro: sem IO, sem DB, sem Graph, sem auth, sem env, sem logs.
// NÃO autoriza envio. Chamado somente após analyzeTemplate.supported
// e validateParameterValues.valid.
//
// Exports:
//   buildTemplateButtonsSnapshot({ analysis, parameterValues })
//   sanitizeTemplateButtonsSnapshot(raw)
// =============================================================================

const MAX_BUTTONS = 10;
const MAX_INDEX   = 9;
const MAX_TEXT    = 64;
const MAX_HREF    = 2048;
const PLACEHOLDER = '{{1}}';
const RE_PLACEHOLDER = /\{\{([^}]*)\}\}/g;

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
 * WHATWG URL só valida. Nunca persistir url.toString().
 * @private
 */
function isSafeHttpUrl(href) {
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
    return buildDynamicUrlSnapshot(analysis, input.parameterValues);
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
    }
  }

  return out.length === 0 ? null : out;
}
