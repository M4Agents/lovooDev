/**
 * Formata valor monetário com código ISO 4217 (sem conversão cambial).
 */
export function formatMoney(value: number, currencyCode: string): string {
  const code = (currencyCode || 'BRL').trim().toUpperCase()
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value) + ` ${code}`
  }
}
