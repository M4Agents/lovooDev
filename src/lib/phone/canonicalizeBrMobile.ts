/**
 * Canonicidade de telefone móvel BR.
 * Espelha public.canonicalize_br_mobile_phone no Postgres
 * e api/lib/phone/canonicalizeBrMobile.js.
 */
export function canonicalizeBrMobilePhone(
  phone: string | null | undefined
): string | null {
  if (phone == null) return null;

  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }

  if (digits.length === 12 && digits.startsWith('55')) {
    const subscriber = digits.slice(4);
    const first = subscriber.charAt(0);
    if (first >= '6' && first <= '9') {
      return digits.slice(0, 4) + '9' + subscriber;
    }
  }

  return digits;
}

/**
 * Variantes usadas no lookup de conversa/lead:
 * dígitos crus, forma canônica (com 9º) e JID WhatsApp (sem 9º).
 */
export function brMobilePhoneLookupValues(
  phone: string | null | undefined
): string[] {
  const values = new Set<string>();
  if (phone == null) return [];

  const clean = String(phone).replace(/\D/g, '');
  if (clean) values.add(clean);

  const canonical = canonicalizeBrMobilePhone(phone);
  if (canonical) values.add(canonical);

  if (
    canonical &&
    canonical.length === 13 &&
    canonical.startsWith('55') &&
    canonical.charAt(4) === '9'
  ) {
    values.add(canonical.slice(0, 4) + canonical.slice(5));
  }

  return [...values];
}
