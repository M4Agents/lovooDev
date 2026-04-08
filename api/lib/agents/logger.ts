// =============================================================================
// api/lib/agents/logger.ts
//
// Logger de execuções dos Agentes Lovoo globais.
//
// NATUREZA DESTE MÓDULO:
//   • Observabilidade operacional — registra cada execução do runAgent().
//   • NÃO é billing real. NÃO representa faturamento ao cliente.
//   • estimated_cost_usd é estimativa operacional baseada em pricing.ts.
//
// ACESSO:
//   • INSERT exclusivo via service_role no backend (este arquivo).
//   • SELECT restrito a admin/super_admin da empresa pai via RLS.
//   • Nunca expor este módulo ao frontend.
//
// COMPORTAMENTO:
//   • Todas as escritas são fire-and-forget.
//   • Falha no log NUNCA deve interromper a execução do runner.
//   • Erros são silenciosos do ponto de vista da feature consumidora.
//
// EVOLUÇÃO FUTURA:
//   Quando agentes por empresa (multi-tenant real) forem suportados,
//   consumer_company_id continuará sendo o campo correto de consumo.
//   agent.company_id não deve aparecer neste log — é ownership estrutural,
//   não registro de consumo operacional.
//   Ver docs/adr/ADR-001-ai-agent-logging-and-costs.md
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getPricingRevision } from './pricing.js'

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

/**
 * Códigos de erro estruturados para execuções com status !== 'success'.
 *
 * Cada código mapeia para uma causa específica e rastreável.
 * Nunca usar strings livres — sempre usar este union type.
 */
export type ExecutionErrorCode =
  | 'no_binding'               // Nenhum binding registrado para o use_id
  | 'agent_inactive'           // Agente encontrado, mas inativo
  | 'openai_not_configured'    // Integração OpenAI não configurada na empresa
  | 'openai_disabled'          // OpenAI desabilitada explicitamente
  | 'openai_client_null'       // Cliente OpenAI não pôde ser inicializado
  | 'openai_execution_failed'  // OpenAI falhou e não havia fallback
  | 'missing_required_context' // requires_context=true mas extra_context ausente
  | 'db_error'                 // Falha na resolução do agente (DB/config)

/**
 * Status possíveis de uma execução do runner.
 *
 * | status                       | OpenAI chamada? | error_code obrigatório? |
 * |------------------------------|-----------------|------------------------|
 * | success                      | Sim             | Não                    |
 * | fallback_no_agent            | Não             | Sim                    |
 * | fallback_openai_unavailable  | Não             | Sim                    |
 * | fallback_openai_failed       | Sim (com erro)  | Sim                    |
 * | error_missing_context        | Não             | Sim                    |
 * | error_openai                 | Sim (com erro)  | Sim                    |
 * | error_db                     | Não             | Sim                    |
 *
 * Nota: invalid_use_id NÃO é logado por decisão de escopo do MVP.
 */
export type ExecutionStatus =
  | 'success'
  | 'fallback_no_agent'
  | 'fallback_openai_unavailable'
  | 'fallback_openai_failed'
  | 'error_missing_context'
  | 'error_openai'
  | 'error_db'

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionLogEntry — discriminated union
//
// Garante em tempo de compilação que:
// - status 'success' não exige error_code
// - qualquer outro status EXIGE error_code
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionLogBase {
  use_id:              string
  agent_id?:           string | null
  /** Empresa/tenant que CONSUMIU a execução (não o owner do agente). */
  consumer_company_id?: string | null
  user_id?:            string | null
  channel?:            string | null
  model?:              string | null
  knowledge_mode?:     'none' | 'inline' | 'rag' | 'hybrid' | null
  is_fallback:         boolean
  duration_ms?:        number | null
  input_tokens?:       number | null
  output_tokens?:      number | null
  total_tokens?:       number | null
  estimated_cost_usd?: number | null
}

interface ExecutionLogSuccess extends ExecutionLogBase {
  status: 'success'
  error_code?: never
}

interface ExecutionLogFailure extends ExecutionLogBase {
  status: Exclude<ExecutionStatus, 'success'>
  /** Obrigatório quando status !== 'success'. */
  error_code: ExecutionErrorCode
}

export type ExecutionLogEntry = ExecutionLogSuccess | ExecutionLogFailure

// ── Payload interno para o banco ──────────────────────────────────────────────

interface DbLogPayload {
  use_id:              string
  agent_id:            string | null
  consumer_company_id: string | null
  user_id:             string | null
  channel:             string | null
  model:               string | null
  knowledge_mode:      string | null
  status:              string
  is_fallback:         boolean
  duration_ms:         number | null
  input_tokens:        number | null
  output_tokens:       number | null
  total_tokens:        number | null
  estimated_cost_usd:  number | null
  pricing_version:     string | null
  error_code:          string | null
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Registra a execução de um Agente Lovoo na tabela ai_agent_execution_logs.
 *
 * FIRE-AND-FORGET:
 *   Não aguardar este retorno no runner.
 *   Falhas são silenciosas — nunca interrompem a execução da feature.
 *
 * @example
 *   void writeExecutionLog({ use_id, status: 'success', is_fallback: false, ... })
 */
export async function writeExecutionLog(entry: ExecutionLogEntry): Promise<void> {
  const svc = getServiceSupabase()
  if (!svc) return

  const payload: DbLogPayload = {
    use_id:              entry.use_id,
    agent_id:            entry.agent_id ?? null,
    consumer_company_id: entry.consumer_company_id ?? null,
    user_id:             entry.user_id ?? null,
    channel:             entry.channel ?? null,
    model:               entry.model ?? null,
    knowledge_mode:      entry.knowledge_mode ?? null,
    status:              entry.status,
    is_fallback:         entry.is_fallback,
    duration_ms:         entry.duration_ms ?? null,
    input_tokens:        entry.input_tokens ?? null,
    output_tokens:       entry.output_tokens ?? null,
    total_tokens:        entry.total_tokens ?? null,
    estimated_cost_usd:  entry.estimated_cost_usd ?? null,
    pricing_version:     entry.estimated_cost_usd != null ? getPricingRevision() : null,
    error_code:          'error_code' in entry ? (entry.error_code ?? null) : null,
  }

  try {
    await svc.from('ai_agent_execution_logs').insert(payload)
  } catch {
    // Falha silenciosa — log nunca deve quebrar o runner
  }
}
