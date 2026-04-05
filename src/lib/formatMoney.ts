/**
 * Locale sugerido para exibição de moeda (símbolo e separadores coerentes com o código ISO).
 */
export function localeForCurrency(currencyCode: string): string {
  const code = (currencyCode || 'BRL').trim().toUpperCase()
  const map: Record<string, string> = {
    BRL: 'pt-BR',
    USD: 'en-US',
    EUR: 'pt-PT',
    GBP: 'en-GB',
    ARS: 'es-AR',
    MXN: 'es-MX',
    CLP: 'es-CL',
    COP: 'es-CO',
    CAD: 'en-CA',
    JPY: 'ja-JP',
    CNY: 'zh-CN',
    CHF: 'de-CH',
  }
  return map[code] ?? 'pt-BR'
}

/**
 * Formata valor monetário com código ISO 4217 (sem conversão cambial).
 */
export function formatMoney(value: number, currencyCode: string): string {
  const code = (currencyCode || 'BRL').trim().toUpperCase()
  const locale = localeForCurrency(code)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value) + ` ${code}`
  }
}
