const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Data civil exibida no seletor, sem converter pelo fuso do navegador. */
export function civilDateFromLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Reidrata o seletor. Data civil permanece no dia escolhido.
 * Instantes antigos, gravados em ISO, continuam absolutos.
 */
export function dateFromStoredCustom(value: string): Date {
  const match = CIVIL_DATE.exec(value)
  if (!match) return new Date(value)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
}
