// =============================================================================
// Origens autorizadas, contatos de teste e o portão do endpoint público.
//
// Origem não autentica ninguém. enabled=false continua bloqueando publicação.
// O cadastro público desta etapa não grava, mesmo que a configuração pareça completa.
// =============================================================================

import { normalizeWelcomeEmail, normalizeWelcomeMobile } from './welcomeContact.js';

export const WELCOME_ORIGIN_PATTERN = '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$';
const ORIGIN_RE = new RegExp(WELCOME_ORIGIN_PATTERN);
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_ORIGINS = 8;
const MAX_CONTACTS = 5;

function fail(status, code, message, field) {
  return { ok: false, error: { status, code, message, ...(field ? { field } : {}) } };
}

export function normalizeAllowedOrigins(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: [] };
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\n+/) : null);
  if (!source) {
    return fail(400, 'validation_error', 'As origens autorizadas devem ser uma lista.', 'allowed_origins');
  }
  const origins = [];
  for (const item of source) {
    if (typeof item !== 'string') {
      return fail(400, 'validation_error', 'Cada origem deve ser um endereço https.', 'allowed_origins');
    }
    const origin = item.trim().replace(/\/$/, '');
    if (!origin) continue;
    if (!ORIGIN_RE.test(origin)) {
      return fail(
        400,
        'validation_error',
        'Cada origem deve ser https, sem caminho, usuário ou curinga.',
        'allowed_origins',
      );
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  if (origins.length > MAX_ORIGINS) {
    return fail(400, 'validation_error', `No máximo ${MAX_ORIGINS} origens autorizadas.`, 'allowed_origins');
  }
  return { ok: true, value: origins };
}

export function normalizePromoConsent(text, version) {
  const body = normalizeOptionalText(text, 'promo_consent_text', 'O texto promocional');
  if (!body.ok) return body;
  const marker = normalizeOptionalVersion(version, 'promo_consent_version', 'A versão promocional');
  if (!marker.ok) return marker;
  return { ok: true, text: body.value, version: marker.value };
}

function normalizeOptionalText(value, field, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return fail(400, 'validation_error', `${label} deve ser texto.`, field);
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > 600) {
    return fail(400, 'validation_error', `${label} pode ter no máximo 600 caracteres.`, field);
  }
  return { ok: true, value: trimmed };
}

function normalizeOptionalVersion(value, field, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !VERSION_RE.test(value.trim())) {
    return fail(400, 'validation_error', `${label} aceita letras, números, ponto, hífen e underscore.`, field);
  }
  return { ok: true, value: value.trim() };
}

export function normalizeTestContacts(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: [] };
  const source = Array.isArray(value) ? value : null;
  if (!source) {
    return fail(400, 'validation_error', 'Os contatos de teste devem ser uma lista.', 'test_contacts');
  }
  const contacts = [];
  for (const item of source) {
    const email = normalizeWelcomeEmail(item?.email);
    const phone = normalizeWelcomeMobile(item?.phone);
    if (!email || !phone) {
      return fail(
        400,
        'validation_error',
        'Cada contato de teste precisa de e-mail e celular brasileiro válidos.',
        'test_contacts',
      );
    }
    const key = `${email}|${phone}`;
    if (!contacts.some((contact) => `${contact.email}|${contact.phone}` === key)) {
      contacts.push({ email, phone });
    }
  }
  if (contacts.length > MAX_CONTACTS) {
    return fail(400, 'validation_error', `No máximo ${MAX_CONTACTS} contatos de teste.`, 'test_contacts');
  }
  return { ok: true, value: contacts };
}

export function publicationBlockers(campaign) {
  const missing = [];
  if (campaign?.enabled !== true) missing.push('enabled');
  if (!Array.isArray(campaign?.allowed_origins) || campaign.allowed_origins.length === 0) {
    missing.push('allowed_origins');
  }
  if (!campaign?.consent_text || !campaign?.consent_version) missing.push('consent');
  if (!campaign?.coupon_code) missing.push('coupon_code');
  return missing;
}

export function publicSignupClosed(campaign) {
  const missing = publicationBlockers(campaign);
  if (missing.includes('enabled') || missing.length > 0) {
    return {
      status: 409,
      code: 'publication_blocked',
      message: 'O pop-up ainda não pode ser publicado. O formulário público não está disponível.',
    };
  }
  return {
    status: 409,
    code: 'public_registration_unavailable',
    message: 'O cadastro público ainda não está disponível.',
  };
}
