// =============================================================================
// api/lib/agents/instagramAgentExecutor.ts
//
// InstagramAgentExecutor — orquestra o pipeline conversacional do Instagram.
//
// RESPONSABILIDADE ÚNICA:
//   Coordenar: Router → ContextBuilder → Claim → Runner → Memória → Gateway.
//   Registrar logs de execução. Nunca envia mensagens diretamente.
//
// FLUXO COMPLETO:
//   1. Router  → decide se deve processar + resolve assignment e agent
//   2. Context → constrói contexto para o runner
//   3. Claim   → UPDATE atômico em instagram_messages.agent_exec_status
//   4. Runner  → executa LLM via runAgentWithConfig()
//   5. Memória → escreve em instagram_conversations.memory (fire-and-forget)
//   6. Gateway → envia resposta ao participante Instagram
//   7. Status  → marca agent_exec_status = 'completed' ou 'failed'
//   8. Log     → registra em ai_agent_execution_logs (fire-and-forget)
//
// CLAIM ATÔMICO (Passo 3):
//   Usa UPDATE único com condição composta — nunca SELECT + UPDATE.
//   Elegível para claim:
//     - agent_exec_status IS NULL              (nunca processado)
//     - agent_exec_status = 'failed'           (falha anterior — retry permitido)
//     - agent_exec_status = 'processing'       (expirado após 5 min — recovery)
//   Não elegível:
//     - agent_exec_status = 'completed'        (já processado com sucesso)
//   Se RETURNING retornar 0 linhas → skip 'claim_failed' (concorrência ou já completo).
//
// MEMÓRIA (Passo 5):
//   Escrita exclusivamente em instagram_conversations.memory — nunca em chat_conversations.
//   Fire-and-forget: falha de memória não aborta a execução.
//   Formato: mesmo esquema do agentExecutor.js (chave 'v', summary, facts, etc.).
//
// BILLING:
//   Segue o mesmo padrão do agentExecutor.js — fire-and-forget após log de sucesso.
//
// MULTI-TENANT:
//   company_id revalidado em cada etapa. Nunca confia apenas no ContextBuilderOutput.
// =============================================================================

import { createClient }           from '@supabase/supabase-js'
import { runAgentWithConfig }     from './runner.js'
import { buildPromptFromConfig }  from './promptTemplate.js'
import { routeInstagramAgent }    from './instagramAgentRouter.js'
import {
  buildInstagramContext,
  buildInstagramExtraContext,
  type InstagramContextOutput,
} from './instagramContextBuilder.js'
import { sendInstagramGateway }  from './instagramGateway.js'
import type { AgentRunContext }  from './runner.js'

// ── Constantes ─────────────────────────────────────────────────────────────────

const USE_ID = 'chat:conversational_agent:instagram'

/** Tempo máximo em ms que um claim 'processing' permanece válido antes de recuperação */
const CLAIM_EXPIRY_MINUTES = 5

/** Créditos: 1.000 tokens = 1,6 créditos × multiplicador de canal */
const CREDIT_RATE = 1.6
const FEATURE_MULTIPLIERS: Record<string, number> = { instagram: 1 }

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type ExecutorInput = {
  company_id:                string
  instagram_conversation_id: string
  ig_message_id:             string
}

export type ExecutorOutput =
  | { success: true;  run_id: string; response_sent: boolean }
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
 * Executa o pipeline completo do agente Instagram para uma mensagem inbound.
 */
