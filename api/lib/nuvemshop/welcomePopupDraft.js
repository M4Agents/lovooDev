// =============================================================================
// welcomePopupDraft — validação do rascunho do pop-up de boas-vindas
//
// Rascunho incompleto é válido. Valor preenchido é validado.
// enabled=true é recusado enquanto o formulário público não existe.
// O company_id da linha nunca vem deste objeto.
// =============================================================================

import {
  normalizeAllowedOrigins,
  normalizePromoConsent,
  normalizeTestContacts,
} from './welcomePopupAccess.js';

export const WELCOME_WRITE_ROLES = ['super_admin', 'system_admin', 'admin', 'manager'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_RE = /^[0-9]{1,20}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;
const CODE_RE = /^[A-Z0-9_-]{3,50}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

const LIMITS = {
  title: 80,
  description: 400,
  button: 40,
  consent: 600,
  image: 500,
};

export const WELCOME_DRAFT_FIELDS = [
  'title',
  'description',
  'button_label',
  'consent_text',
  'consent_version',
  'image_url',
  'background_color',
  'text_color',
  'button_color',
  'coupon_code',
  'delay_seconds',
  'resurface_days',
  'promo_consent_text',
  'promo_consent_version',
  'allowed_origins',
  'test_contacts',
];

export function activationRequested(enabled) {
  return enabled === true || enabled === 1 || enabled === 'true' || enabled === '1';
}

function fail(status, code, message, field) {
  return { ok: false, error: { status, code, message, ...(field ? { field } : {}) } };
}

export function assertWelcomeScope(companyId, storeId) {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return fail(400, 'validation_error', 'company_id inválido.', 'company_id');
  }
  const store = storeId == null ? '' : String(storeId);
  if (!STORE_RE.test(store)) {
    return fail(400, 'validation_error', 'store_id inválido.', 'store_id');
  }
  return { ok: true, companyId, storeId: store };
}

function optionalText(value, max, field, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail(400, 'validation_error', `${label} deve ser texto.`, field);
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) {
    return fail(400, 'validation_error', `${label} pode ter no máximo ${max} caracteres.`, field);
  }
  return { ok: true, value: trimmed };
}

function optionalHex(value, field, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !HEX_RE.test(value.trim().toLowerCase())) {
    return fail(400, 'validation_error', `${label} deve estar no formato #RRGGBB.`, field);
  }
  return { ok: true, value: value.trim().toLowerCase() };
}

function optionalInt(value, min, max, field, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  const raw = typeof value === 'number' ? value : (typeof value === 'string' ? value.trim() : null);
  if (raw === null || (typeof raw === 'string' && !/^-?\d+$/.test(raw))) {
    return fail(400, 'validation_error', `${label} deve ser um número inteiro.`, field);
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return fail(400, 'validation_error', `${label} deve estar entre ${min} e ${max}.`, field);
  }
  return { ok: true, value: n };
}

function optionalImage(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return fail(400, 'validation_error', 'A imagem deve ser uma URL.', 'image_url');
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > LIMITS.image) {
    return fail(400, 'validation_error', 'A URL da imagem pode ter no máximo 500 caracteres.', 'image_url');
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return fail(400, 'validation_error', 'A imagem deve ser uma URL https válida.', 'image_url');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return fail(400, 'validation_error', 'A imagem deve ser uma URL https, sem credenciais.', 'image_url');
  }
  return { ok: true, value: url.toString() };
}

function optionalCoupon(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') {
    return fail(400, 'validation_error', 'O código do cupom deve ser texto.', 'coupon_code');
  }
  const code = value.trim().toUpperCase();
  if (!code) return { ok: true, value: null };
  if (!CODE_RE.test(code)) {
    return fail(400, 'validation_error', 'O código aceita de 3 a 50 letras, números, hífen ou underscore.', 'coupon_code');
  }
  return { ok: true, value: code };
}

function optionalVersion(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') {
    return fail(400, 'validation_error', 'A versão do consentimento deve ser texto.', 'consent_version');
  }
  const version = value.trim();
  if (!version) return { ok: true, value: null };
  if (!VERSION_RE.test(version)) {
    return fail(
      400,
      'validation_error',
      'A versão do consentimento aceita letras, números, ponto, hífen e underscore.',
      'consent_version',
    );
  }
  return { ok: true, value: version };
}

