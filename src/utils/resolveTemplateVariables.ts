/**
 * Resolução de variáveis dinâmicas em templates de mensagem.
 *
 * Regras:
 * - Substitui apenas placeholders conhecidos listados abaixo.
 * - Variáveis desconhecidas → string vazia (sem vazar {{...}} para o usuário).
 * - NÃO usa eval, Function() ou qualquer execução dinâmica.
 * - Regex fixa para cada variável suportada.
 */

export interface TemplateVariableContext {
  /** Nome do lead (contact_name da conversa). */
  nome_lead?: string | null
  /** Nome do atendente logado (full_name do user_metadata ou email como fallback). */
  nome_atendente?: string | null
}

const KNOWN_VARS: Array<{ pattern: RegExp; key: keyof TemplateVariableContext }> = [
  { pattern: /\{\{nome_lead\}\}/g,      key: 'nome_lead'      },
  { pattern: /\{\{nome_atendente\}\}/g, key: 'nome_atendente' },
]

/** Regex para capturar qualquer variável desconhecida após substituir as conhecidas. */
const UNKNOWN_VAR_PATTERN = /\{\{[^}]+\}\}/g

/**
 * Substitui placeholders do template pelo valor do contexto.
 * Variáveis sem mapeamento → ''.
 */
export function resolveTemplateVariables(
  content: string,
  ctx: TemplateVariableContext,
): string {
  let result = content

  for (const { pattern, key } of KNOWN_VARS) {
    result = result.replace(pattern, ctx[key]?.trim() || '')
  }

  // Limpar quaisquer placeholders não mapeados
  result = result.replace(UNKNOWN_VAR_PATTERN, '')

  return result
}
