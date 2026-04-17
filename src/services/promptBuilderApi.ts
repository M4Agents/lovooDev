/**
 * promptBuilderApi.ts
 *
 * Serviço de comunicação com os endpoints do Prompt Builder e do Agente de Suporte.
 */

import { supabase } from '../lib/supabase'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface FlatPromptConfig {
  identity:             string
  objective:            string
  communication_style?: string
  commercial_rules?:    string
  custom_notes?:        string
}

export interface GeneratePromptPayload {
  company_id:   string
  userAnswers?: {
    objective?:            string
    communication_style?:  string
    commercial_rules?:     string
    custom_notes?:         string
    language?:             string
  }
}

export interface GeneratePromptResult {
  prompt_config: FlatPromptConfig
  meta?: {
    company_name:  string | null
    catalog_count: number
  }
}

export interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
}

/** Evento de tool simulada retornado pelo sandbox real. */
export interface SandboxToolEvent {
  tool:      string
  args:      Record<string, unknown>
  simulated: true
  label:     string
}

/** Objeto de memória acumulada entre os turnos do sandbox real. */
export interface SandboxMemory {
  v?:                   number
  summary:              string
  facts?:               Record<string, string>
  intents?:             string[]
  objections?:          string[]
  open_loops?:          string[]
  conversation_stage?:  string
  interaction_count?:   number
  last_interaction_at?: string
  updated_at?:          string
}

/** Resposta completa do sandbox real. */
export interface SandboxRunResult {
  reply:                   string
  tool_events:             SandboxToolEvent[]
  updated_sandbox_memory:  SandboxMemory | null
  rag_notice?:             string | null
}

// ── Helper ─────────────────────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida')
  return `Bearer ${session.access_token}`
}

// ── Assembla o prompt a partir dos campos planos (client-side) ─────────────────

export function assemblePromptFromConfig(config: FlatPromptConfig): string {
  const parts: string[] = []

  parts.push(`## Identidade\n\n${config.identity}`)
  parts.push(`## Objetivo\n\n${config.objective}`)

  if (config.communication_style?.trim()) {
    parts.push(`## Estilo de comunicação\n\n${config.communication_style}`)
  }
  if (config.commercial_rules?.trim()) {
    parts.push(`## Regras comerciais\n\n${config.commercial_rules}`)
  }
  if (config.custom_notes?.trim()) {
    parts.push(`## Contexto adicional\n\n${config.custom_notes}`)
  }

  return parts.join('\n\n---\n\n').trim()
}

// ── API ────────────────────────────────────────────────────────────────────────

export const promptBuilderApi = {

  async generate(payload: GeneratePromptPayload): Promise<GeneratePromptResult> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/prompt-builder/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Erro ao gerar configuração (${res.status})`)
    }
    return { prompt_config: json.prompt_config as FlatPromptConfig, meta: json.meta }
  },

  async sandboxChat(payload: {
    company_id:    string
    messages:      ChatMessage[]
    prompt_config: FlatPromptConfig
    agent_name?:   string
  }): Promise<string> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/ai/sandbox', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Erro no sandbox (${res.status})`)
    }
    return json.reply as string
  },

  /**
   * Sandbox real: usa o runtime completo do agente (companyData, catálogo,
   * knowledge_base, tools simuladas, memória entre turnos).
   * Nenhum dado é persistido — completamente isolado de produção.
   */
  async sandboxRunChat(payload: {
    company_id:      string
    messages:        ChatMessage[]
    prompt_config:   FlatPromptConfig
    agent_name?:     string
    sandbox_memory?: SandboxMemory | null
    agent_id?:       string | null
  }): Promise<SandboxRunResult> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/ai/sandbox-run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(18_000), // margem acima do timeout do servidor (15s)
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Erro no sandbox real (${res.status})`)
    }
    return {
      reply:                  json.reply as string,
      tool_events:            (json.tool_events as SandboxToolEvent[]) ?? [],
      updated_sandbox_memory: (json.updated_sandbox_memory as SandboxMemory | null) ?? null,
      rag_notice:             json.rag_notice ?? null,
    }
  },

  async runSupportAgent(companyId: string, userMessage: string): Promise<string> {
    const auth = await getAuthHeader()
    const res  = await fetch('/api/ai/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body:    JSON.stringify({
        use_id:     'system:support_assistant:agent_config',
        company_id: companyId,
        userMessage,
      }),
    })
    const json = await res.json()
    if (!json.success) {
      throw new Error(json.error ?? 'Agente de suporte indisponível')
    }
    return json.result as string
  },
}
