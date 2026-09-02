// =====================================================
// UTILS: Stage Transition Questions - Helpers Puros
// Data: 02/09/2026
// Objetivo: Helpers puros para serialização/canonicalização
//          de multi_select (Etapa A - R1)
// =====================================================

/**
 * Canonicaliza array de seleções múltiplas conforme ordem de options.
 * 
 * Garante:
 * - Todas seleções existem em options
 * - Ordem preservada conforme options (não ordem de seleção do usuário)
 * - Sem duplicatas
 * - Strings trimadas e não vazias
 * 
 * @param selected - Array de valores selecionados pelo usuário
 * @param options - Array de opções válidas configuradas na pergunta
 * @returns Array canonicalizado ou throw se inválido
 * 
 * @example
 * canonicalizeMultiSelectValues(['C', 'A'], ['A', 'B', 'C']) 
 * // => ['A', 'C']
 */
export function canonicalizeMultiSelectValues(
  selected: string[],
  options: string[]
): string[] {
  if (!Array.isArray(selected)) {
    throw new Error('selected deve ser um array')
  }
  
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('options deve ser um array não vazio')
  }
  
  // Validar que todas seleções existem em options
  const optionsSet = new Set(options)
  const trimmedSelected = selected.map(s => String(s).trim())
  
  for (const value of trimmedSelected) {
    if (!value) {
      throw new Error('multi_select não permite valores vazios')
    }
    if (!optionsSet.has(value)) {
      throw new Error(`Valor "${value}" não existe nas opções configuradas`)
    }
  }
  
  // Validar duplicatas
  const selectedSet = new Set(trimmedSelected)
  if (selectedSet.size !== trimmedSelected.length) {
    throw new Error('multi_select não permite valores duplicados')
  }
  
  // Canonicalizar: retornar apenas valores selecionados, na ordem de options
  const canonical: string[] = []
  for (const opt of options) {
    if (selectedSet.has(opt)) {
      canonical.push(opt)
    }
  }
  
  return canonical
}

/**
 * Serializa array canonicalizado de multi_select para string JSON.
 * 
 * Formato: JSON array compacto sem espaços extras.
 * 
 * @param selected - Array de valores selecionados (já canonicalizado)
 * @param options - Array de opções válidas (para validação)
 * @returns String JSON serializada
 * 
 * @example
 * serializeMultiSelectValue(['A', 'C'], ['A', 'B', 'C'])
 * // => '["A","C"]'
 */
export function serializeMultiSelectValue(
  selected: string[],
  options: string[]
): string {
  // Canonicalizar primeiro (valida + ordena)
  const canonical = canonicalizeMultiSelectValues(selected, options)
  
  if (canonical.length === 0) {
    throw new Error('multi_select: array vazio não deve ser persistido')
  }
  
  // Serializar como JSON compacto
  return JSON.stringify(canonical)
}

/**
 * Deserializa string JSON para array de multi_select.
 * 
 * @param value - String JSON serializada
 * @returns Array de strings
 * 
 * @example
 * deserializeMultiSelectValue('["A","C"]')
 * // => ['A', 'C']
 */
export function deserializeMultiSelectValue(value: string): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('multi_select: value deve ser string não vazia')
  }
  
  try {
    const parsed = JSON.parse(value)
    
    if (!Array.isArray(parsed)) {
      throw new Error('multi_select: value não é array JSON')
    }
    
    // Validar que todos elementos são strings
    for (const item of parsed) {
      if (typeof item !== 'string') {
        throw new Error('multi_select: todos elementos devem ser strings')
      }
    }
    
    return parsed
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('multi_select:')) {
      throw err
    }
    throw new Error(`multi_select: JSON inválido: ${err}`)
  }
}

/**
 * Valida se valor é válido para determinado tipo de pergunta.
 * 
 * @param fieldType - Tipo da pergunta
 * @param value - Valor a validar (string ou string[] para multi_select)
 * @param options - Opções configuradas (para select/multi_select)
 * @param required - Se pergunta é obrigatória
 * @returns null se válido, ou string com mensagem de erro
 */
export function validateAnswerValue(
  fieldType: string,
  value: string | string[] | null | undefined,
  options: string[] | null,
  required: boolean
): string | null {
  // Required sem valor
  if (required && !value) {
    return 'Campo obrigatório'
  }
  
  // Opcional sem valor
  if (!value) {
    return null
  }
  
  switch (fieldType) {
    case 'text':
      if (typeof value !== 'string') return 'Tipo inválido'
      if (required && value.trim() === '') return 'Campo obrigatório'
      return null
      
    case 'number':
      if (typeof value !== 'string') return 'Tipo inválido'
      if (!/^-?\d+(\.\d+)?$/.test(value)) return 'Número inválido'
      return null
      
    case 'boolean':
      if (value !== 'true' && value !== 'false') return 'Valor inválido'
      return null
      
    case 'select':
      if (typeof value !== 'string') return 'Tipo inválido'
      if (!options?.includes(value)) return 'Opção inválida'
      return null
      
    case 'multi_select':
      if (!Array.isArray(value)) return 'Tipo inválido'
      if (required && value.length === 0) return 'Selecione pelo menos uma opção'
      if (!options || options.length === 0) return 'Configuração de opções inválida'
      
      for (const v of value) {
        if (typeof v !== 'string' || !v.trim()) {
          return 'Valores devem ser strings não vazias'
        }
        if (!options.includes(v)) {
          return `Opção inválida: ${v}`
        }
      }
      
      // Validar duplicatas
      const uniqueValues = new Set(value)
      if (uniqueValues.size !== value.length) {
        return 'Duplicatas não são permitidas'
      }
      
      return null
      
    default:
      return 'Tipo de pergunta desconhecido'
  }
}
