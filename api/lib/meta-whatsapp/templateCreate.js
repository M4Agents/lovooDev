// =============================================================================
// templateCreate.js — Validação e payload de criação de templates Meta (Fase B)
//
// Módulo puro: sem IO, Graph, auth, logs ou tokens.
// Aceita somente campos escalares do formulário Lovoo — nunca components Graph
// crus, waba_id, token, botões ou mídia.
// =============================================================================

export const TEMPLATE_CREATE_LIMITS = {
  nameMax:     512,
  headerMax:   60,
  bodyMax:     1024,
  footerMax:   60,
  exampleMax:  1024,
  headerVars:  1,
  bodyVars:    10,
};

export const TEMPLATE_CREATE_LANGUAGES = [
  { code: 'pt_BR', label: 'Português (Brasil)' },
  { code: 'pt_PT', label: 'Português (Portugal)' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en',    label: 'English' },
  { code: 'es',    label: 'Español' },
  { code: 'es_AR', label: 'Español (Argentina)' },
  { code: 'es_MX', label: 'Español (México)' },
  { code: 'es_ES', label: 'Español (España)' },
  { code: 'fr',    label: 'Français' },
  { code: 'it',    label: 'Italiano' },
  { code: 'de',    label: 'Deutsch' },
];

const LANGUAGE_CODES = new Set(TEMPLATE_CREATE_LANGUAGES.map((item) => item.code));
const CATEGORIES = new Set(['UTILITY', 'MARKETING']);
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const POSITIONAL_RE = /^\d+$/;
const NAMED_RE = /^[a-z][a-z0-9_]*$/;
const PLACEHOLDER_RE = /\{\{([^}]*)\}\}/g;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function listTemplateCreateVariables(headerText, bodyText) {
  return {
    header: collectPlaceholders(typeof headerText === 'string' ? headerText : ''),
    body: collectPlaceholders(typeof bodyText === 'string' ? bodyText : ''),
  };
}

function collectPlaceholders(text) {
  const keys = [];
  const seen = new Set();
  PLACEHOLDER_RE.lastIndex = 0;
  let match = PLACEHOLDER_RE.exec(text);
  while (match) {
    const inner = match[1];
    if (!seen.has(inner)) {
      seen.add(inner);
      keys.push(inner);
    }
    match = PLACEHOLDER_RE.exec(text);
  }
  return keys;
}

function classifyKeys(keys) {
  if (keys.length === 0) return { format: null, keys: [] };

  const allPositional = keys.every((key) => POSITIONAL_RE.test(key));
  const allNamed = keys.every((key) => NAMED_RE.test(key));

  if (allPositional) {
    const nums = keys.map(Number);
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted[0] !== 1) return { error: 'invalid_template_variables' };
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) return { error: 'invalid_template_variables' };
    }
    return { format: 'POSITIONAL', keys: sorted.map(String) };
  }

  if (allNamed) {
    return { format: 'NAMED', keys };
  }

  return { error: 'invalid_template_variables' };
}

function exampleMap(raw) {
  if (raw == null) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const next = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') return null;
    next[key] = value.trim();
  }
  return next;
}

function examplesForKeys(keys, map, prefix) {
  if (keys.length === 0) return { ok: true, values: [] };
  if (!map) return { ok: false, error: 'invalid_template_examples' };
  const values = [];
  for (const key of keys) {
    const value = map[key];
    if (typeof value !== 'string' || value.length === 0 || value.length > TEMPLATE_CREATE_LIMITS.exampleMax) {
      return { ok: false, error: 'invalid_template_examples' };
    }
    values.push({ key, value, component: prefix });
  }
  for (const extra of Object.keys(map)) {
    if (!keys.includes(extra)) return { ok: false, error: 'invalid_template_examples' };
  }
  return { ok: true, values };
}

function namedExample(params) {
  return params.map((item) => ({ param_name: item.key, example: item.value }));
}

/**
 * Valida o input do formulário e monta o body Graph de criação.
 *
 * @param {object} input
 * @returns {{ ok: true, payload: object, parameter_format: string } | { ok: false, error: string }}
 */
