// =============================================================================
// toolCatalog.ts
//
// Catálogo UI de tools disponíveis para agentes conversacionais.
// Usado exclusivamente pelo frontend para exibição e seleção.
//
// IMPORTANTE:
//   - Este arquivo é apenas descritivo (labels, descrições, categorias).
//   - NÃO define nenhuma lógica de execução.
//   - A whitelist autoritativa vive no backend (company-agents-create.js e
//     company-agents-update.js) e NÃO precisa ser mantida sincronizada aqui.
//   - O backend rejeita qualquer tool fora da whitelist, independentemente
//     do que for enviado pela UI.
// =============================================================================

export type ToolCategory = 'crm' | 'oportunidade' | 'agenda' | 'atendimento'

export interface ToolDefinitionUI {
  key:         string
  label:       string
  description: string
  category:    ToolCategory
  /**
   * Sugestão de instrução para o usuário copiar e incluir manualmente no prompt (Modo B).
   * Texto amigável, voltado ao usuário final — diferente dos TOOL_PROMPT_HINTS do backend
   * (que são instruções técnicas para o LLM). Mantenha o conteúdo coerente com o backend.
   */
  promptSuggestion?: string
}

export const TOOL_CATALOG: ToolDefinitionUI[] = [
  // ── CRM ──────────────────────────────────────────────────────────────────────
  {
    key:               'update_lead',
    label:             'Atualizar dados do cliente',
    description:       'Salva informações do cliente como nome, e-mail, telefone ou empresa quando informados durante a conversa.',
    category:          'crm',
    promptSuggestion:  'Quando o cliente informar nome, e-mail, telefone ou empresa durante a conversa, registre essas informações automaticamente no CRM.',
  },
  {
    key:               'add_tag',
    label:             'Adicionar etiqueta ao cliente',
    description:       'Marca o cliente com etiquetas como "qualificado", "sem interesse" ou outras tags configuradas no CRM.',
    category:          'crm',
    promptSuggestion:  'Marque o cliente com etiquetas como "qualificado", "sem interesse" ou "aguardando retorno" conforme o andamento da conversa.',
  },
  {
    key:               'add_note',
    label:             'Registrar anotação interna',
    description:       'Grava observações da conversa no perfil do cliente ou na oportunidade para a equipe visualizar.',
    category:          'crm',
    promptSuggestion:  'Registre observações internas relevantes sobre o cliente ou sobre pontos importantes da conversa para que a equipe possa visualizar.',
  },

  // ── Oportunidade ─────────────────────────────────────────────────────────────
  {
    key:               'update_opportunity',
    label:             'Atualizar oportunidade',
    description:       'Edita informações da oportunidade como valor estimado, probabilidade de fechamento ou previsão.',
    category:          'oportunidade',
    promptSuggestion:  'Atualize o valor estimado, probabilidade ou previsão de fechamento da oportunidade quando o cliente der sinais concretos de avanço.',
  },
  {
    key:               'move_opportunity',
    label:             'Avançar card no funil',
    description:       'Move o card da oportunidade para a próxima etapa do funil quando o cliente demonstrar progresso.',
    category:          'oportunidade',
    promptSuggestion:  'Avance o card da oportunidade no funil quando o cliente demonstrar progresso real, como confirmar interesse ou solicitar proposta.',
  },

  // ── Agenda ────────────────────────────────────────────────────────────────────
  {
    key:               'create_activity',
    label:             'Criar atividade ou compromisso',
    description:       'Agenda reuniões, ligações e compromissos confirmados pelo cliente durante a conversa.',
    category:          'agenda',
    promptSuggestion:  'Agende reuniões, ligações ou compromissos que forem confirmados pelo cliente durante a conversa.',
  },
  {
    key:               'schedule_contact',
    label:             'Agendar retorno de contato',
    description:       'Programa o agente para retomar o contato automaticamente em uma data futura definida.',
    category:          'agenda',
    promptSuggestion:  'Programe um retorno automático ao cliente na data que ele próprio indicar ou combinar.',
  },

  // ── Atendimento ───────────────────────────────────────────────────────────────
  {
    key:               'request_handoff',
    label:             'Transferir para atendente humano',
    description:       'Encaminha a conversa para um atendente da equipe quando solicitado ou quando necessário.',
    category:          'atendimento',
    promptSuggestion:  'Transfira o atendimento para um atendente humano quando o cliente solicitar falar com uma pessoa ou quando a situação exigir intervenção humana.',
  },
  {
    key:               'send_media',
    label:             'Enviar mídias do catálogo',
    description:       'Envia imagens ou vídeos do produto ou serviço em foco, conforme a intenção definida (apresentação, prova social ou detalhe técnico).',
    category:          'atendimento',
    promptSuggestion:  'Envie imagens ou vídeos do produto ou serviço em foco de acordo com a intenção identificada na conversa (apresentação, detalhe técnico ou prova social).',
  },
]

export const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  crm:          'Dados do Cliente',
  oportunidade: 'Oportunidade',
  agenda:       'Agenda',
  atendimento:  'Atendimento',
}

// Sugestões visuais por perfil de agente — apenas indicativas.
// NUNCA marcar automaticamente. Exibir como dica visual apenas.
export const TOOL_SUGGESTIONS: Record<string, string[]> = {
  qualificacao: ['update_lead', 'add_tag'],
  atendimento:  ['add_note', 'request_handoff'],
  agendamento:  ['create_activity', 'schedule_contact', 'update_lead'],
  followup:     ['schedule_contact', 'add_note'],
}

// Ordem canônica das categorias na UI
export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  'crm',
  'oportunidade',
  'agenda',
  'atendimento',
]
