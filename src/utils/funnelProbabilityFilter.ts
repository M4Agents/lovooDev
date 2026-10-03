export type ProbabilityRange = {
  min: number | null
  max: number | null
}

export type ProbabilityDraftStatus =
  | 'empty'
  | 'ok'
  | 'invalid_number'
  | 'out_of_range'
  | 'min_gt_max'

export type ProbabilityDraftEvaluation = {
  status: ProbabilityDraftStatus
  range: ProbabilityRange
}

export const EMPTY_PROBABILITY_RANGE: ProbabilityRange = { min: null, max: null }

export const PROBABILITY_PRESETS: Array<{ id: string; min: number; max: number }> = [
  { id: 'low', min: 0, max: 39 },
  { id: 'medium', min: 40, max: 69 },
  { id: 'high', min: 70, max: 100 },
]

export function isEmptyProbabilityRange(range: ProbabilityRange): boolean {
  return range.min == null && range.max == null
}

/** Com a flag desligada a faixa nunca entra em consulta, chip ou UI. */
export function getEffectiveProbabilityRange(
  applied: ProbabilityRange,
  enabled: boolean,
): ProbabilityRange {
  return enabled ? applied : EMPTY_PROBABILITY_RANGE
}

export function probabilityRangesEqual(a: ProbabilityRange, b: ProbabilityRange): boolean {
  return a.min === b.min && a.max === b.max
}

/** Aceita só inteiro 0–100. Rejeita fração, sinal e texto. */
export function parseProbabilityInput(raw: string): number | null | 'invalid' {
  const value = raw.trim()
  if (value === '') return null
  if (!/^\d{1,3}$/.test(value)) return 'invalid'
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return 'invalid'
  return parsed
}

export function evaluateProbabilityDraft(minText: string, maxText: string): ProbabilityDraftEvaluation {
  const minParsed = parseProbabilityInput(minText)
  const maxParsed = parseProbabilityInput(maxText)

  if (minParsed === 'invalid' || maxParsed === 'invalid') {
    return { status: 'invalid_number', range: EMPTY_PROBABILITY_RANGE }
  }

  if (minParsed == null && maxParsed == null) {
    return { status: 'empty', range: EMPTY_PROBABILITY_RANGE }
  }

  if (
    (minParsed != null && (minParsed < 0 || minParsed > 100))
    || (maxParsed != null && (maxParsed < 0 || maxParsed > 100))
  ) {
    return { status: 'out_of_range', range: EMPTY_PROBABILITY_RANGE }
  }

  if (minParsed != null && maxParsed != null && minParsed > maxParsed) {
    return { status: 'min_gt_max', range: EMPTY_PROBABILITY_RANGE }
  }

  return { status: 'ok', range: { min: minParsed, max: maxParsed } }
}

/** Draft inválido não substitui a faixa já aplicada. Vazio limpa o filtro. */
export function commitProbabilityDraft(
  current: ProbabilityRange,
  minText: string,
  maxText: string,
): { applied: ProbabilityRange; status: ProbabilityDraftStatus } {
  const evaluation = evaluateProbabilityDraft(minText, maxText)
  if (evaluation.status === 'ok' || evaluation.status === 'empty') {
    return { applied: evaluation.range, status: evaluation.status }
  }
  return { applied: current, status: evaluation.status }
}

export function sanitizeStoredProbability(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    return null
  }
  return value
}

export function sanitizeStoredProbabilityRange(min: unknown, max: unknown): ProbabilityRange {
  const range = {
    min: sanitizeStoredProbability(min),
    max: sanitizeStoredProbability(max),
  }
  if (range.min != null && range.max != null && range.min > range.max) {
    return EMPTY_PROBABILITY_RANGE
  }
  return range
}

export function probabilityRangeToDraftTexts(range: ProbabilityRange): { minText: string; maxText: string } {
  return {
    minText: range.min == null ? '' : String(range.min),
    maxText: range.max == null ? '' : String(range.max),
  }
}

export function formatProbabilityRangeLabel(range: ProbabilityRange): string | null {
  if (isEmptyProbabilityRange(range)) return null
  if (range.min != null && range.max != null) return `${range.min}–${range.max}%`
  if (range.min != null) return `≥ ${range.min}%`
  return `≤ ${range.max}%`
}

export function opportunityMatchesProbabilityRange(
  probability: number | null | undefined,
  range: ProbabilityRange,
): boolean {
  if (isEmptyProbabilityRange(range)) return true
  if (probability == null) return false
  if (range.min != null && probability < range.min) return false
  if (range.max != null && probability > range.max) return false
  return true
}
