// =============================================================================
// api/lib/agents/instagramAgentRouter.ts
//
// InstagramAgentRouter — decide se o agente deve processar a mensagem.
//
// RESPONSABILIDADE ÚNICA:
//   Receber os identificadores de uma mensagem Instagram e retornar se o agente
//   deve executar, junto com o assignment e o agente resolvidos.
//
// NÃO faz: claim de mensagem, build de contexto, envio, log de execução.
//
// VALIDAÇÕES (em ordem):
//   1. Conversa existe e pertence à empresa (company_id em todas as queries)
//   2. ai_state == 'ai_active'
//   3. ai_assignment_id não nulo
//   4. Mensagem: inbound + tipo suportado + não já completada
//   5. Assignment: mesma empresa, channel='instagram', is_active=true
//   6. Agent: is_active=true
//   7. Horário: dentro da janela do operating_schedule
//
// RETORNO:
//   { shouldProcess: true,  skipReason: null,   assignment, agent }
//   { shouldProcess: false, skipReason: string }
//
// Nunca lança exceção para casos normais de skip.
// Apenas erros de infraestrutura (DB indisponível) retornam skipReason='db_error'.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { isWithinSchedule } from './scheduleUtils.js'

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type RouterInput = {
  company_id:                string
  instagram_conversation_id: string
  ig_message_id:             string
}

export type AssignmentData = {
  id:                   string
  company_id:           string
  agent_id:             string
  channel:              string
  is_active:            boolean
  operating_schedule:   Record<string, unknown> | null
  capabilities:         Record<string, unknown>
  price_display_policy: string
}

export type AgentData = {
  id:                    string
  company_id:            string
  prompt:                string | null
  prompt_config:         Record<string, unknown> | null
  knowledge_mode:        string
  knowledge_base:        string | null
  knowledge_base_config: Record<string, unknown>
  model:                 string
  model_config:          Record<string, unknown>
  allowed_tools:         unknown[]
  is_active:             boolean
}

export type RouterOutput =
  | { shouldProcess: true;  skipReason: null;   assignment: AssignmentData; agent: AgentData }
  | { shouldProcess: false; skipReason: string; assignment?: undefined;     agent?: undefined }

// ── Tipos de mensagem suportados na v1 ─────────────────────────────────────────
// image, audio, video, sticker, story_reply, attachment, reaction, share
// são ignorados com skipReason='unsupported_message_type' e podem ser
// habilitados em versões futuras.
const SUPPORTED_MESSAGE_TYPES = new Set(['text'])

// ── Cliente service_role ───────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ── Função principal ───────────────────────────────────────────────────────────

/**
 * Decide se o agente Instagram deve processar esta mensagem.
 *
 * @param input - Identificadores da mensagem e da empresa.
 * @returns RouterOutput — shouldProcess=true com assignment e agent, ou false com skipReason.
 */