export async function executeInstagramAgent(input: ExecutorInput): Promise<ExecutorOutput> {
  const { company_id, instagram_conversation_id, ig_message_id } = input
  const startMs = Date.now()
  const run_id  = crypto.randomUUID()

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[IG:EXEC] ❌ service_role indisponível', { company_id, ig_message_id })
    return { success: false, skip_reason: 'service_unavailable' }
  }

  // ── 1. Router ──────────────────────────────────────────────────────────────
  const routeResult = await routeInstagramAgent({ company_id, instagram_conversation_id, ig_message_id })

  if (!routeResult.shouldProcess) {
    console.log('[IG:EXEC] ⏭️  Router: skip:', {
      skip_reason: routeResult.skipReason, ig_message_id, company_id,
    })
    return { success: false, skip_reason: routeResult.skipReason }
  }

  const { assignment, agent } = routeResult

  // ── 2. Context Builder ─────────────────────────────────────────────────────
  const ctxResult = await buildInstagramContext({
    company_id,
    instagram_conversation_id,
    ig_message_id,
    assignment,
    agent,
    run_id,
  })

  if (!ctxResult.success) {
    console.error('[IG:EXEC] ❌ ContextBuilder falhou:', {
      skip_reason: ctxResult.skip_reason, ig_message_id, company_id,
    })
    return { success: false, skip_reason: ctxResult.skip_reason, error: ctxResult.error }
  }

  const ctx = ctxResult.output

  // ── 3. Claim atômico ───────────────────────────────────────────────────────
  const claimed = await claimMessage(svc, { ig_message_id, company_id })

  if (!claimed) {
    console.log('[IG:EXEC] ⏭️  Claim falhou — mensagem sendo processada ou já completa:', {
      ig_message_id, company_id,
    })
    return { success: false, skip_reason: 'claim_failed' }
  }

  console.log('[IG:EXEC] 🔒 Claim adquirido:', { run_id, ig_message_id, company_id })

  // ── 4. Runner ──────────────────────────────────────────────────────────────
  // Resolver prompt via prompt_config (se disponível), igual ao agentExecutor.js
  let agentForRunner = ctx.agent
  if (ctx.agent.prompt_config) {
    const builtPrompt = buildPromptFromConfig(ctx.agent.prompt_config, null)
    if (builtPrompt) {
      agentForRunner = { ...ctx.agent, prompt: builtPrompt }
    }
  }

  const agentRunCtx: AgentRunContext = {
    userMessage:               ctx.user_message,
    extra_context:             buildInstagramExtraContext(ctx),
    company_id,
    channel:                   'instagram',
    user_id:                   undefined,
    entity_type:               ctx.contact?.lead_id ? 'lead'                : undefined,
    entity_id:                 ctx.contact?.lead_id ? String(ctx.contact.lead_id) : undefined,
    lead_id:                   ctx.contact?.lead_id ? String(ctx.contact.lead_id) : null,
    conversation_id:           null,
    instagram_conversation_id,
    model_config:              agent.model_config ?? {},
  }

  console.log('[IG:EXEC] 🚀 Chamando runner:', {
    run_id,
    agent_id:    agent.id,
    model:       agent.model,
    ctx_length:  agentRunCtx.extra_context?.length ?? 0,
    msg_length:  ctx.user_message.length,
    company_id,
  })

  let runResult: Awaited<ReturnType<typeof runAgentWithConfig>>

  try {
    runResult = await runAgentWithConfig(agentForRunner, USE_ID, agentRunCtx)
  } catch (runError: unknown) {
    const errMsg = runError instanceof Error ? runError.message : String(runError)
    console.error('[IG:EXEC] ❌ Exceção propagada do runner:', errMsg)
    await markMessage(svc, { ig_message_id, company_id, status: 'failed' })
    void writeInstagramLog(svc, { ctx, run_id, status: 'error_openai', error_code: 'openai_execution_failed', duration_ms: Date.now() - startMs })
    return { success: false, skip_reason: 'runner_error', error: errMsg }
  }

  if (!runResult.ok) {
    const errorCode = runResult.errorCode ?? 'openai_execution_failed'
    console.error('[IG:EXEC] ❌ Runner retornou ok=false:', { errorCode, run_id, company_id })
    await markMessage(svc, { ig_message_id, company_id, status: 'failed' })
    void writeInstagramLog(svc, { ctx, run_id, runResult, status: 'error_openai', error_code: errorCode, duration_ms: Date.now() - startMs })
    return { success: false, skip_reason: errorCode }
  }

  const duration_ms = Date.now() - startMs

  // ── 5. Extrair e persistir memória (fire-and-forget) ──────────────────────
  const { cleanResponse, memoryPayload } = extractMemoryBlock(runResult.result ?? '')

  if (memoryPayload) {
    const existingMemory = ctx.memory
    const recentMsgs = ctx.conversation.recent_messages

    void writeInstagramMemory(svc, {
      instagram_conversation_id,
      company_id,
      memoryPayload,
      existingMemory,
      recentMessages: recentMsgs,
    }).then(result => {
      console.log('[IG:MEM] write:', {
        run_id,
        instagram_conversation_id,
        company_id,
        result: result.ok ? 'saved' : result.reason,
      })
    }).catch(err => {
      console.error('[IG:MEM] write error (silencioso):', (err as Error).message)
    })
  }

  // ── 6. Gateway — enviar resposta ──────────────────────────────────────────
  const gatewayResult = await sendInstagramGateway({
    svc,
    company_id,
    instagram_conversation_id,
    assignment_id: assignment.id,
    response_text: cleanResponse,
    run_id,
  })

  // ── 7. Marcar claim como completed/failed ──────────────────────────────────
  const finalStatus = gatewayResult.success ? 'completed' : 'failed'
  await markMessage(svc, { ig_message_id, company_id, status: finalStatus })

  // ── 8. Log de execução (fire-and-forget) ───────────────────────────────────
  void writeInstagramLog(svc, {
    ctx,
    run_id,
    runResult,
    status: gatewayResult.success ? 'success' : 'error_send',
    error_code: gatewayResult.success ? undefined : gatewayResult.skip_reason ?? 'send_failed',
    duration_ms,
  })

  console.log('[IG:EXEC] ✅ Execução concluída:', {
    run_id,
    ig_message_id,
    company_id,
    response_sent:  gatewayResult.success,
    duration_ms,
    input_tokens:   runResult.input_tokens,
    output_tokens:  runResult.output_tokens,
  })

  return { success: true, run_id, response_sent: gatewayResult.success }
}

