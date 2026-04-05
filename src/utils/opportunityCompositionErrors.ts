/**
 * Parse erros RPC do módulo de composição (HINT = código OPP_*).
 */

import type { TFunction } from 'i18next'

export type ParsedOppError = {
  code: string
  message: string
  hint?: string
  details?: Record<string, unknown>
}

function extractOppCodeFromMessage(message: string): string | undefined {
  const fromWord = message.match(/\b(OPP_[A-Z0-9_]+)\b/)
  if (fromWord) return fromWord[1]
  const fromHint = message.match(/HINT:\s*(OPP_[A-Z0-9_]+)/i)
  if (fromHint) return fromHint[1]
  return undefined
}

export function parseOpportunityCompositionError(err: unknown): ParsedOppError {
  const e = err as { message?: string; hint?: string; details?: string }
  const message = e?.message || 'Erro desconhecido'
  let hint = e?.hint
  if (!hint || !/^OPP_[A-Z0-9_]+$/.test(hint)) {
    const fromMsg = extractOppCodeFromMessage(message)
    if (fromMsg) hint = fromMsg
  }
  if (hint && /^OPP_[A-Z0-9_]+$/.test(hint)) {
    let details: Record<string, unknown> | undefined
    if (e.details) {
      try {
        details = JSON.parse(e.details) as Record<string, unknown>
      } catch {
        details = undefined
      }
    }
    return { code: hint, message, hint, details }
  }
  return { code: 'UNKNOWN', message }
}

/**
 * Valor manual numérico da oportunidade (criação / formulários): finito e ≥ 0.
 */
export function normalizeOpportunityManualValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Mensagem amigável para UI: códigos OPP_* via i18n (`opportunityComposition.errors.*`);
 * demais casos usam `fallbackI18nKey` (namespace `funnel` quando `t` vem de `useTranslation('funnel')`).
 */
export function resolveOpportunityCompositionErrorMessage(
  err: unknown,
  t: TFunction,
  fallbackI18nKey: string
): string {
  const parsed = parseOpportunityCompositionError(err)
  if (parsed.code !== 'UNKNOWN' && /^OPP_[A-Z0-9_]+$/.test(parsed.code)) {
    const key = `opportunityComposition.errors.${parsed.code}`
    const translated = t(key, { defaultValue: '' })
    if (translated && translated !== key) return translated
    return t(key, { defaultValue: parsed.message })
  }
  return t(fallbackI18nKey)
}
