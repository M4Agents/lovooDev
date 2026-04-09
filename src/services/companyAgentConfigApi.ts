/**
 * Service para configuração de agentes conversacionais por empresa.
 *
 * Endpoints consumidos:
 *   GET  /api/agents/company-config
 *   POST /api/agents/company-config-update-assignment
 *   POST /api/agents/company-config-update-routing-rule
 *
 * Autenticação: Bearer JWT via supabase.auth.getSession().
 */

import { supabase } from '../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface AgentCapabilities {
  can_auto_reply:   boolean
  can_inform_prices: boolean
  can_send_media:   boolean
  [key: string]:    boolean
}

export type PriceDisplayPolicy = 'disabled' | 'fixed_only' | 'range_allowed' | 'consult_only'

export interface CompanyAgentAssignment {
  id:                   string
  company_id:           string
  agent_id:             string
  agent_name:           string | null
  channel:              string
  display_name:         string
  capabilities:         AgentCapabilities
  price_display_policy: PriceDisplayPolicy
  is_active:            boolean
  created_at:           string
  updated_at:           string
}

export interface AgentRoutingRuleFallback {
  id:                       string
  company_id:               string
  assignment_id:            string
  assignment_display_name:  string | null
  assignment_channel:       string | null
  channel:                  string
  priority:                 number
  is_fallback:              boolean
  is_active:                boolean
  description:              string | null
  created_at:               string
  updated_at:               string
}

export interface AvailableAgent {
  id:   string
  name: string
}

export interface CompanyAgentConfig {
  assignments:            CompanyAgentAssignment[]
  routing_rules_fallback: AgentRoutingRuleFallback[]
  available_agents:       AvailableAgent[]
}

export interface UpdateAssignmentPayload {
  is_active?:            boolean
  agent_id?:             string
  capabilities?:         Partial<AgentCapabilities>
  price_display_policy?: PriceDisplayPolicy
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida')
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${session.access_token}`
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

export const companyAgentConfigApi = {

  /**
   * Busca assignments, routing rules fallback e agentes disponíveis da empresa.
   */
  async getConfig(companyId: string): Promise<CompanyAgentConfig> {
    const headers = await getAuthHeaders()
    const res = await fetch(`/api/agents/company-config?company_id=${encodeURIComponent(companyId)}`, {
      method:  'GET',
      headers: { Authorization: headers['Authorization'] }
    })

    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? 'Erro ao carregar configurações de agentes')
    }

    return json.data as CompanyAgentConfig
  },

  /**
   * Atualiza um assignment da empresa.
   * Campos permitidos: is_active, agent_id, capabilities, price_display_policy.
   */
  async updateAssignment(
    companyId:    string,
    assignmentId: string,
    payload:      UpdateAssignmentPayload
  ): Promise<Partial<CompanyAgentAssignment>> {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/agents/company-config-update-assignment', {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        company_id:    companyId,
        assignment_id: assignmentId,
        ...payload
      })
    })

    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? 'Erro ao atualizar assignment')
    }

    return json.data
  },

  /**
   * Ativa ou desativa uma routing rule fallback da empresa.
   */
  async updateRoutingRule(
    companyId:     string,
    routingRuleId: string,
    isActive:      boolean
  ): Promise<{ id: string; is_active: boolean; updated_at: string }> {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/agents/company-config-update-routing-rule', {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        company_id:      companyId,
        routing_rule_id: routingRuleId,
        is_active:       isActive
      })
    })

    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? 'Erro ao atualizar regra de roteamento')
    }

    return json.data
  }
}
