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
