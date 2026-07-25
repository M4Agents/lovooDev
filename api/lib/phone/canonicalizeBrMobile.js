/**
 * Canonicidade de telefone móvel BR.
 * Espelha public.canonicalize_br_mobile_phone no Postgres.
 *
 * Regras:
 * 1. Extrair só dígitos
 * 2. Se 10 ou 11 dígitos (sem DDI), prefixar 55
 * 3. Se móvel BR (55 + DDD + 8) e 1º dígito do assinante for 6–9, inserir 9 após DDD
 * 4. Se já 55 + DDD + 9 + 8, manter
 * 5. Fixo / internacional / inválido: retornar só dígitos
 *
 * @param {string|null|undefined} phone
 * @returns {string|null}
 */
export function canonicalizeBrMobilePhone(phone) {
  if (phone == null) return null;

  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }

  if (digits.length === 12 && digits.startsWith('55')) {
    const subscriber = digits.slice(4); // 8 dígitos após 55+DDD
    const first = subscriber.charAt(0);
    if (first >= '6' && first <= '9') {
      return digits.slice(0, 4) + '9' + subscriber;
    }
  }

  return digits;
}
