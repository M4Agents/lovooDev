// =============================================================================
// api/lib/agents/instagramContextBuilder.ts
//
// InstagramContextBuilder — constrói o contexto para o runner do Instagram.
//
// RESPONSABILIDADE ÚNICA:
//   Buscar mensagens recentes, dados do contato/lead, memória da conversa e
//   configuração do agente para montar o InstagramContextOutput que o
//   instagramAgentExecutor passa ao runner.ts.
//
// NÃO faz: claim de mensagem, execução do LLM, envio de resposta, log.
//
// DIFERENÇAS EM RELAÇÃO AO contextBuilder.js (WhatsApp):
//   - Mensagens lidas de instagram_messages (sem RPC chat_get_messages)
//   - Memória lida de instagram_conversations.memory (não chat_conversations)
//   - Sem catálogo de produtos (agente Instagram é conversacional puro)
//   - Sem item_of_interest, sem ambiguous_candidates
//   - contact.email incluído (relevante para create_lead)
//   - instagram_conversation_id exposto explicitamente (nunca reutiliza conversation_id)
//
// MULTI-TENANT:
//   company_id obrigatório em TODAS as queries. Nunca assume contexto global.
//
// RETORNO:
//   { success: true,  output: InstagramContextOutput }
//   { success: false, skip_reason: string, error?: string }
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import type { AssignmentData, AgentData } from './instagramAgentRouter.js'

// ── Constantes ─────────────────────────────────────────────────────────────────

/** Máximo de mensagens carregadas do banco — reduzido a 20 quando há memória */
const MESSAGES_LIMIT      = 40
const MESSAGES_WITH_MEMORY = 20

/** Limite total de caracteres da seção de histórico no extra_context */
const HISTORY_MAX_CHARS = 6000

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type InstagramContextInput = {
  company_id:                string
  instagram_conversation_id: string
  ig_message_id:             string
  assignment:                AssignmentData
  agent:                     AgentData
  run_id:                    string
}

export type InstagramMessage = {
  id:         string
  direction:  'inbound' | 'outbound'
  content:    string
  created_at: string
}

export type InstagramContactData = {
  lead_id: number | null
  name:    string | null
  phone:   string | null
  email:   string | null
}

export type InstagramContextOutput = {
  run_id: string

  agent: {
    id:                    string
    prompt:                string | null
    prompt_config:         Record<string, unknown> | null
    knowledge_mode:        string
    knowledge_base:        string | null
    knowledge_base_config: Record<string, unknown>
    model:                 string
    model_config:          Record<string, unknown>
    allowed_tools:         unknown[]
  }

  conversation: {
    id:              string
    recent_messages: InstagramMessage[]
  }

  /** Contato/lead da conversa. lead_id=null quando ainda não convertido em lead. */
  contact: InstagramContactData

  /** Memória conversacional de instagram_conversations.memory — nunca de chat_conversations. */
  memory: Record<string, unknown> | null

  /** Mensagem que disparou o agente — conteúdo do ig_message_id. */
  user_message: string

  metadata: {
    company_id:                string
    assignment_id:             string
    instagram_conversation_id: string
    ig_message_id:             string
  }
}

export type ContextBuilderResult =
  | { success: true;  output: InstagramContextOutput }
  | { success: false; skip_reason: string; error?: string }

// ── Cliente service_role ───────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ── Função principal ───────────────────────────────────────────────────────────

/**
 * Constrói o contexto completo para o agente Instagram.
 *
 * Fase 1 — buscas paralelas independentes:
 *   a. Conversa completa (memory, lead_id, participant_name)
 *   b. Mensagens recentes
 *
 * Fase 2 — depende de Fase 1:
 *   c. Lead completo (se lead_id existir)
 */
