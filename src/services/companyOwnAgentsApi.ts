import { supabase } from '../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type AgentKnowledgeMode = 'none' | 'inline'

export interface CompanyAgent {
  id:             string
  company_id:     string
  agent_type:     'conversational'
  name:           string
  description:    string | null
  prompt:         string
  model:          string
  knowledge_mode: AgentKnowledgeMode
  model_config:   Record<string, unknown>
  is_active:      boolean
  created_at:     string
  updated_at:     string
}

export interface CreateCompanyAgentPayload {
  company_id:      string
  name:            string
  prompt:          string
  description?:    string
  model?:          string
  knowledge_mode?: AgentKnowledgeMode
  is_active?:      boolean
  model_config?:   Record<string, unknown>
}

export interface UpdateCompanyAgentPayload {
  company_id:      string
  agent_id:        string
  name?:           string
  description?:    string
  prompt?:         string
  model?:          string
  knowledge_mode?: AgentKnowledgeMode
  is_active?:      boolean
  model_config?:   Record<string, unknown>
}

// ── Helper de autenticação ────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida')
  return `Bearer ${session.access_token}`
}

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Erro HTTP ${res.status}`)
  }
  return json.data as T
}

// ── API ───────────────────────────────────────────────────────────────────────

export const companyOwnAgentsApi = {

  async list(companyId: string): Promise<CompanyAgent[]> {
    const auth = await getAuthHeader()
    const res  = await fetch(`/api/agents/company-agents?company_id=${encodeURIComponent(companyId)}`, {
      headers: { Authorization: auth }
    })
    return handleResponse<CompanyAgent[]>(res)
  },

  async create(payload: CreateCompanyAgentPayload): Promise<CompanyAgent> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/agents/company-agents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload)
    })
    return handleResponse<CompanyAgent>(res)
  },

  async update(payload: UpdateCompanyAgentPayload): Promise<CompanyAgent> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/agents/company-agents/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload)
    })
    return handleResponse<CompanyAgent>(res)
  }
}
