// =====================================================
// deltaUtils — cálculo centralizado de variação histórica
//
// Fonte única da fórmula de delta para todos os endpoints v2.
// Evita divergência silenciosa entre implementações paralelas.
//
// calcDelta   → usado quando o consumidor precisa de abs + pct (ex: executive-summary-v2)
// calcDeltaPct → usado quando o consumidor precisa apenas do pct  (ex: DeltaBadge)
// =====================================================

/**
 * Calcula delta absoluto e percentual entre dois valores numéricos.
 * Retorna `{ abs, pct }`.
 *
 * Usado por endpoints que expõem delta completo (absoluto + percentual).
 */
export function calcDelta(
  current:  number,
  previous: number,
): { abs: number; pct: number } {
  const abs = current - previous
  const pct =
    previous === 0
      ? current === 0 ? 0 : 100
      : Math.round((abs / Math.abs(previous)) * 1000) / 10
  return { abs: Math.round(abs * 100) / 100, pct }
}

/**
 * Calcula apenas o delta percentual entre dois valores.
 * Retorna `null` se qualquer entrada for null.
 *
 * Usado por endpoints que alimentam DeltaBadge (apenas percentual).
 */
export function calcDeltaPct(
  curr: number | null,
  prev: number | null,
): number | null {
  if (curr === null || prev === null) return null
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10
}
