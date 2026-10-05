// =============================================================================
// historicalTemplateButtons — sanitização frontend do GET template_buttons
//
// Módulo puro: sem IO, sem fetch, sem Graph, sem auth.
// Única implementação completa da sanitização histórica no frontend.
//
// Não reconstrói botões a partir de template_name, picker ou Graph.
// Não lança. Wrapper persistido { v, buttons } nunca é aceito.
// =============================================================================

import type { MetaHistoricalTemplateButton } from '../types/meta-whatsapp'

const MAX_INDEX = 9
const MAX_TEXT  = 64
const MAX_HREF  = 2048

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_INDEX
}

function isValidText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_TEXT
}

/**
 * WHATWG URL só valida. Nunca retornar parsed.toString().
 * Defesa de boundary para o renderer histórico.
 */
export function isSafeHistoricalHref(href: string): boolean {
  if (typeof href !== 'string' || href.length === 0 || href.length > MAX_HREF) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!parsed.hostname) return false
  if (parsed.username !== '' || parsed.password !== '') return false
  return true
}

function sanitizeQuickReply(item: Record<string, unknown>): MetaHistoricalTemplateButton | null {
  if (item.type !== 'QUICK_REPLY') return null
  if (Object.prototype.hasOwnProperty.call(item, 'payload')) return null
  if (!isValidIndex(item.index) || !isValidText(item.text)) return null
  return {
    type:  'QUICK_REPLY',
    index: item.index,
    text:  item.text,
  }
}

function sanitizeUrl(item: Record<string, unknown>): MetaHistoricalTemplateButton | null {
  if (item.type !== 'URL') return null
  if (!isValidIndex(item.index) || !isValidText(item.text)) return null
  if (typeof item.href !== 'string' || !isSafeHistoricalHref(item.href)) return null
  return {
    type:  'URL',
    index: item.index,
    text:  item.text,
    href:  item.href,
  }
}

/**
 * Sanitiza o campo público GET `template_buttons`.
 * Aceita somente array público. Wrapper { v, buttons } → null.
 * Itens inválidos são dropados. Todos dropados → null. Nunca lança.
 */
export function sanitizeHistoricalTemplateButtons(
  raw: unknown,
): MetaHistoricalTemplateButton[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  const out: MetaHistoricalTemplateButton[] = []

  for (const item of raw) {
    if (!isPlainObject(item)) continue

    if (item.type === 'QUICK_REPLY') {
      const qr = sanitizeQuickReply(item)
      if (qr) out.push(qr)
      continue
    }

    if (item.type === 'URL') {
      const url = sanitizeUrl(item)
      if (url) out.push(url)
    }
  }

  return out.length === 0 ? null : out
}
