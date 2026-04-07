// =====================================================
// TYPES: AGENTES LOVOO
//
// lovoo_agents        → cadastro de agentes (empresa pai)
// agent_use_bindings  → vínculo global uso → agente
// AGENT_FUNCTIONAL_USES → catálogo de usos funcionais (TypeScript const, não tabela)
// =====================================================

// ── Tipos do banco ────────────────────────────────────────────────────────────

export interface LovooAgent {
  id: string
  company_id: string
  name: string
  description: string | null
  is_active: boolean
  prompt: string | null
  knowledge_base: string | null
  knowledge_base_config: Record<string, unknown>
  model: string
  model_config: LovooAgentModelConfig
  created_at: string
  updated_at: string
}

export interface LovooAgentModelConfig {
  temperature?: number
  max_tokens?: number
  [key: string]: unknown
}

export interface AgentUseBinding {
  id: string
  use_id: string
  agent_id: string
  created_at: string
}

// ── Payload para criação / atualização ───────────────────────────────────────

export type CreateAgentPayload = {
  company_id: string
  name: string
  description?: string | null
  is_active?: boolean
  prompt?: string | null
  knowledge_base?: string | null
  model: string
  model_config?: LovooAgentModelConfig
}

export type UpdateAgentPayload = Partial<
  Omit<CreateAgentPayload, 'company_id'>
>

// ── Catálogo de usos funcionais ───────────────────────────────────────────────

export interface AgentFunctionalUse {
  /** Identificador único — formato module:action:context */
  id: string
  module: string
  action: string
  context: string
  /** Grupo exibido na UI para agrupar usos relacionados */
  group: string
  /** Label legível para o usuário */
  label: string
  description?: string
  /** Se true, o runner rejeita execução sem extra_context */
  requires_context?: boolean
  /** Estratégia de fallback quando não há binding: "static" | "none" */
  fallback_mode?: 'static' | 'none'
  /** Nível de risco — impacta revisão de deploy */
  risk_level?: 'low' | 'medium' | 'high'
}

/**
 * Catálogo imutável de usos funcionais do MVP.
 * Não é uma tabela de banco — vive aqui para evitar migrations a cada novo uso.
 * Para adicionar um uso: incluir nesta lista + implementar o suporte no runner.
 */
export const AGENT_FUNCTIONAL_USES: AgentFunctionalUse[] = [
  // ── Chat ─────────────────────────────────────────────────────────────────
  {
    id: 'chat:summary:conversation',
    module: 'chat',
    action: 'summary',
    context: 'conversation',
    group: 'Chat',
    label: 'Resumo de conversa',
    description: 'Gera um resumo da conversa com o lead.',
  },
  {
    id: 'chat:reply_suggestion:whatsapp',
    module: 'chat',
    action: 'reply_suggestion',
    context: 'whatsapp',
    group: 'Chat',
    label: 'Sugestão de resposta (WhatsApp)',
    description: 'Sugere respostas para o atendente no canal WhatsApp.',
  },

  // ── Produtos ─────────────────────────────────────────────────────────────
  {
    id: 'products:field_writer:internal_notes',
    module: 'products',
    action: 'field_writer',
    context: 'internal_notes',
    group: 'Produtos',
    label: 'Redator — notas internas',
    description: 'Gera ou refina o campo de notas internas de um produto.',
  },
  {
    id: 'products:field_writer:unavailable_behavior',
    module: 'products',
    action: 'field_writer',
    context: 'unavailable_behavior',
    group: 'Produtos',
    label: 'Redator — comportamento indisponível',
    description: 'Gera texto de comportamento quando o produto está indisponível.',
  },

  // ── Serviços ─────────────────────────────────────────────────────────────
  {
    id: 'services:field_writer:internal_notes',
    module: 'services',
    action: 'field_writer',
    context: 'internal_notes',
    group: 'Serviços',
    label: 'Redator — notas internas',
    description: 'Gera ou refina o campo de notas internas de um serviço.',
  },
  {
    id: 'services:field_writer:unavailable_behavior',
    module: 'services',
    action: 'field_writer',
    context: 'unavailable_behavior',
    group: 'Serviços',
    label: 'Redator — comportamento indisponível',
    description: 'Gera texto de comportamento quando o serviço está indisponível.',
  },

  // ── Agentes ───────────────────────────────────────────────────────────────
  {
    id: 'agents:context_builder:instructions',
    module: 'agents',
    action: 'context_builder',
    context: 'instructions',
    group: 'Agentes',
    label: 'Construtor de instrução de agente',
    description: 'Auxilia na criação do prompt/instrução de um agente.',
  },

  // ── Sistema ───────────────────────────────────────────────────────────────
  {
    id: 'system:support_assistant:general_help',
    module: 'system',
    action: 'support_assistant',
    context: 'general_help',
    group: 'Sistema',
    label: 'Suporte ao usuário do sistema',
    description:
      'Auxilia usuários com dúvidas de navegação, funcionalidades e uso do sistema. ' +
      'Opera com comportamento conservador — não inventa funcionalidades inexistentes.',
    requires_context: true,
    fallback_mode: 'static',
    risk_level: 'high',
  },
]

/** Lookup rápido por id. */
export function getFunctionalUse(useId: string): AgentFunctionalUse | undefined {
  return AGENT_FUNCTIONAL_USES.find((u) => u.id === useId)
}

/** IDs válidos — usados para validação no service e no runner. */
export const VALID_USE_IDS = new Set(AGENT_FUNCTIONAL_USES.map((u) => u.id))
