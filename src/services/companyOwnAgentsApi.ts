import { supabase } from '../lib/supabase'
import type { PromptConfig } from '../../api/lib/agents/variablesCatalog'
import type { FlatPromptConfig } from './promptBuilderApi'

// Union dos dois formatos de prompt_config aceitos pelo backend
export type AnyPromptConfig = PromptConfig | FlatPromptConfig

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type AgentKnowledgeMode = 'none' | 'inline'

export interface CompanyAgent {
  id:             string
  company_id:     string
  agent_type:     'conversational'
  name:           string
  description:    string | null
  prompt:         string
  prompt_config:  AnyPromptConfig | null
  prompt_version: number
  model:          string
  knowledge_mode: AgentKnowledgeMode
  model_config:   Record<string, unknown>
  allowed_tools:  string[]
  is_active:      boolean
  created_at:     string
  updated_at:     string
}

export interface CreateCompanyAgentPayload {
  company_id:     string
  name:           string
  description?:   string
  // modo legacy: enviar prompt; modo builder: enviar prompt_config (nunca ambos)
  prompt?:        string
  prompt_config?: AnyPromptConfig
  model?:         string
  knowledge_mode?: AgentKnowledgeMode
  is_active?:     boolean
  model_config?:  Record<string, unknown>
  allowed_tools?: string[]
}

export interface UpdateCompanyAgentPayload {
  company_id:      string
  agent_id:        string
  name?:           string
  description?:    string
  // modo legacy: enviar prompt; modo builder: enviar prompt_config + prompt_version (nunca ambos)
  prompt?:         string
  prompt_config?:  AnyPromptConfig
  prompt_version?: number
  model?:          string
  knowledge_mode?: AgentKnowledgeMode
  is_active?:      boolean
  model_config?:   Record<string, unknown>
  allowed_tools?:  string[]
}

// Erro de conflito de versão (409)
export class ConflictError extends Error {
  constructor(message = 'Agente foi modificado por outra sessão. Recarregue e tente novamente.') {
    super(message)
    this.name = 'ConflictError'
  }
}

// ── Helper de autenticação ────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida')
  return `Bearer ${session.access_token}`
}

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json()
  if (res.status === 409) {
    throw new ConflictError(json.message ?? 'Conflito de versão.')
  }
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
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'companyOwnAgentsApi.ts:create',message:'POST company-agents-create',data:{url:'/api/agents/company-agents-create',mode:payload.prompt_config?'structured':'legacy'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const res  = await fetch('/api/agents/company-agents-create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload)
    })
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'companyOwnAgentsApi.ts:create',message:'response create',data:{status:res.status,ok:res.ok},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return handleResponse<CompanyAgent>(res)
  },

  async update(payload: UpdateCompanyAgentPayload): Promise<CompanyAgent> {
    const auth = await getAuthHeader()
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'companyOwnAgentsApi.ts:update',message:'POST company-agents-update',data:{url:'/api/agents/company-agents-update',agentId:payload.agent_id},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const res  = await fetch('/api/agents/company-agents-update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload)
    })
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'companyOwnAgentsApi.ts:update',message:'response update',data:{status:res.status,ok:res.ok},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return handleResponse<CompanyAgent>(res)
  }
}
