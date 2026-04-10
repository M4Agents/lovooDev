/**
 * variablesCatalog.ts
 *
 * Fonte única de verdade para:
 *   - variáveis disponíveis em prompts (PROMPT_VARIABLES)
 *   - seções do builder estruturado (SECTION_ORDER, SECTION_CATALOG)
 *   - tipos compartilhados (PromptConfig, PromptSection, SectionId)
 *
 * Importado por:
 *   - api/lib/agents/promptAssembler.ts  (assembly backend)
 *   - api/lib/agents/promptConfigValidator.ts (validação backend)
 *   - src/lib/promptVariables.ts          (re-export para frontend)
 *
 * Regras:
 *   - módulo puramente de dados — sem imports externos
 *   - seguro para uso em frontend (Vite) e backend (Node/Vercel)
 */

// ── Variáveis de prompt ───────────────────────────────────────────────────────

export interface PromptVariable {
  group:        string
  variable:     string       // ex: '{{lead_nome}}'
  description:  string
  example:      string
  conditional?: boolean
}

export const PROMPT_VARIABLES: PromptVariable[] = [
  // ── Runtime ──────────────────────────────────────────────────────────────
  { group: 'Runtime', variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',   example: '08/04/2026' },
  { group: 'Runtime', variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',   example: '14:30' },
  { group: 'Runtime', variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',              example: '08/04/2026 14:30' },

  // ── Empresa ───────────────────────────────────────────────────────────────
  { group: 'Empresa', variable: '{{nome_empresa}}',   description: 'Nome oficial da empresa',                 example: 'Lovoo Ltda' },
  { group: 'Empresa', variable: '{{nome_fantasia}}',  description: 'Nome fantasia',                           example: 'Lovoo CRM' },
  { group: 'Empresa', variable: '{{telefone}}',       description: 'Telefone principal',                      example: '+55 11 99999-9999' },
  { group: 'Empresa', variable: '{{email}}',          description: 'E-mail principal',                        example: 'contato@empresa.com' },
  { group: 'Empresa', variable: '{{site}}',           description: 'Site principal',                          example: 'https://empresa.com' },
  { group: 'Empresa', variable: '{{cidade}}',         description: 'Cidade',                                  example: 'São Paulo' },
  { group: 'Empresa', variable: '{{estado}}',         description: 'Estado',                                  example: 'SP' },
  { group: 'Empresa', variable: '{{cep}}',            description: 'CEP',                                     example: '01310-100' },
  { group: 'Empresa', variable: '{{logradouro}}',     description: 'Logradouro (rua/avenida)',                 example: 'Av. Paulista, 1000' },
  { group: 'Empresa', variable: '{{bairro}}',         description: 'Bairro',                                  example: 'Bela Vista' },
  { group: 'Empresa', variable: '{{pais}}',           description: 'País',                                    example: 'Brasil' },
  { group: 'Empresa', variable: '{{idioma}}',         description: 'Idioma derivado do país configurado',     example: 'Português (pt-BR)' },
  { group: 'Empresa', variable: '{{fuso_horario}}',   description: 'Fuso horário configurado',                example: 'America/Sao_Paulo' },
  { group: 'Empresa', variable: '{{moeda}}',          description: 'Moeda padrão',                            example: 'BRL' },
  { group: 'Empresa', variable: '{{ramo_atividade}}', description: 'Ramo de atividade',                       example: 'Tecnologia' },

  // ── Lead / Contato ────────────────────────────────────────────────────────
  { group: 'Lead', variable: '{{lead_nome}}',      description: 'Nome do lead/contato',    example: 'João Silva',          conditional: true },
  { group: 'Lead', variable: '{{lead_email}}',     description: 'E-mail do lead',          example: 'joao@email.com',       conditional: true },
  { group: 'Lead', variable: '{{lead_telefone}}',  description: 'Telefone do lead',        example: '+55 11 98765-4321',    conditional: true },
  { group: 'Lead', variable: '{{lead_empresa}}',   description: 'Empresa do lead',         example: 'Empresa XYZ',          conditional: true },
  { group: 'Lead', variable: '{{lead_cargo}}',     description: 'Cargo do lead',           example: 'Gerente de Compras',   conditional: true },
  { group: 'Lead', variable: '{{lead_cidade}}',    description: 'Cidade do lead',          example: 'Campinas',             conditional: true },
  { group: 'Lead', variable: '{{lead_estado}}',    description: 'Estado do lead',          example: 'SP',                   conditional: true },
  { group: 'Lead', variable: '{{lead_cep}}',       description: 'CEP do lead',             example: '13010-100',            conditional: true },
  { group: 'Lead', variable: '{{lead_endereco}}',  description: 'Endereço do lead',        example: 'Rua das Flores, 42',   conditional: true },
  { group: 'Lead', variable: '{{lead_bairro}}',    description: 'Bairro do lead',          example: 'Centro',               conditional: true },
  { group: 'Lead', variable: '{{lead_origem}}',    description: 'Origem do lead',          example: 'WhatsApp',             conditional: true },

  // ── Oportunidade ──────────────────────────────────────────────────────────
  { group: 'Oportunidade', variable: '{{oportunidade_titulo}}',        description: 'Título da oportunidade aberta',    example: 'Proposta Premium',  conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_valor}}',         description: 'Valor da oportunidade',            example: 'R$ 5.000,00',       conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_etapa}}',         description: 'Etapa atual no funil',             example: 'Proposta Enviada',   conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_status}}',        description: 'Status (Aberta/Ganha/Perdida)',     example: 'Aberta',            conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_probabilidade}}', description: 'Probabilidade de fechamento',      example: '75%',               conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_previsao}}',      description: 'Previsão de fechamento',           example: '30/05/2026',        conditional: true },
]