export function normalizeWelcomeDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail(400, 'validation_error', 'Corpo inválido.');
  }
  if (activationRequested(input.enabled)) {
    return fail(
      409,
      'publication_blocked',
      'O pop-up ainda não pode ser publicado. O formulário público não está disponível.',
      'enabled',
    );
  }
  if (
    input.page_rule !== undefined
    && input.page_rule !== null
    && input.page_rule !== ''
    && input.page_rule !== 'home'
  ) {
    return fail(400, 'validation_error', 'Nesta etapa o pop-up fica restrito à página inicial.', 'page_rule');
  }

  const fields = [
    optionalText(input.title, LIMITS.title, 'title', 'O título'),
    optionalText(input.description, LIMITS.description, 'description', 'A descrição'),
    optionalText(input.button_label, LIMITS.button, 'button_label', 'O texto do botão'),
    optionalText(input.consent_text, LIMITS.consent, 'consent_text', 'O texto do consentimento'),
    optionalVersion(input.consent_version),
    optionalImage(input.image_url),
    optionalHex(input.background_color, 'background_color', 'A cor de fundo'),
    optionalHex(input.text_color, 'text_color', 'A cor do texto'),
    optionalHex(input.button_color, 'button_color', 'A cor do botão'),
    optionalCoupon(input.coupon_code),
    optionalInt(input.delay_seconds, 0, 120, 'delay_seconds', 'O atraso'),
    optionalInt(input.resurface_days, 1, 365, 'resurface_days', 'O prazo para reaparecer'),
  ];
  const invalid = fields.find((item) => !item.ok);
  if (invalid) return invalid;
  const promo = normalizePromoConsent(input.promo_consent_text, input.promo_consent_version);
  if (!promo.ok) return promo;
  const origins = normalizeAllowedOrigins(input.allowed_origins);
  if (!origins.ok) return origins;
  const contacts = normalizeTestContacts(input.test_contacts);
  if (!contacts.ok) return contacts;

  const [
    title, description, buttonLabel, consentText, consentVersion, imageUrl,
    background, textColor, buttonColor, couponCode, delaySeconds, resurfaceDays,
  ] = fields;

  return {
    ok: true,
    value: {
      enabled: false,
      page_rule: 'home',
      title: title.value,
      description: description.value,
      button_label: buttonLabel.value,
      consent_text: consentText.value,
      consent_version: consentVersion.value,
      image_url: imageUrl.value,
      background_color: background.value,
      text_color: textColor.value,
      button_color: buttonColor.value,
      coupon_code: couponCode.value,
      delay_seconds: delaySeconds.value,
      resurface_days: resurfaceDays.value,
      promo_consent_text: promo.text,
      promo_consent_version: promo.version,
      allowed_origins: origins.value,
      test_contacts: contacts.value,
    },
  };
}

export function toPublicCampaign(row, companyId, storeId) {
  const campaign = {
    id: row?.id ?? null,
    company_id: companyId,
    nuvemshop_store_id: storeId,
    enabled: false,
    page_rule: 'home',
    updated_at: row?.updated_at ?? null,
  };
  for (const field of WELCOME_DRAFT_FIELDS) {
    if (field === 'allowed_origins' || field === 'test_contacts') {
      campaign[field] = Array.isArray(row?.[field]) ? row[field] : [];
    } else {
      campaign[field] = row?.[field] ?? null;
    }
  }
  return campaign;
}

export function mergeWelcomeDraft(existing, draft) {
  const merged = { enabled: false, page_rule: 'home' };
  for (const field of WELCOME_DRAFT_FIELDS) {
    if (field === 'allowed_origins' || field === 'test_contacts') {
      const value = draft[field] === undefined ? existing?.[field] : draft[field];
      merged[field] = Array.isArray(value) ? value : [];
      continue;
    }
    merged[field] = draft[field] === undefined ? (existing?.[field] ?? null) : draft[field];
  }
  return merged;
}
