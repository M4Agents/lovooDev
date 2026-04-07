// =====================================================
// Catálogo de usos funcionais — server-side (api/lib/agents)
//
// Espelho mínimo de src/types/lovoo-agents.ts para uso no resolver/runner.
// O frontend usa a versão completa com labels e descrições.
// Manter sincronizado com AGENT_FUNCTIONAL_USES em src/types/lovoo-agents.ts.
// =====================================================

export type AgentUseMeta = {
  /** Se true, o runner rejeita execução sem extra_context. */
  requires_context: boolean
  /** "static" = fallback fixo sem OpenAI | "none" = sem fallback */
  fallback_mode: 'static' | 'none'
  /** Nível de risco para monitoramento. */
  risk_level: 'low' | 'medium' | 'high'
}

/**
 * Metadados de segurança e execução por use_id.
 * Usos não listados recebem defaults: sem requisito de contexto, sem fallback.
 */
export const AGENT_USE_META: Record<string, AgentUseMeta> = {
  'system:support_assistant:general_help': {
    requires_context: true,
    fallback_mode:    'static',
    risk_level:       'high',
  },
}

/** Default para usos sem metadados explícitos. */
const DEFAULT_USE_META: AgentUseMeta = {
  requires_context: false,
  fallback_mode:    'none',
  risk_level:       'low',
}

export function getUseMeta(useId: string): AgentUseMeta {
  return AGENT_USE_META[useId] ?? DEFAULT_USE_META
}

/** Conjunto de use_ids válidos no MVP. Sincronizar com AGENT_FUNCTIONAL_USES. */
export const VALID_USE_IDS = new Set<string>([
  'chat:summary:conversation',
  'chat:reply_suggestion:whatsapp',
  'products:field_writer:internal_notes',
  'products:field_writer:unavailable_behavior',
  'services:field_writer:internal_notes',
  'services:field_writer:unavailable_behavior',
  'agents:context_builder:instructions',
  'system:support_assistant:general_help',
])
