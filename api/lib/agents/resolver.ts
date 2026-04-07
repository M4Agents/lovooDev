// =====================================================
// Resolver de agentes — lookup puro, sem execução OpenAI.
//
// Responsabilidade: dado um use_id, retornar a configuração
// do agente vinculado (se houver).
//
// Usa service_role para ler lovoo_agents (RLS restrito à empresa pai).
// Nunca importar no frontend — server-side exclusivo.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VALID_USE_IDS } from './uses.js'

export type ResolvedAgent = {
  id: string
  name: string
  prompt: string | null
  knowledge_base: string | null
  model: string
  model_config: Record<string, unknown>
}

export type ResolveAgentResult =
  | { found: true;  agent: ResolvedAgent }
  | { found: false; reason: 'invalid_use_id' | 'no_binding' | 'agent_inactive' | 'db_error' }

// ── Cliente service_role (somente leitura de agentes) ────────────────────────

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve qual agente está vinculado a um uso funcional.
 *
 * Fluxo:
 *   1. Valida use_id contra o catálogo
 *   2. Busca binding em agent_use_bindings (sem company_id — global)
 *   3. Busca configuração do agente em lovoo_agents (via service_role)
 *   4. Valida is_active
 *   5. Retorna ResolvedAgent ou razão de falha
 */
export async function resolveAgent(useId: string): Promise<ResolveAgentResult> {
  if (!VALID_USE_IDS.has(useId)) {
    return { found: false, reason: 'invalid_use_id' }
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return { found: false, reason: 'db_error' }
  }

  // 1. Busca o binding global
  const { data: binding, error: bindingErr } = await svc
    .from('agent_use_bindings')
    .select('agent_id')
    .eq('use_id', useId)
    .maybeSingle()

  if (bindingErr) return { found: false, reason: 'db_error' }
  if (!binding)   return { found: false, reason: 'no_binding' }

  // 2. Busca a configuração do agente (service_role bypassa RLS)
  const { data: agent, error: agentErr } = await svc
    .from('lovoo_agents')
    .select('id, name, is_active, prompt, knowledge_base, model, model_config')
    .eq('id', binding.agent_id)
    .maybeSingle()

  if (agentErr || !agent) return { found: false, reason: 'db_error' }
  if (!agent.is_active)   return { found: false, reason: 'agent_inactive' }

  return {
    found: true,
    agent: {
      id:             agent.id,
      name:           agent.name,
      prompt:         agent.prompt ?? null,
      knowledge_base: agent.knowledge_base ?? null,
      model:          agent.model,
      model_config:   (agent.model_config ?? {}) as Record<string, unknown>,
    },
  }
}