// ── Claim atômico ──────────────────────────────────────────────────────────────

/**
 * Tenta adquirir o claim da mensagem para este executor.
 * Usa UPDATE único com condição composta — nunca SELECT + UPDATE.
 *
 * Transições válidas:
 *   NULL         → processing
 *   failed       → processing  (retry)
 *   processing   → processing  (se expirado após CLAIM_EXPIRY_MINUTES)
 *
 * Retorna true se o claim foi adquirido (exatamente 1 linha atualizada).
 * Retorna false se concorrência ganhou ou a mensagem já foi completada.
 */
async function claimMessage(
  svc: ReturnType<typeof createClient>,
  { ig_message_id, company_id }: { ig_message_id: string; company_id: string },
): Promise<boolean> {
  const now       = new Date()
  const expiryTs  = new Date(now.getTime() - CLAIM_EXPIRY_MINUTES * 60 * 1000).toISOString()

  const { data, error } = await svc
    .from('instagram_messages')
    .update({
      agent_exec_status: 'processing',
      agent_queued_at:   now.toISOString(),
    })
    .eq('ig_message_id', ig_message_id)
    .eq('company_id', company_id)
    .or(
      `agent_exec_status.is.null,` +
      `agent_exec_status.eq.failed,` +
      `and(agent_exec_status.eq.processing,agent_queued_at.lt.${expiryTs})`
    )
    .select('id')

  if (error) {
    console.error('[IG:EXEC] ❌ Erro no claim da mensagem:', { error: error.message, ig_message_id })
    return false
  }

  return Array.isArray(data) && data.length === 1
}

/**
 * Atualiza o agent_exec_status final da mensagem.
 * Fire-and-forget safe: falha é logada mas não propaga.
 */
async function markMessage(
  svc: ReturnType<typeof createClient>,
  { ig_message_id, company_id, status }: { ig_message_id: string; company_id: string; status: 'completed' | 'failed' },
): Promise<void> {
  const { error } = await svc
    .from('instagram_messages')
    .update({ agent_exec_status: status })
    .eq('ig_message_id', ig_message_id)
    .eq('company_id', company_id)

  if (error) {
    console.error('[IG:EXEC] ⚠️  Falha ao atualizar agent_exec_status (não crítico):', {
      status, ig_message_id, error: error.message,
    })
  }
}

// ── Memória conversacional ─────────────────────────────────────────────────────

const MEM_SUMMARY_MAX_CHARS   = 300
const MEM_FACTS_MAX_KEYS      = 10
const MEM_FACTS_KEY_MAX_CHARS = 60
const MEM_FACTS_VAL_MAX_CHARS = 200
const MEM_LIST_MAX_ITEMS      = 3
const MEM_LIST_ITEM_MAX_CHARS = 80
const MEM_STAGE_MAX_CHARS     = 40
const MEM_TOTAL_MAX_BYTES     = 8192

