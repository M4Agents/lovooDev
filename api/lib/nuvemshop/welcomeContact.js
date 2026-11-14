// =============================================================================
// E-mail e celular do ensaio do pop-up.
//
// O formato válido não confirma que a caixa ou o WhatsApp existem.
// Este módulo não altera o normalizador global de leads.
// =============================================================================

const BR_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export const EMAIL_FORMAT_MESSAGE =
  'Informe um e-mail com usuário e domínio, sem espaços. O formato não confirma que a caixa existe.';

export const MOBILE_FORMAT_MESSAGE =
  'Informe um celular brasileiro com DDD, no formato (11) 99999-9999. O formato não confirma que o WhatsApp existe.';

export function normalizeWelcomeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || /\s/.test(email)) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9._%+-]+$/.test(local)) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  return email;
}

export function collapseMobileDigits(digits) {
  if (digits.length === 13 && digits.startsWith('55')) return digits.slice(2);
  return digits;
}

export function normalizeWelcomeMobile(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const national = collapseMobileDigits(digits);
  const oneCountryCode = digits.length === 13 && digits.startsWith('55');
  if (digits.length !== 11 && !oneCountryCode) return null;
  if (national.length !== 11) return null;
  const ddd = national.slice(0, 2);
  const subscriber = national.slice(2);
  if (!BR_DDDS.has(ddd) || subscriber.length !== 9 || !subscriber.startsWith('9')) return null;
  return `55${national}`;
}

export function formatNationalMobile(digits) {
  const core = digits.slice(0, 11);
  const extra = digits.slice(11);
  if (!core && !extra) return '';
  let out = '';
  if (core) {
    out = `(${core.slice(0, Math.min(2, core.length))}`;
    if (core.length >= 2) out += ')';
    if (core.length > 2) out += ` ${core.slice(2, Math.min(7, core.length))}`;
    if (core.length > 7) out += `-${core.slice(7)}`;
  }
  return `${out}${extra}`;
}

export function digitsBeforeCaret(value, caret) {
  return value.slice(0, caret).replace(/\D/g, '').length;
}

export function caretFromDigitCount(formatted, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return formatted.length;
}

export function parseWelcomeContactList(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const contacts = [];
  for (const line of lines) {
    const comma = line.indexOf(',');
    if (comma < 0) return { ok: false, contacts: [] };
    const email = normalizeWelcomeEmail(line.slice(0, comma));
    const phone = normalizeWelcomeMobile(line.slice(comma + 1));
    if (!email || !phone) return { ok: false, contacts: [] };
    const key = `${email}|${phone}`;
    if (!contacts.some((item) => `${item.email}|${item.phone}` === key)) {
      contacts.push({ email, phone });
    }
  }
  if (contacts.length > 5) return { ok: false, contacts: [] };
  return { ok: true, contacts };
}
