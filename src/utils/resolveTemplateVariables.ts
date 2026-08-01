/**
 * Resolução de variáveis dinâmicas em templates de mensagem.
 *
 * Regras:
 * - Substitui apenas placeholders conhecidos listados abaixo.
 * - Variáveis desconhecidas → string vazia (sem vazar {{...}} para o usuário).
 * - NÃO usa eval, Function() ou qualquer execução dinâmica.
 * - Regex fixa para cada variável suportada.
 *
 * Formatos suportados:
 * - Legado: {{nome_lead}}, {{nome_atendente}}
 * - Unificado (mesmo padrão das automações): {{lead.nome}}, {{lead.telefone}},
 *   {{lead.empresa}}, {{atendente.nome}}, {{data.hoje}}, {{data.hora}}
 */

export interface TemplateVariableContext {
  /** Nome do lead (contact_name da conversa). */
  nome_lead?: string | null
  /** Nome do atendente logado (full_name do user_metadata ou email como fallback). */
  nome_atendente?: string | null
  /** Telefone do lead (contact_phone da conversa). */
  lead_telefone?: string | null
  /** Empresa do lead (company_name da conversa). */
  lead_empresa?: string | null
}

/**
 * Mapeamento de placeholders → chave do contexto.
 * Formatos legado e novo apontam para as mesmas chaves (aliases).
 */
const KNOWN_VARS: Array<{ pattern: RegExp; key: keyof TemplateVariableContext }> = [
  // Legado — mantidos para compatibilidade com templates já cadastrados
  { pattern: /\{\{nome_lead\}\}/g,       key: 'nome_lead'      },
  { pattern: /\{\{nome_atendente\}\}/g,  key: 'nome_atendente' },
  // Novo formato unificado com automações
  { pattern: /\{\{lead\.nome\}\}/g,      key: 'nome_lead'      },
  { pattern: /\{\{atendente\.nome\}\}/g, key: 'nome_atendente' },
  { pattern: /\{\{lead\.telefone\}\}/g,  key: 'lead_telefone'  },
  { pattern: /\{\{lead\.empresa\}\}/g,   key: 'lead_empresa'   },
]

/** Regex para capturar qualquer variável desconhecida após substituir as conhecidas. */
const UNKNOWN_VAR_PATTERN = /\{\{[^}]+\}\}/g

/**
 * Substitui placeholders do template pelo valor do contexto.
 * - Variáveis de lead/atendente: resolvidas pelo contexto passado.
 * - Variáveis de data/hora: computadas no momento da chamada.
 * - Variáveis sem mapeamento → ''.
 */
export function resolveTemplateVariables(
  content: string,
  ctx: TemplateVariableContext,
): string {
  let result = content

  for (const { pattern, key } of KNOWN_VARS) {
    result = result.replace(pattern, ctx[key]?.trim() || '')
  }

  // Data e hora computadas no momento da resolução (sem necessidade de contexto)
  const now = new Date()
  result = result.replace(/\{\{data\.hoje\}\}/g, now.toLocaleDateString('pt-BR'))
  result = result.replace(/\{\{data\.hora\}\}/g, now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))

  // Limpar quaisquer placeholders não mapeados
  result = result.replace(UNKNOWN_VAR_PATTERN, '')

  return result
}

/**
 * Lista de variáveis disponíveis para exibição na UI (chips no editor de templates).
 * Ordem intencional: mais comuns primeiro.
 */
export const AVAILABLE_TEMPLATE_VARIABLES: Array<{
  variable: string
  label: string
  description: string
}> = [
  { variable: '{{lead.nome}}',       label: 'Nome do lead',     description: 'Nome do contato na conversa'          },
  { variable: '{{lead.telefone}}',   label: 'Telefone',         description: 'Telefone do contato'                  },
  { variable: '{{lead.empresa}}',    label: 'Empresa',          description: 'Empresa do contato'                   },
  { variable: '{{atendente.nome}}',  label: 'Atendente',        description: 'Nome do atendente que enviar a mensagem' },
  { variable: '{{data.hoje}}',       label: 'Data de hoje',     description: 'Data atual no formato DD/MM/AAAA'     },
  { variable: '{{data.hora}}',       label: 'Hora atual',       description: 'Horário atual no formato HH:MM'       },
]
