// =====================================================
// snapshotPeriods — Cálculo de períodos de comparação WoW/MoM (backend).
//
// Espelho puro de src/lib/snapshotPeriods.ts (frontend).
// Ambos devem manter implementação idêntica para garantir
// que frontend e backend calculem os mesmos períodos.
//
// Frontend: src/lib/snapshotPeriods.ts
// Backend:  api/lib/dashboard/snapshotPeriods.ts  ← este arquivo
//
// Regras anti-distorção:
//   WoW: 7 dias fechados (D-1 até D-7) vs 7 dias anteriores
//   MoM: 30 dias fechados (D-1 até D-30) vs 30 dias anteriores
//   Nunca incluir hoje (D0) — snapshots são gerados em D-1.
// =====================================================

export type ComparisonMode = 'wow' | 'mom'

export interface ComparisonPeriods {
  currentFrom:  string  // YYYY-MM-DD
  currentTo:    string  // YYYY-MM-DD (= yesterday)
  previousFrom: string
  previousTo:   string
  days:         number
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function subDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() - n)
  return r
}

/**
 * Calcula os períodos de comparação para WoW (7 dias) ou MoM (30 dias).
 * Sempre termina em D-1 (ontem). Nunca inclui hoje.
 *
 * Idêntico a getComparisonPeriods() em src/lib/snapshotPeriods.ts.
 */
export function resolveComparisonPeriods(mode: ComparisonMode): ComparisonPeriods {
  const today     = new Date()
  const yesterday = subDays(today, 1)
  const days      = mode === 'wow' ? 7 : 30

  const currentTo    = toYMD(yesterday)
  const currentFrom  = toYMD(subDays(yesterday, days - 1))
  const previousTo   = toYMD(subDays(yesterday, days))
  const previousFrom = toYMD(subDays(yesterday, days * 2 - 1))

  return { currentFrom, currentTo, previousFrom, previousTo, days }
}
