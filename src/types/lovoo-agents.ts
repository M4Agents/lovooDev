// =====================================================
// TYPES: AGENTES LOVOO
//
// lovoo_agents             → cadastro de agentes (empresa pai)
// agent_use_bindings       → vínculo global uso → agente
// lovoo_agent_documents    → documentos RAG por agente (empresa pai)
// lovoo_agent_chunks       → chunks vetorizados — acesso apenas server-side
// AGENT_FUNCTIONAL_USES    → catálogo de usos funcionais (TypeScript const, não tabela)
// =====================================================

// ── Tipos primitivos ──────────────────────────────────────────────────────────

/**
 * Modo de conhecimento do agente.
 * Espelha o CHECK constraint da coluna knowledge_mode em lovoo_agents.
 */
export type KnowledgeMode = 'none' | 'inline' | 'rag' | 'hybrid'

/**
 * Status do ciclo de vida de um documento RAG.
 * Espelha o CHECK constraint da coluna status em lovoo_agent_documents.
 */
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error'

// ── Configurações tipadas ─────────────────────────────────────────────────────

export interface LovooAgentModelConfig {
  temperature?: number
  max_tokens?: number
  [key: string]: unknown
}

/**
 * Configuração de retrieval RAG por agente.
 * Armazenada em lovoo_agents.knowledge_base_config (JSONB).
 * Ignorada quando knowledge_mode = 'none' | 'inline'.
 */
export interface LovooAgentKnowledgeBaseConfig {
  top_k?: number
  min_similarity?: number
  embedding_model?: string
  [key: string]: unknown
}

// ── Tipos do banco — lovoo_agents ─────────────────────────────────────────────

export interface LovooAgent {
  id: string
  company_id: string
  name: string
  description: string | null
  is_active: boolean
  prompt: string | null
  knowledge_base: string | null
  knowledge_base_config: LovooAgentKnowledgeBaseConfig
  knowledge_mode: KnowledgeMode
  model: string
  model_config: LovooAgentModelConfig
  created_at: string
  updated_at: string
}

export interface AgentUseBinding {
  id: string
  use_id: string
  agent_id: string
  created_at: string
}

// ── Tipos do banco — lovoo_agent_documents ────────────────────────────────────

/**
 * Espelha a tabela lovoo_agent_documents (exceto embedding).
 * Usado no frontend para listar e gerenciar documentos RAG.
 */
export interface LovooAgentDocument {
  id: string
  agent_id: string
  name: string
  storage_path: string
  file_type: 'text/plain' | 'text/markdown'
  file_size: number
  status: DocumentStatus
  error_message: string | null
  chunk_count: number
  version: number
  pending_version: number | null
  content_hash: string | null
  processing_started_at: string | null
  last_processed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Tipo mínimo de chunk — uso compartilhado backend/tipos.
 * O campo embedding (vector) é omitido intencionalmente:
 *   nunca deve ser transmitido ou exposto ao frontend.
 */
export interface LovooAgentChunk {
  id: string
  agent_id: string
  document_id: string
  doc_version: number
  chunk_index: number
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

// ── Payloads de API — agentes ─────────────────────────────────────────────────

export type CreateAgentPayload = {
  company_id: string
  name: string
  description?: string | null
  is_active?: boolean
  prompt?: string | null
  knowledge_base?: string | null
  knowledge_base_config?: LovooAgentKnowledgeBaseConfig
  knowledge_mode?: KnowledgeMode
  model: string
  model_config?: LovooAgentModelConfig
}

export type UpdateAgentPayload = Partial<
  Omit<CreateAgentPayload, 'company_id'>
>

// ── Payloads de API — documentos RAG ─────────────────────────────────────────

/**
 * Enviado pelo frontend ao fazer upload de um documento.
 * O arquivo em si é transmitido como FormData na rota de upload.
 */
export type UploadLovooAgentDocumentPayload = {
  agent_id: string
  name: string
}

/**
 * Disparado após upload para iniciar o pipeline de processamento
 * (extração → chunking → embedding → persistência).
 */
export type ProcessLovooAgentDocumentPayload = {
  document_id: string
}

/**
 * Payload para deletar um documento e seus chunks.
 */
export type DeleteLovooAgentDocumentPayload = {
  document_id: string
}

/**
 * Item retornado pela listagem de documentos de um agente.
 * Idêntico a LovooAgentDocument — alias explícito para clareza de uso na UI.
 */
export type LovooAgentDocumentListItem = LovooAgentDocument

/**
 * Resultado retornado pelo endpoint de processamento.
 * Inclui o estado final do documento após o pipeline.
 */
export type LovooAgentDocumentProcessingResult = {
  document_id: string
  status: DocumentStatus
  chunk_count: number
  version: number
  error_message?: string | null
}

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
