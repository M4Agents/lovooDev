/**
 * CRUD de agentes Lovoo e bindings de uso funcional.
 *
 * Acesso:
 *   - lovoo_agents       → RLS restringe a admin/super_admin da empresa pai
 *   - agent_use_bindings → SELECT aberto a autenticados, WRITE restrito à empresa pai
 *
 * Este service usa o Supabase client (anon key / user JWT).
 * O resolver/runner server-side usa service_role separadamente.
 */

import { supabase } from '../lib/supabase'
import type {
  AgentUseBinding,
  CreateAgentPayload,
  LovooAgent,
  UpdateAgentPayload,
} from '../types/lovoo-agents'
import { VALID_USE_IDS } from '../types/lovoo-agents'

export const lovooAgentsApi = {
  // ── Agentes ───────────────────────────────────────────────────────────────

  /**
   * Lista todos os agentes da empresa pai (ativos e inativos).
   * Só funciona para admin/super_admin da empresa pai — RLS bloqueia demais.
   */
  async listAgents(): Promise<LovooAgent[]> {
    const { data, error } = await supabase
      .from('lovoo_agents')
      .select('*')
      .order('name', { ascending: true })

    if (error) throw error
    return (data || []) as LovooAgent[]
  },

  async createAgent(payload: CreateAgentPayload): Promise<LovooAgent> {
    const { data, error } = await supabase
      .from('lovoo_agents')
      .insert({
        company_id:    payload.company_id,
        name:          payload.name.trim(),
        description:   payload.description?.trim() ?? null,
        is_active:     payload.is_active ?? true,
        prompt:        payload.prompt?.trim() ?? null,
        knowledge_base: payload.knowledge_base?.trim() ?? null,
        model:         payload.model,
        model_config:  payload.model_config ?? {},
      })
      .select()
      .single()

    if (error) throw error
    return data as LovooAgent
  },

  async updateAgent(id: string, patch: UpdateAgentPayload): Promise<LovooAgent> {
    const payload: Record<string, unknown> = {}

    if (patch.name          !== undefined) payload.name           = patch.name.trim()
    if (patch.description   !== undefined) payload.description    = patch.description?.trim() ?? null
    if (patch.is_active     !== undefined) payload.is_active      = patch.is_active
    if (patch.prompt        !== undefined) payload.prompt         = patch.prompt?.trim() ?? null
    if (patch.knowledge_base !== undefined) payload.knowledge_base = patch.knowledge_base?.trim() ?? null
    if (patch.model         !== undefined) payload.model          = patch.model
    if (patch.model_config  !== undefined) payload.model_config   = patch.model_config

    const { data, error } = await supabase
      .from('lovoo_agents')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as LovooAgent
  },

  async deleteAgent(id: string): Promise<void> {
    const { error } = await supabase
      .from('lovoo_agents')
      .delete()
      .eq('id', id)

    if (error) throw error
  },

  // ── Bindings ──────────────────────────────────────────────────────────────

  /**
   * Lista todos os bindings ativos.
   * SELECT aberto a autenticados — necessário para features consultarem o agente vinculado.
   */
  async listBindings(): Promise<AgentUseBinding[]> {
    const { data, error } = await supabase
      .from('agent_use_bindings')
      .select('*')
      .order('use_id', { ascending: true })

    if (error) throw error
    return (data || []) as AgentUseBinding[]
  },

  /**
   * Vincula (ou re-vincula) um agente a um uso funcional.
   * Usa upsert com conflito em use_id — garante 1 agente por uso.
   *
   * @throws se use_id não for um uso funcional válido
   */
  async upsertBinding(useId: string, agentId: string): Promise<AgentUseBinding> {
    if (!VALID_USE_IDS.has(useId)) {
      throw new Error(`use_id inválido: "${useId}"`)
    }

    const { data, error } = await supabase
      .from('agent_use_bindings')
      .upsert(
        { use_id: useId, agent_id: agentId },
        { onConflict: 'use_id' }
      )
      .select()
      .single()

    if (error) throw error
    return data as AgentUseBinding
  },

  /**
   * Remove o binding de um uso funcional.
   * O uso fica sem agente vinculado — runner retornará fallback.
   */
  async removeBinding(useId: string): Promise<void> {
    const { error } = await supabase
      .from('agent_use_bindings')
      .delete()
      .eq('use_id', useId)

    if (error) throw error
  },
}