export async function buildInstagramContext(
  input: InstagramContextInput,
): Promise<ContextBuilderResult> {
  const { company_id, instagram_conversation_id, ig_message_id, assignment, agent, run_id } = input

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[IG:CTX] ❌ service_role indisponível')
    return { success: false, skip_reason: 'error', error: 'service_role_unavailable' }
  }

  // ── Fase 1: buscas paralelas ───────────────────────────────────────────────

  const [convResult, messagesResult] = await Promise.allSettled([
    fetchConversation(svc, { instagram_conversation_id, company_id }),
    fetchMessages(svc, { instagram_conversation_id, company_id }),
  ])

  // Conversa é bloqueante — sem ela não há contexto
  if (convResult.status === 'rejected') {
    console.error('[IG:CTX] ❌ Falha ao buscar conversa:', convResult.reason?.message)
    return { success: false, skip_reason: 'error', error: 'conversation_fetch_failed' }
  }

  const conv = convResult.value
  if (!conv) {
    console.warn('[IG:CTX] ⏭️  Conversa não encontrada:', { instagram_conversation_id, company_id })
    return { success: false, skip_reason: 'conversation_not_found' }
  }

  // Mensagens: não-bloqueante
  let allMessages: InstagramMessage[] = []
  if (messagesResult.status === 'fulfilled') {
    allMessages = messagesResult.value ?? []
  } else {
    console.error('[IG:CTX] ⚠️  Falha ao buscar mensagens (continuando):', messagesResult.reason?.message)
  }

  // Reduzir janela de mensagens quando há memória (economia de tokens)
  const memory = (conv.memory && typeof conv.memory === 'object') ? conv.memory as Record<string, unknown> : null
  const recentMessages = memory?.summary
    ? allMessages.slice(-MESSAGES_WITH_MEMORY)
    : allMessages

  // Encontrar a mensagem gatilho para extrair user_message
  const triggerMsg = allMessages.find(m => {
    // Precisamos encontrar a mensagem pelo ig_message_id — fazemos uma query separada
    return false // preenchido abaixo via fetchTriggerMessage
  })

  // ── Fase 2: lead (depende de conv.lead_id) + mensagem gatilho ─────────────

  const [leadResult, triggerResult] = await Promise.allSettled([
    conv.lead_id
      ? fetchLead(svc, { lead_id: conv.lead_id, company_id })
      : Promise.resolve(null),
    fetchTriggerMessage(svc, { ig_message_id, company_id }),
  ])

  // Contato
  const emptyContact: InstagramContactData = {
    lead_id: null, name: null, phone: null, email: null,
  }

  let contact: InstagramContactData = {
    lead_id: conv.lead_id ?? null,
    name:    conv.participant_name ?? null,
    phone:   null,
    email:   null,
  }

  if (leadResult.status === 'fulfilled' && leadResult.value) {
    const lead = leadResult.value
    contact = {
      lead_id: conv.lead_id ?? null,
      name:    lead.name    ?? conv.participant_name ?? null,
      phone:   lead.phone   ?? null,
      email:   lead.email   ?? null,
    }
  } else if (leadResult.status === 'rejected') {
    console.error('[IG:CTX] ⚠️  Falha ao buscar lead (continuando):', leadResult.reason?.message)
  }

  // Mensagem gatilho — bloqueante (sem ela não sabemos o que o usuário escreveu)
  let userMessage = ''
  if (triggerResult.status === 'fulfilled' && triggerResult.value) {
    userMessage = triggerResult.value.content?.trim() ?? ''
  } else {
    console.error('[IG:CTX] ⚠️  Falha ao buscar mensagem gatilho:', {
      ig_message_id,
      reason: triggerResult.status === 'rejected' ? triggerResult.reason?.message : 'not_found',
    })
  }

  if (!userMessage) {
    console.warn('[IG:CTX] ⏭️  user_message vazio — abortando:', { ig_message_id })
    return { success: false, skip_reason: 'empty_user_message' }
  }

  // ── Montar output ──────────────────────────────────────────────────────────

  const output: InstagramContextOutput = {
    run_id,

    agent: {
      id:                    agent.id,
      prompt:                agent.prompt ?? null,
      prompt_config:         agent.prompt_config ?? null,
      knowledge_mode:        agent.knowledge_mode,
      knowledge_base:        agent.knowledge_base ?? null,
      knowledge_base_config: agent.knowledge_base_config ?? {},
      model:                 agent.model,
      model_config:          agent.model_config ?? {},
      allowed_tools:         Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [],
    },

    conversation: {
      id:              instagram_conversation_id,
      recent_messages: recentMessages,
    },

    contact,
    memory,
    user_message: userMessage,

    metadata: {
      company_id,
      assignment_id:             assignment.id,
      instagram_conversation_id,
      ig_message_id,
    },
  }

  console.log('[IG:CTX] ✅ Contexto montado:', {
    run_id,
    agent_id:         agent.id,
    messages_count:   recentMessages.length,
    has_lead:         !!contact.lead_id,
    has_memory:       !!memory?.summary,
    user_msg_length:  userMessage.length,
    company_id,
  })

  return { success: true, output }
}

// ── Funções de busca ───────────────────────────────────────────────────────────

type ConvRow = {
  id:               string
  company_id:       string
  lead_id:          number | null
  participant_name: string | null
  memory:           Record<string, unknown> | null
}

