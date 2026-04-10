/**
 * promptVariables.ts
 *
 * Catálogo de variáveis disponíveis para uso em prompts de agentes e
 * diretrizes globais de IA.
 *
 * IMPORTANTE: este arquivo espelha POLICY_VARIABLES_CATALOG de
 * api/lib/utils/policyVariables.js. Manter sincronizados.
 *
 * Grupos estáticos: Runtime, Empresa, Lead, Oportunidade.
 * Campos personalizados (cp_*) são dinâmicos e passados via prop customFieldVariables.
 */

export interface PromptVariable {
  group: string
  variable: string       // ex: '{{lead_nome}}'
  description: string
  example: string
  /** Quando true, a variável só está disponível se o contexto existir (lead/oportunidade) */
  conditional?: boolean
}

export const PROMPT_VARIABLES: PromptVariable[] = [
  // ── Runtime ──────────────────────────────────────────────────────────────
  { group: 'Runtime', variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',   example: '08/04/2026' },
  { group: 'Runtime', variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',   example: '14:30' },
  { group: 'Runtime', variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',              example: '08/04/2026 14:30' },

  // ── Empresa ───────────────────────────────────────────────────────────────
  { group: 'Empresa', variable: '{{nome_empresa}}',    description: 'Nome oficial da empresa',                 example: 'Lovoo Ltda' },
  { group: 'Empresa', variable: '{{nome_fantasia}}',   description: 'Nome fantasia',                           example: 'Lovoo CRM' },
  { group: 'Empresa', variable: '{{telefone}}',        description: 'Telefone principal',                      example: '+55 11 99999-9999' },
  { group: 'Empresa', variable: '{{email}}',           description: 'E-mail principal',                        example: 'contato@empresa.com' },
  { group: 'Empresa', variable: '{{site}}',            description: 'Site principal',                          example: 'https://empresa.com' },
  { group: 'Empresa', variable: '{{cidade}}',          description: 'Cidade',                                  example: 'São Paulo' },
  { group: 'Empresa', variable: '{{estado}}',          description: 'Estado',                                  example: 'SP' },
  { group: 'Empresa', variable: '{{cep}}',             description: 'CEP',                                     example: '01310-100' },
  { group: 'Empresa', variable: '{{logradouro}}',      description: 'Logradouro (rua/avenida)',                 example: 'Av. Paulista, 1000' },
  { group: 'Empresa', variable: '{{bairro}}',          description: 'Bairro',                                  example: 'Bela Vista' },
  { group: 'Empresa', variable: '{{pais}}',            description: 'País',                                    example: 'Brasil' },
  { group: 'Empresa', variable: '{{idioma}}',          description: 'Idioma derivado do país configurado',     example: 'Português (pt-BR)' },
  { group: 'Empresa', variable: '{{fuso_horario}}',    description: 'Fuso horário configurado',                example: 'America/Sao_Paulo' },
  { group: 'Empresa', variable: '{{moeda}}',           description: 'Moeda padrão',                            example: 'BRL' },
  { group: 'Empresa', variable: '{{ramo_atividade}}',  description: 'Ramo de atividade',                       example: 'Tecnologia' },

  // ── Lead / Contato ────────────────────────────────────────────────────────
  { group: 'Lead', variable: '{{lead_nome}}',          description: 'Nome do lead/contato',                    example: 'João Silva',          conditional: true },
  { group: 'Lead', variable: '{{lead_email}}',         description: 'E-mail do lead',                          example: 'joao@email.com',       conditional: true },
  { group: 'Lead', variable: '{{lead_telefone}}',      description: 'Telefone do lead',                        example: '+55 11 98765-4321',    conditional: true },
  { group: 'Lead', variable: '{{lead_empresa}}',       description: 'Empresa do lead',                         example: 'Empresa XYZ',          conditional: true },
  { group: 'Lead', variable: '{{lead_cargo}}',         description: 'Cargo do lead',                           example: 'Gerente de Compras',   conditional: true },
  { group: 'Lead', variable: '{{lead_cidade}}',        description: 'Cidade do lead',                          example: 'Campinas',             conditional: true },
  { group: 'Lead', variable: '{{lead_estado}}',        description: 'Estado do lead',                          example: 'SP',                   conditional: true },
  { group: 'Lead', variable: '{{lead_cep}}',           description: 'CEP do lead',                             example: '13010-100',            conditional: true },
  { group: 'Lead', variable: '{{lead_endereco}}',      description: 'Endereço do lead',                        example: 'Rua das Flores, 42',   conditional: true },
  { group: 'Lead', variable: '{{lead_bairro}}',        description: 'Bairro do lead',                          example: 'Centro',               conditional: true },
  { group: 'Lead', variable: '{{lead_origem}}',        description: 'Origem do lead',                          example: 'WhatsApp',             conditional: true },

  // ── Oportunidade ──────────────────────────────────────────────────────────
  { group: 'Oportunidade', variable: '{{oportunidade_titulo}}',        description: 'Título da oportunidade aberta',    example: 'Proposta Premium',     conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_valor}}',         description: 'Valor da oportunidade',            example: 'R$ 5.000,00',          conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_etapa}}',         description: 'Etapa atual no funil',             example: 'Proposta Enviada',      conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_status}}',        description: 'Status (Aberta/Ganha/Perdida)',     example: 'Aberta',               conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_probabilidade}}', description: 'Probabilidade de fechamento',       example: '75%',                  conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_previsao}}',      description: 'Previsão de fechamento',           example: '30/05/2026',           conditional: true },
]

/** Grupos únicos na ordem de exibição */
export const PROMPT_VARIABLE_GROUPS = ['Runtime', 'Empresa', 'Lead', 'Oportunidade'] as const

/**
 * Transforma campos personalizados (retornados por api.getCustomFields)
 * no formato PromptVariable para exibição no painel de variáveis.
 */
export function customFieldsToVariables(
  fields: Array<{ field_name: string; field_label: string; field_type: string }>
): PromptVariable[] {
  return fields.map(f => ({
    group:       'Campos Personalizados',
    variable:    `{{cp_${f.field_name}}}`,
    description: f.field_label,
    example:     f.field_type === 'date' ? '01/01/1990'
               : f.field_type === 'number' ? '42'
               : 'valor do campo',
    conditional: true,
  }))
}