export async function routeInstagramAgent(input: RouterInput): Promise<RouterOutput> {
  const { company_id, instagram_conversation_id, ig_message_id } = input

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[IG:ROUTER] ❌ service_role indisponível — variáveis de ambiente ausentes')
    return skip('service_unavailable')
  }

  // ── 1. Buscar conversa com company_id (ownership + ai_state + assignment) ───
  const { data: conv, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id, ai_state, ai_assignment_id, connection_id')
    .eq('id', instagram_conversation_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (convErr) {
    console.error('[IG:ROUTER] ❌ Erro ao buscar conversa:', {
      error: convErr.message, instagram_conversation_id, company_id,
    })
    return skip('db_error')
  }
  if (!conv) {
    console.warn('[IG:ROUTER] ⏭️  Conversa não encontrada ou não pertence à empresa:', {
      instagram_conversation_id, company_id,
    })
    return skip('conversation_not_found')
  }

  // ── 2. Verificar ai_state ──────────────────────────────────────────────────
  if (conv.ai_state !== 'ai_active') {
    console.log('[IG:ROUTER] ⏭️  ai_state não é ai_active:', {
      ai_state: conv.ai_state, instagram_conversation_id,
    })
    return skip(conv.ai_state === 'ai_paused' ? 'ai_paused' : 'ai_inactive')
  }

  // ── 3. Verificar ai_assignment_id presente ─────────────────────────────────
  if (!conv.ai_assignment_id) {
    console.warn('[IG:ROUTER] ⏭️  ai_assignment_id nulo — conversa sem assignment de IA:', {
      instagram_conversation_id,
    })
    return skip('missing_assignment')
  }

  // ── 4. Buscar mensagem: inbound + tipo suportado + não já completada ────────
  const { data: msg, error: msgErr } = await svc
    .from('instagram_messages')
    .select('id, direction, message_type, content, agent_exec_status')
    .eq('ig_message_id', ig_message_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (msgErr) {
    console.error('[IG:ROUTER] ❌ Erro ao buscar mensagem:', {
      error: msgErr.message, ig_message_id, company_id,
    })
    return skip('db_error')
  }
  if (!msg) {
    console.warn('[IG:ROUTER] ⏭️  Mensagem não encontrada:', { ig_message_id, company_id })
    return skip('message_not_found')
  }

  if (msg.direction !== 'inbound') {
    return skip('outbound_message')
  }

  if (!SUPPORTED_MESSAGE_TYPES.has(msg.message_type)) {
    console.log('[IG:ROUTER] ⏭️  Tipo não suportado na v1:', {
      message_type: msg.message_type,
      ig_message_id,
    })
    return skip('unsupported_message_type')
  }

  // Mensagem já processada com sucesso → idempotência
  if (msg.agent_exec_status === 'completed') {
    return skip('already_processed')
  }

  // ── 5. Buscar assignment: mesma empresa + channel=instagram + ativo ─────────
  const { data: assignment, error: assignErr } = await svc
    .from('company_agent_assignments')
    .select('id, company_id, agent_id, channel, is_active, operating_schedule, capabilities, price_display_policy')
    .eq('id', conv.ai_assignment_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (assignErr) {
    console.error('[IG:ROUTER] ❌ Erro ao buscar assignment:', {
      error: assignErr.message, ai_assignment_id: conv.ai_assignment_id,
    })
    return skip('db_error')
  }
  if (!assignment) {
    console.warn('[IG:ROUTER] ⏭️  Assignment não encontrado ou de outra empresa:', {
      ai_assignment_id: conv.ai_assignment_id, company_id,
    })
    return skip('assignment_not_found')
  }
  if (!assignment.is_active) {
    console.log('[IG:ROUTER] ⏭️  Assignment inativo:', { assignment_id: assignment.id })
    return skip('assignment_inactive')
  }
  if (assignment.channel !== 'instagram') {
    console.warn('[IG:ROUTER] ⏭️  Assignment não é Instagram:', {
      channel: assignment.channel, assignment_id: assignment.id,
    })
    return skip('wrong_channel')
  }

  // ── 6. Buscar agente: ativo ────────────────────────────────────────────────
  const { data: agent, error: agentErr } = await svc
    .from('lovoo_agents')
    .select('id, company_id, prompt, prompt_config, knowledge_mode, knowledge_base, knowledge_base_config, model, model_config, allowed_tools, is_active')
    .eq('id', assignment.agent_id)
    .eq('is_active', true)
    .maybeSingle()

  if (agentErr) {
    console.error('[IG:ROUTER] ❌ Erro ao buscar agente:', {
      error: agentErr.message, agent_id: assignment.agent_id,
    })
    return skip('db_error')
  }
  if (!agent) {
    console.warn('[IG:ROUTER] ⏭️  Agente não encontrado ou inativo:', {
      agent_id: assignment.agent_id, company_id,
    })
    return skip('agent_not_found')
  }

  // ── 7. Verificar horário (operating_schedule) ──────────────────────────────
  const scheduleCheck = isWithinSchedule(assignment.operating_schedule, {
    assignmentId:   assignment.id,
    conversationId: instagram_conversation_id,
    companyId:      company_id,
  })

  if (!scheduleCheck.allowed) {
    console.log('[IG:ROUTER] ⏭️  Fora do horário:', {
      skip_reason: scheduleCheck.reason,
      assignment_id: assignment.id,
      company_id,
    })
    return skip('out_of_schedule')
  }

  console.log('[IG:ROUTER] ✅ Roteamento aprovado:', {
    instagram_conversation_id,
    ig_message_id,
    assignment_id: assignment.id,
    agent_id:      agent.id,
    company_id,
  })

  return {
    shouldProcess: true,
    skipReason:    null,
    assignment:    assignment as AssignmentData,
    agent:         agent as AgentData,
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function skip(skipReason: string): RouterOutput {
  return { shouldProcess: false, skipReason }
}
