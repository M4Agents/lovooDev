// =====================================================
// snapshotPeriods — Helpers de cálculo de períodos para snapshots.
//
// Fonte única de verdade para os períodos de comparação WoW/MoM.
// Importado por hooks de snapshot e pelo backend (via query params).
//
// Regras anti-distorção:
//   WoW: 7 dias fechados vs 7 dias anteriores
//   MoM: 30 dias fechados vs 30 dias anteriores
//   Nunca comparar período parcial (inclui hoje) vs período completo.
// =====================================================

export type ComparisonMode = 'wow' | 'mom'

export interface ComparisonPeriods {
  currentFrom:  string  // YYYY-MM-DD
  currentTo:    string  // YYYY-MM-DD (= yesterday)
  previousFrom: string
  previousTo:   string
  days:         number  // tamanho de cada janela
}

/** Formata Date → 'YYYY-MM-DD' em UTC */
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Subtrai N dias de uma data UTC */
function subDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() - n)
  return r
}

/**
 * Retorna os períodos de comparação para WoW ou MoM.
 * Sempre termina em yesterday (D-1) — nunca inclui hoje.
 */
export function getComparisonPeriods(mode: ComparisonMode): ComparisonPeriods {
  const today     = new Date()
  const yesterday = subDays(today, 1)
  const days      = mode === 'wow' ? 7 : 30

  const currentTo   = toYMD(yesterday)
  const currentFrom = toYMD(subDays(yesterday, days - 1))
  const previousTo  = toYMD(subDays(yesterday, days))
  const previousFrom = toYMD(subDays(yesterday, days * 2 - 1))

  return { currentFrom, currentTo, previousFrom, previousTo, days }
}

/**
 * Retorna os últimos N dias fechados (D-1 a D-N) como array de datas YYYY-MM-DD.
 */
export function getLastNDays(n: number): { fromDate: string; toDate: string } {
  const today     = new Date()
  const yesterday = subDays(today, 1)
  const fromDate  = subDays(yesterday, n - 1)
  return {
    fromDate: toYMD(fromDate),
    toDate:   toYMD(yesterday),
  }
}

/**
 * Rótulo legível do período de comparação para tooltips.
 * Ex: "vs 04/05 – 10/05"
 */
export function getComparisonLabel(mode: ComparisonMode): string {
  const { previousFrom, previousTo } = getComparisonPeriods(mode)
  const fmt = (s: string) => {
    const [, m, d] = s.split('-')
    return `${d}/${m}`
  }
  return `vs ${fmt(previousFrom)} – ${fmt(previousTo)}`
}
