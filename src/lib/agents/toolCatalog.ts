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
  /**
   * Nota sobre restrição de canal (ex: "Apenas WhatsApp").
   * Exibida como badge informativo no seletor — não bloqueia o uso.
   */
  channelNote?: string
  /**
   * Parâmetros aceitos pela tool, em linguagem legível para o usuário.
   * Exibido abaixo da descrição quando a tool está selecionada.
   */
  params?: string
}

export const TOOL_CATALOG: ToolDefinitionUI[] = [
  // ── CRM ──────────────────────────────────────────────────────────────────────
  {
    key:               'update_lead',
    label:             'Atualizar dados do cliente',
    description:       'Salva informações do cliente como nome, e-mail, telefone ou empresa quando informados durante a conversa.',
    category:          'crm',
    promptSuggestion:  'Quando o cliente informar nome, e-mail, telefone ou empresa, use update_lead para salvar automaticamente no CRM.',
    params:            'Campos: nome, e-mail, telefone, empresa, cargo, observações',
  },
  {
    key:               'add_tag',
    label:             'Adicionar etiqueta ao cliente',
    description:       'Marca o cliente com etiquetas como "qualificado", "sem interesse" ou outras tags configuradas no CRM.',
    category:          'crm',
    promptSuggestion:  'Quando identificar o perfil do cliente, use add_tag — por exemplo: "qualificado", "sem interesse" ou "aguardando retorno".',
    params:            'Parâmetro: nome da etiqueta (criada automaticamente se não existir)',
  },
  {
    key:               'remove_tag',
    label:             'Remover etiqueta do cliente',
    description:       'Remove uma etiqueta existente do perfil do cliente quando ela não for mais aplicável.',
    category:          'crm',
    promptSuggestion:  'Quando uma etiqueta do cliente não for mais válida, use remove_tag informando o nome exato da etiqueta a remover.',
    params:            'Parâmetro: nome exato da etiqueta a remover',
  },
  {
    key:               'add_note',
    label:             'Registrar anotação interna',
    description:       'Grava observações da conversa no perfil do cliente ou na oportunidade para a equipe visualizar.',
    category:          'crm',
    promptSuggestion:  'Quando precisar registrar algo importante da conversa para a equipe visualizar, use add_note.',
    params:            'Destino: perfil do cliente ou oportunidade ativa',
  },

  // ── Oportunidade ─────────────────────────────────────────────────────────────
  {
    key:               'update_opportunity',
    label:             'Atualizar oportunidade',
    description:       'Edita informações da oportunidade como valor estimado, probabilidade de fechamento ou previsão.',
    category:          'oportunidade',
    promptSuggestion:  'Quando o cliente informar valor esperado ou prazo de fechamento, use update_opportunity para atualizar a oportunidade.',
    params:            'Campos: valor, probabilidade (0–100%), previsão de fechamento, título',
  },
  {
    key:               'move_opportunity',
    label:             'Avançar card no funil',
    description:       'Move o card da oportunidade para a próxima etapa do funil quando o cliente demonstrar progresso.',
    category:          'oportunidade',
    promptSuggestion:  'Quando o cliente avançar no processo — como pedir proposta ou confirmar interesse — use move_opportunity para mover o card no funil.',
    params:            'Parâmetro: nome exato da etapa de destino (veja etapas do funil abaixo)',
  },

  // ── Agenda ────────────────────────────────────────────────────────────────────
  {
    key:               'create_activity',
    label:             'Criar atividade ou compromisso',
    description:       'Agenda reuniões, ligações e compromissos confirmados pelo cliente durante a conversa.',
    category:          'agenda',
    promptSuggestion:  'Quando o cliente confirmar uma reunião, ligação ou compromisso, use create_activity para registrar.',
    params:            'Tipos: ligação, reunião, follow-up, tarefa, e-mail — requer data e hora confirmadas',
  },
  {
    key:               'schedule_contact',
    label:             'Agendar retorno de contato',
    description:       'Programa o agente para retomar o contato automaticamente em uma data futura definida.',
    category:          'agenda',
    promptSuggestion:  'Quando o cliente pedir para ser contatado em uma data futura, use schedule_contact para programar o retorno.',
    params:            'Motivos: contatar depois, follow-up, nova tentativa, reengajamento',
  },

  // ── Atendimento ───────────────────────────────────────────────────────────────
  {
    key:               'request_handoff',
    label:             'Transferir para atendente humano',
    description:       'Encaminha a conversa para um atendente da equipe quando solicitado ou quando necessário.',
    category:          'atendimento',
    promptSuggestion:  'Quando o cliente pedir para falar com um atendente humano ou a situação exigir intervenção, use request_handoff.',
    params:            'Parâmetro: motivo da transferência (para registro interno)',
  },
  {
    key:               'send_media',
    label:             'Enviar mídias do catálogo',
    description:       'Envia imagens ou vídeos do produto ou serviço em foco, conforme a intenção definida (apresentação, prova social ou detalhe técnico).',
    category:          'atendimento',
    promptSuggestion:  'Quando identificar que deve enviar uma imagem ou vídeo do produto em foco, use send_media.',
    channelNote:       'Apenas WhatsApp',
    params:            'Intenções: apresentação, prova social, detalhe técnico',
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
