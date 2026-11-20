import { TEMPLATE_CREATE_LIMITS, listTemplateCreateVariables } from './metaTemplateCreateModel'

export type MetaVariableKind = 'positional' | 'named'
export type MetaVariableFormat = 'POSITIONAL' | 'NAMED' | 'MIXED' | null

export type MetaVariableSuggestion = {
  id: string
  kind: MetaVariableKind
  label: string
  syntax: string
  example: string
}

export const META_NAMED_PARAMETER_SUGGESTIONS: MetaVariableSuggestion[] = [
  { id: 'nome', label: 'Nome', syntax: '{{nome}}', example: 'João', kind: 'named' },
  { id: 'data_agendamento', label: 'Data do agendamento', syntax: '{{data_agendamento}}', example: '20/11/2026', kind: 'named' },
  { id: 'nome_empresa', label: 'Nome da empresa', syntax: '{{nome_empresa}}', example: 'Lovoo', kind: 'named' },
]

export const META_VARIABLE_PARAM_DISCLAIMER =
  'Parâmetros do modelo Meta — o valor é preenchido no envio. O Lovoo não completa automaticamente campos do CRM.'

const POSITIONAL_RE = /^\d+$/
const NAMED_RE = /^[a-z][a-z0-9_]*$/

export function placeholderKey(syntax: string): string {
  return syntax.replace(/^\{\{/, '').replace(/\}\}$/, '')
}

export function classifyTemplateFormat(keys: string[]): MetaVariableFormat {
  if (keys.length === 0) return null
  const allPositional = keys.every((key) => POSITIONAL_RE.test(key))
  const allNamed = keys.every((key) => NAMED_RE.test(key))
  if (allPositional) return 'POSITIONAL'
  if (allNamed) return 'NAMED'
  return 'MIXED'
}

export function nextPositionalIndex(keys: string[]): number {
  const nums = keys.filter((key) => POSITIONAL_RE.test(key)).map(Number).sort((a, b) => a - b)
  let expected = 1
  for (const num of nums) {
    if (num === expected) expected += 1
    else if (num > expected) return expected
  }
  return expected
}

export function isInsideCompletePlaceholder(text: string, cursor: number): boolean {
  const before = text.slice(0, cursor)
  const after = text.slice(cursor)
  const lastOpen = before.lastIndexOf('{{')
  if (lastOpen === -1) return false
  if (before.slice(lastOpen + 2).includes('}}')) return false
  const closeAt = after.indexOf('}}')
  if (closeAt === -1) return false
  const nextOpen = after.indexOf('{{')
  if (nextOpen !== -1 && nextOpen < closeAt) return false
  return true
}

export function detectOpenTrigger(text: string, cursor: number): { query: string; from: number } | null {
  if (cursor < 2 || cursor > text.length) return null
  if (isInsideCompletePlaceholder(text, cursor)) return null
  const before = text.slice(0, cursor)
  const match = before.match(/\{\{([a-zA-Z0-9_]*)$/)
  if (!match || match.index == null) return null
  return { query: match[1], from: match.index }
}

export function insertMetaPlaceholder(
  text: string,
  from: number,
  to: number,
  placeholder: string,
): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(from, text.length))
  const end = Math.max(start, Math.min(to, text.length))
  const next = text.slice(0, start) + placeholder + text.slice(end)
  return { text: next, cursor: start + placeholder.length }
}

export function formatLockNote(format: MetaVariableFormat): string | null {
  if (format === 'POSITIONAL') {
    return 'Este modelo já usa variáveis posicionais ({{1}}, {{2}}...). Não misture com nomes.'
  }
  if (format === 'NAMED') {
    return 'Este modelo já usa variáveis nomeadas. Não misture com {{1}}.'
  }
  if (format === 'MIXED') {
    return 'Há formatos misturados. Corrija o texto antes de inserir outra variável.'
  }
  return 'Use só um formato: {{1}}, {{2}}... ou nomes como {{nome}}.'
}

export function filterSuggestions(
  items: MetaVariableSuggestion[],
  query: string,
): MetaVariableSuggestion[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => (
    item.label.toLowerCase().includes(needle)
    || item.syntax.toLowerCase().includes(needle)
    || item.id.toLowerCase().includes(needle)
  ))
}

export function buildMetaVariableSuggestions(args: {
  component: 'header' | 'body'
  headerText: string
  bodyText: string
}): MetaVariableSuggestion[] {
  const listed = listTemplateCreateVariables(args.headerText, args.bodyText)
  const fieldKeys = args.component === 'header' ? listed.header : listed.body
  const format = classifyTemplateFormat([...listed.header, ...listed.body])
  const headerLimit = listed.header.length >= TEMPLATE_CREATE_LIMITS.headerVars
  const bodyLimit = listed.body.length >= TEMPLATE_CREATE_LIMITS.bodyVars

  if (format === 'MIXED') return []
  if (args.component === 'header' && headerLimit) return []
  if (args.component === 'body' && bodyLimit) return []

  const suggestions: MetaVariableSuggestion[] = []
  if (format !== 'NAMED') {
    const next = nextPositionalIndex(fieldKeys)
    suggestions.push({
      id: `positional_${args.component}_${next}`,
      kind: 'positional',
      label: 'Próxima variável posicional',
      syntax: `{{${next}}}`,
      example: next === 1 ? 'João' : `Exemplo ${next}`,
    })
  }
  if (format !== 'POSITIONAL') {
    for (const item of META_NAMED_PARAMETER_SUGGESTIONS) {
      if (!fieldKeys.includes(placeholderKey(item.syntax))) suggestions.push(item)
    }
  }
  return suggestions
}