export const PROMPT_VARIABLE_GROUPS = ['Runtime', 'Empresa', 'Lead', 'Oportunidade'] as const

export function customFieldsToVariables(
  fields: Array<{ field_name: string; field_label: string; field_type: string }>
): PromptVariable[] {
  return fields.map(f => ({
    group:       'Campos Personalizados',
    variable:    `{{cp_${f.field_name}}}`,
    description: f.field_label,
    example:     f.field_type === 'date'   ? '01/01/1990'
               : f.field_type === 'number' ? '42'
               : 'valor do campo',
    conditional: true,
  }))
}

// ── Seções do builder estruturado ─────────────────────────────────────────────

export const SECTION_ORDER = [
  'identity',
  'objective',
  'communication_rules',
  'conversation_flow',
  'pricing',
  'lead_qualification',
  'scheduling',
  'restrictions',
  'handoff',
  'fallback_instruction',
] as const

export type SectionId = typeof SECTION_ORDER[number]

export interface SectionMeta {
  label:       string
  placeholder: string
}

export const SECTION_CATALOG: Record<SectionId, SectionMeta> = {
  identity: {
    label:       'Identidade e Personalidade',
    placeholder: 'Descreva quem é o agente, seu nome, personalidade e tom de voz.\n\nEx: Você é o assistente virtual da {{nome_fantasia}}, chamado de "Assistente". Seu tom é profissional, mas próximo e gentil.',
  },
  objective: {
    label:       'Objetivo Principal',
    placeholder: 'Qual é o objetivo central deste agente?\n\nEx: Seu objetivo é atender leads pelo WhatsApp, entender suas necessidades e encaminhá-los para a equipe de vendas.',
  },
  communication_rules: {
    label:       'Regras de Comunicação',
    placeholder: 'Como o agente deve se comunicar?\n\nEx: Use linguagem simples e objetiva. Não use gírias. Responda em Português (pt-BR). Limite respostas a no máximo 3 parágrafos.',
  },
  conversation_flow: {
    label:       'Fluxo de Conversa',
    placeholder: 'Descreva o fluxo esperado da conversa.\n\nEx: 1. Cumprimente o lead. 2. Pergunte sobre a necessidade. 3. Apresente soluções. 4. Ofereça agendamento.',
  },
  pricing: {
    label:       'Preços e Valores',
    placeholder: 'Informações de preços que o agente pode compartilhar.\n\nEx: Plano básico: R$ 99/mês. Plano profissional: R$ 199/mês. Não ofereça descontos sem aprovação.',
  },
  lead_qualification: {
    label:       'Qualificação de Lead',
    placeholder: 'Como qualificar o lead?\n\nEx: Pergunte: qual o porte da empresa? quantos usuários? qual o orçamento mensal? Leads com orçamento acima de R$ 500/mês são prioritários.',
  },
  scheduling: {
    label:       'Agendamento',
    placeholder: 'Regras de agendamento.\n\nEx: Ofereça horários de segunda a sexta, das 9h às 18h ({{fuso_horario}}). Link: https://calendly.com/empresa.',
  },
  restrictions: {
    label:       'Restrições e Limites',
    placeholder: 'O que o agente NÃO deve fazer?\n\nEx: Não discuta concorrentes. Não faça promessas de entrega sem confirmação. Não compartilhe dados internos.',
  },
  handoff: {
    label:       'Handoff para Humano',
    placeholder: 'Quando e como transferir para um humano?\n\nEx: Transfira quando: o lead solicitar falar com uma pessoa, houver reclamação grave, ou após 10 trocas sem resolução.',
  },
  fallback_instruction: {
    label:       'Instrução de Fallback',
    placeholder: 'O que fazer quando o agente não souber responder?\n\nEx: Se não souber, diga: "Vou verificar com nossa equipe e retorno em breve." Nunca invente informações.',
  },
}

// ── Tipos do prompt_config ────────────────────────────────────────────────────

export interface PromptSection {
  enabled: boolean
  content: string
}

export interface PromptConfig {
  version:  1
  mode:     'structured'
  sections: Partial<Record<SectionId, PromptSection>>
}