/**
 * Extrai e valida o bloco <!-- mem: {...} --> da resposta bruta do LLM.
 * Mesmo formato que agentExecutor.js (compatibilidade de prompt).
 */
function extractMemoryBlock(rawResponse: string): {
  cleanResponse: string
  memoryPayload: Record<string, unknown> | null
} {
  const match = rawResponse.match(/<!--\s*mem:\s*(\{[\s\S]*?\})\s*-->/i)

  const cleanResponse = match
    ? rawResponse.replace(match[0], '').trim()
    : rawResponse.trim()

  if (!match) return { cleanResponse, memoryPayload: null }

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return { cleanResponse, memoryPayload: null }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { cleanResponse, memoryPayload: null }
  }

  const hasSummary = typeof parsed.summary === 'string' && (parsed.summary as string).trim().length > 0
  const hasFacts   = parsed.facts && typeof parsed.facts === 'object' && !Array.isArray(parsed.facts)
    && Object.keys(parsed.facts as object).length > 0

  if (!hasSummary && !hasFacts) return { cleanResponse, memoryPayload: null }

  return { cleanResponse, memoryPayload: parsed }
}

function safeList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((i): i is string => typeof i === 'string' && i.length > 0 && i.length <= MEM_LIST_ITEM_MAX_CHARS)
    .slice(0, MEM_LIST_MAX_ITEMS)
}

/**
 * Persiste a memória em instagram_conversations.memory — nunca em chat_conversations.
 * Usa merge inteligente: facts aditivo, demais campos sobrescritos pelo LLM.
 */
async function writeInstagramMemory(
  svc: ReturnType<typeof createClient>,
  {
    instagram_conversation_id,
    company_id,
    memoryPayload,
    existingMemory,
    recentMessages,
  }: {
    instagram_conversation_id: string
    company_id:                string
    memoryPayload:             Record<string, unknown>
    existingMemory:            Record<string, unknown> | null
    recentMessages:            Array<{ content: string }>
  },
): Promise<{ ok: boolean; reason?: string; interaction_count?: number }> {
  if (!memoryPayload || !instagram_conversation_id || !company_id || !svc) {
    return { ok: false, reason: 'missing_args' }
  }

  const now          = new Date().toISOString()
  const safeExisting = existingMemory && typeof existingMemory === 'object' ? existingMemory : {}

  // Merge de facts: preserva existentes, adiciona novos (com anti-injection simples)
  const rawFacts      = (memoryPayload.facts && typeof memoryPayload.facts === 'object' && !Array.isArray(memoryPayload.facts))
    ? memoryPayload.facts as Record<string, string>
    : {}
  const existingFacts = ((safeExisting as Record<string, unknown>).facts && typeof (safeExisting as Record<string, unknown>).facts === 'object')
    ? (safeExisting as Record<string, unknown>).facts as Record<string, string>
    : {}

  const msgText = recentMessages.map(m => m.content.toLowerCase()).join(' ')
  const sanitizedFacts: Record<string, string> = {}
  let factCount = 0

  for (const [k, v] of Object.entries(rawFacts)) {
    if (factCount >= MEM_FACTS_MAX_KEYS) break
    if (typeof k !== 'string' || k.length === 0 || k.length > MEM_FACTS_KEY_MAX_CHARS) continue
    if (typeof v !== 'string' || v.length === 0 || v.length > MEM_FACTS_VAL_MAX_CHARS) continue
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue

    const alreadyKnown = Object.prototype.hasOwnProperty.call(existingFacts, k)
    const inMessages   = msgText.length > 0 && v.toLowerCase().slice(0, 8).length >= 2 && msgText.includes(v.toLowerCase().slice(0, 8))

    if (alreadyKnown || inMessages) {
      sanitizedFacts[k] = v
      factCount++
    }
  }

  const mergedFacts = { ...existingFacts, ...sanitizedFacts }

  const merged: Record<string, unknown> = {
    v:                   2,
    summary:             String(memoryPayload.summary ?? (safeExisting as Record<string, unknown>).summary ?? '').slice(0, MEM_SUMMARY_MAX_CHARS),
    facts:               mergedFacts,
    intents:             safeList(memoryPayload.intents    ?? (safeExisting as Record<string, unknown>).intents    ?? []),
    objections:          safeList(memoryPayload.objections ?? (safeExisting as Record<string, unknown>).objections ?? []),
    open_loops:          safeList(memoryPayload.open_loops ?? (safeExisting as Record<string, unknown>).open_loops ?? []),
    conversation_stage:  String(memoryPayload.conversation_stage ?? (safeExisting as Record<string, unknown>).conversation_stage ?? 'prospecto').slice(0, MEM_STAGE_MAX_CHARS),
    interaction_count:   (typeof (safeExisting as Record<string, unknown>).interaction_count === 'number' ? (safeExisting as Record<string, unknown>).interaction_count as number : 0) + 1,
    last_interaction_at: now,
    updated_at:          now,
  }

  // Hard cap 8 KB
  if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > MEM_TOTAL_MAX_BYTES) {
    const entries = Object.entries(mergedFacts).slice(-5)
    merged.facts  = Object.fromEntries(entries)
    console.warn('[IG:MEM] memory acima de 8KB — facts truncados:', { instagram_conversation_id })
  }

  const { error } = await svc
    .from('instagram_conversations')
    .update({ memory: merged })
    .eq('id', instagram_conversation_id)
    .eq('company_id', company_id)

  if (error) {
    console.error('[IG:MEM] Falha ao persistir memória:', { instagram_conversation_id, company_id, error: error.message })
    return { ok: false, reason: 'db_error' }
  }

  return { ok: true, interaction_count: merged.interaction_count as number }
}

