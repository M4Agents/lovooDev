/**
 * Máscara de valor monetário alinhada ao campo principal do modal de oportunidade:
 * apenas dígitos; os dois últimos são centavos (ex.: dígitos "12345" → 123,45).
 */

export function parsePtBrMoneyInput(raw: string): { numeric: number; display: string } {
  const numbersOnly = raw.replace(/\D/g, '')
  if (!numbersOnly) {
    return { numeric: 0, display: '0,00' }
  }
  const numericValue = parseInt(numbersOnly, 10) / 100
  const display = numericValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return { numeric: numericValue, display }
}
