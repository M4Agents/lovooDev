// =====================================================
// KEYWORD ROUTER — Avaliador de palavras-chave
// Lê context.triggerData.text e resolve quais handles
// de saída devem ser ativados com base nas regras
// configuradas no nó keyword_router.
//
// Contrato de retorno:
//   { matchedHandles: string[] }
//   Sempre retorna ao menos ['default'] quando nenhuma
//   regra bater ou o texto estiver ausente.
// =====================================================

const MAX_RULES = 20

/**
 * @param {object} node   - nó do canvas (node.data.config contém as regras)
 * @param {object} context - contexto da execução (context.triggerData.text)
 */
export async function executeKeywordRouter(node, context) {
  const config = node.data?.config ?? {}

  // --------------------------------------------------
  // Leitura defensiva do texto da mensagem
  // --------------------------------------------------
  const rawText =
    typeof context?.triggerData?.text === 'string'
      ? context.triggerData.text
      : ''

  // --------------------------------------------------
  // Validação defensiva da configuração
  // --------------------------------------------------
  if (!Array.isArray(config.rules)) {
    console.warn('[keywordRouter] config.rules não é array — fallback para default')
    return { matchedHandles: ['default'] }
  }

  const comparisonType = ['contains', 'equals'].includes(config.comparisonType)
    ? config.comparisonType
    : 'contains'

  const caseSensitive = config.caseSensitive === true

  // Limita a MAX_RULES e garante handles únicos
  const seenHandles = new Set()
  const validRules = config.rules.slice(0, MAX_RULES).filter((rule) => {
    if (!rule || typeof rule.handle !== 'string' || rule.handle.trim() === '') return false
    if (seenHandles.has(rule.handle)) {
      console.warn(`[keywordRouter] handle duplicado ignorado: "${rule.handle}"`)
      return false
    }
    seenHandles.add(rule.handle)
    return true
  })

  // --------------------------------------------------
  // Texto preparado para comparação
  // --------------------------------------------------
  const text = caseSensitive ? rawText : rawText.toLowerCase()

  // --------------------------------------------------
  // Avaliação de cada regra
  // --------------------------------------------------
  const matchedHandles = []

  for (const rule of validRules) {
    const keywords = (Array.isArray(rule.keywords) ? rule.keywords : []).filter(
      (kw) => typeof kw === 'string' && kw.trim() !== ''
    )

    if (keywords.length === 0) continue

    const matched = keywords.some((kw) => {
      const normalizedKw = caseSensitive ? kw : kw.toLowerCase()

      if (comparisonType === 'equals') {
        return text.trim() === normalizedKw.trim()
      }

      // contains (padrão)
      return text.includes(normalizedKw)
    })

    if (matched) {
      matchedHandles.push(rule.handle)
    }
  }

  // --------------------------------------------------
  // Fallback: nenhuma regra bateu → ramo default
  // --------------------------------------------------
  if (matchedHandles.length === 0) {
    matchedHandles.push('default')
  }

  return { matchedHandles }
}