// ── Log de execução ────────────────────────────────────────────────────────────

/**
 * Insere registro em ai_agent_execution_logs.
 * Fire-and-forget — nunca bloqueia o fluxo.
 */
async function writeInstagramLog(
  svc: ReturnType<typeof createClient> | null,
  {
    ctx,
    run_id,
    runResult,
    status,
    error_code,
    duration_ms,
  }: {
    ctx:        InstagramContextOutput
    run_id:     string
    runResult?: Awaited<ReturnType<typeof runAgentWithConfig>>
    status:     string
    error_code?: string
    duration_ms: number
  },
): Promise<void> {
  if (!svc) return

  try {
    const { data: logData, error: insertError } = await svc
      .from('ai_agent_execution_logs')
      .insert({
        use_id:              USE_ID,
        agent_id:            ctx.agent.id,
        consumer_company_id: ctx.metadata.company_id,
        user_id:             null,
        channel:             'instagram',
        model:               ctx.agent.model,
        knowledge_mode:      ctx.agent.knowledge_mode,
        status,
        is_fallback:         false,
        duration_ms,
        input_tokens:        runResult?.input_tokens  ?? null,
        output_tokens:       runResult?.output_tokens ?? null,
        total_tokens:        runResult?.total_tokens  ?? null,
        estimated_cost_usd:  runResult?.estimated_cost_usd ?? null,
        error_code:          error_code ?? null,
        conversation_id:     null,
        session_id:          null,
        assignment_id:       ctx.metadata.assignment_id ?? null,
        rule_id:             null,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[IG:EXEC] ⚠️  Falha ao registrar log (silencioso):', insertError.message)
      return
    }

    // Billing — fire-and-forget após log de sucesso
    if (status === 'success' && logData?.id && runResult?.total_tokens) {
      const multiplier = FEATURE_MULTIPLIERS.instagram ?? 0
      if (multiplier > 0) {
        const credits = Math.ceil((runResult.total_tokens / 1000) * CREDIT_RATE * multiplier)
        if (credits > 0) {
          void svc.rpc('debit_credits_atomic', {
            p_company_id:       ctx.metadata.company_id,
            p_credits:          credits,
            p_feature_type:     'instagram',
            p_total_tokens:     runResult.total_tokens,
            p_model:            ctx.agent.model ?? null,
            p_execution_log_id: logData.id,
          }).catch((err: unknown) => {
            console.error('[IG:BILLING] Exceção ao debitar créditos (silencioso):', (err as Error).message)
          })
        }
      }
    }
  } catch (logError: unknown) {
    console.error('[IG:EXEC] ⚠️  Exceção ao registrar log (silencioso):', (logError as Error).message)
  }
}