export function buildGraphCreatePayload(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_request' };
  }

  const name = asTrimmedString(input.name);
  if (!name || name.length > TEMPLATE_CREATE_LIMITS.nameMax || !NAME_RE.test(name)) {
    return { ok: false, error: 'invalid_template_name' };
  }

  const language = asTrimmedString(input.language);
  if (!LANGUAGE_CODES.has(language)) {
    return { ok: false, error: 'invalid_template_language' };
  }

  const category = asTrimmedString(input.category).toUpperCase();
  if (category === 'AUTHENTICATION') {
    return { ok: false, error: 'authentication_not_supported' };
  }
  if (!CATEGORIES.has(category)) {
    return { ok: false, error: 'invalid_template_category' };
  }

  if (input.buttons != null || input.components != null) {
    return { ok: false, error: 'buttons_not_supported' };
  }
  if (input.header_format != null && asTrimmedString(input.header_format).toUpperCase() !== 'TEXT') {
    return { ok: false, error: 'media_not_supported' };
  }

  const headerRaw = typeof input.header_text === 'string' ? input.header_text : '';
  const bodyText = typeof input.body_text === 'string' ? input.body_text : '';
  const footerRaw = typeof input.footer_text === 'string' ? input.footer_text : '';
  const headerText = headerRaw.trim().length > 0 ? headerRaw : '';
  const footerText = footerRaw.trim().length > 0 ? footerRaw : '';

  if (headerText.length > TEMPLATE_CREATE_LIMITS.headerMax) {
    return { ok: false, error: 'invalid_template_header' };
  }
  if (!bodyText.trim() || bodyText.length > TEMPLATE_CREATE_LIMITS.bodyMax) {
    return { ok: false, error: 'invalid_template_body' };
  }
  if (footerText.length > TEMPLATE_CREATE_LIMITS.footerMax) {
    return { ok: false, error: 'invalid_template_footer' };
  }
  if (collectPlaceholders(footerText).length > 0) {
    return { ok: false, error: 'invalid_template_footer' };
  }

  const headerKeys = collectPlaceholders(headerText);
  const bodyKeys = collectPlaceholders(bodyText);
  if (headerKeys.length > TEMPLATE_CREATE_LIMITS.headerVars) {
    return { ok: false, error: 'invalid_template_header' };
  }
  if (bodyKeys.length > TEMPLATE_CREATE_LIMITS.bodyVars) {
    return { ok: false, error: 'invalid_template_variables' };
  }

  const headerClass = classifyKeys(headerKeys);
  const bodyClass = classifyKeys(bodyKeys);
  if (headerClass.error || bodyClass.error) {
    return { ok: false, error: 'invalid_template_variables' };
  }

  const formats = [headerClass.format, bodyClass.format].filter(Boolean);
  if (formats.includes('POSITIONAL') && formats.includes('NAMED')) {
    return { ok: false, error: 'invalid_template_variables' };
  }
  const parameterFormat = formats[0] ?? 'POSITIONAL';

  const rawExamples = input.examples;
  if (rawExamples != null && (typeof rawExamples !== 'object' || Array.isArray(rawExamples))) {
    return { ok: false, error: 'invalid_template_examples' };
  }
  const headerExampleMap = exampleMap(rawExamples?.header);
  const bodyExampleMap = exampleMap(rawExamples?.body);
  if (headerExampleMap === null || bodyExampleMap === null) {
    return { ok: false, error: 'invalid_template_examples' };
  }

  const headerExamples = examplesForKeys(headerClass.keys, headerExampleMap, 'HEADER');
  const bodyExamples = examplesForKeys(bodyClass.keys, bodyExampleMap, 'BODY');
  if (!headerExamples.ok) return headerExamples;
  if (!bodyExamples.ok) return bodyExamples;

  const components = [];
  if (headerText.length > 0) {
    const header = { type: 'HEADER', format: 'TEXT', text: headerText };
    if (headerClass.keys.length > 0) {
      header.example = parameterFormat === 'NAMED'
        ? { header_text_named_params: namedExample(headerExamples.values) }
        : { header_text: headerExamples.values.map((item) => item.value) };
    }
    components.push(header);
  }

  const body = { type: 'BODY', text: bodyText };
  if (bodyClass.keys.length > 0) {
    body.example = parameterFormat === 'NAMED'
      ? { body_text_named_params: namedExample(bodyExamples.values) }
      : { body_text: [bodyExamples.values.map((item) => item.value)] };
  }
  components.push(body);

  if (footerText.length > 0) {
    components.push({ type: 'FOOTER', text: footerText });
  }

  return {
    ok: true,
    parameter_format: parameterFormat,
    payload: {
      name,
      language,
      category,
      parameter_format: parameterFormat,
      allow_category_change: true,
      components,
    },
  };
}