async function fetchConversation(
  svc: ReturnType<typeof createClient>,
  { instagram_conversation_id, company_id }: { instagram_conversation_id: string; company_id: string },
): Promise<ConvRow | null> {
  const { data, error } = await svc
    .from('instagram_conversations')
    .select('id, company_id, lead_id, participant_name, memory')
    .eq('id', instagram_conversation_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (error) throw new Error(`fetchConversation: ${error.message}`)
  return data ?? null
}

async function fetchMessages(
  svc: ReturnType<typeof createClient>,
  { instagram_conversation_id, company_id }: { instagram_conversation_id: string; company_id: string },
): Promise<InstagramMessage[]> {
  const { data, error } = await svc
    .from('instagram_messages')
    .select('id, direction, message_type, content, timestamp, created_at')
    .eq('conversation_id', instagram_conversation_id)
    .eq('company_id', company_id)
    .in('direction', ['inbound', 'outbound'])
    // Ignorar tipos não-textuais (sem conteúdo textual útil para o LLM)
    .eq('message_type', 'text')
    .not('content', 'is', null)
    .order('timestamp', { ascending: true })
    .limit(MESSAGES_LIMIT)

  if (error) throw new Error(`fetchMessages: ${error.message}`)

  return (data ?? [])
    .filter((m: Record<string, unknown>) => typeof m.content === 'string' && (m.content as string).trim() !== '')
    .map((m: Record<string, unknown>) => ({
      id:         m.id as string,
      direction:  m.direction as 'inbound' | 'outbound',
      content:    (m.content as string).trim(),
      created_at: (m.timestamp as string) ?? (m.created_at as string),
    }))
}

async function fetchTriggerMessage(
  svc: ReturnType<typeof createClient>,
  { ig_message_id, company_id }: { ig_message_id: string; company_id: string },
): Promise<{ content: string } | null> {
  const { data, error } = await svc
    .from('instagram_messages')
    .select('content, direction')
    .eq('ig_message_id', ig_message_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (error) throw new Error(`fetchTriggerMessage: ${error.message}`)
  if (!data) return null

  // Só aceitar inbound como mensagem do usuário
  if (data.direction !== 'inbound') return null

  return { content: data.content ?? '' }
}

async function fetchLead(
  svc: ReturnType<typeof createClient>,
  { lead_id, company_id }: { lead_id: number; company_id: string },
): Promise<{ name: string | null; phone: string | null; email: string | null } | null> {
  const { data, error } = await svc
    .from('leads')
    .select('name, phone, email')
    .eq('id', lead_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (error) throw new Error(`fetchLead: ${error.message}`)
  return data ?? null
}

// ── Construção do extra_context ────────────────────────────────────────────────

/**
 * Monta a string de extra_context para o runner.
 * Inclui: memória conversacional, histórico e dados do contato.
 * Sem catálogo de produtos (agente Instagram é conversacional puro).
 */
export function buildInstagramExtraContext(output: InstagramContextOutput): string {
  const sections: string[] = []

  // ── 0. Memória conversacional ──────────────────────────────────────────────
  if (output.memory?.summary && typeof output.memory.summary === 'string') {
    const lines: string[] = [output.memory.summary as string]

    if (Array.isArray(output.memory.open_loops) && (output.memory.open_loops as unknown[]).length > 0) {
      lines.push(`Aguardando resposta: ${(output.memory.open_loops as unknown[]).join(', ')}`)
    }

    const meta: string[] = []
    if (typeof output.memory.conversation_stage === 'string') {
      meta.push(`Estágio: ${output.memory.conversation_stage}`)
    }
    if (typeof output.memory.interaction_count === 'number') {
      meta.push(`Interações: ${output.memory.interaction_count}`)
    }
    if (meta.length) lines.push(meta.join(' | '))

    sections.push(`[MEMÓRIA]\n${lines.join('\n')}`)
  }

  // ── 1. Histórico da conversa ───────────────────────────────────────────────
  const messages = output.conversation.recent_messages
  if (messages.length > 0) {
    let history = messages
      .map(m => {
        const prefix = m.direction === 'inbound' ? '[CONTATO]' : '[AGENTE]'
        return `${prefix}: ${m.content}`
      })
      .join('\n')

    // Hard cap para economia de tokens
    if (history.length > HISTORY_MAX_CHARS) {
      history = history.slice(-HISTORY_MAX_CHARS)
    }

    sections.push(`Histórico da conversa (últimas ${messages.length} mensagens):\n${history}`)
  }

  // ── 2. Informações do contato ──────────────────────────────────────────────
  const { contact } = output
  if (contact.name || contact.phone || contact.email || contact.lead_id) {
    const lines: string[] = []
    lines.push(`Nome: ${contact.name ?? '(não identificado)'}`)
    if (contact.phone) lines.push(`Telefone: ${contact.phone}`)
    if (contact.email) lines.push(`E-mail: ${contact.email}`)
    if (contact.lead_id) lines.push(`Lead ID: ${contact.lead_id} (já convertido)`)
    sections.push(`Informações do contato:\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}
