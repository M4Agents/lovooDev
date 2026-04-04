/** Lista enxuta ISO 4217 — alinhada à decisão de não inferir moeda pelo país. */
export const SUPPORTED_CURRENCIES = [
  { code: 'BRL', label: 'Real (BRL)' },
  { code: 'USD', label: 'Dólar americano (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'GBP', label: 'Libra esterlina (GBP)' },
  { code: 'ARS', label: 'Peso argentino (ARS)' },
  { code: 'CLP', label: 'Peso chileno (CLP)' },
  { code: 'MXN', label: 'Peso mexicano (MXN)' },
  { code: 'COP', label: 'Peso colombiano (COP)' },
  { code: 'UYU', label: 'Peso uruguaio (UYU)' },
] as const

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some(c => c.code === code)
}
