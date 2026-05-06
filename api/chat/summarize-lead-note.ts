// =============================================================================
// POST /api/chat/summarize-lead-note
//
// Gera um resumo da conversa via agente de IA e cria uma nota imutável
// no Lead vinculado à conversa.
//
// Body:
//   conversation_id  (string, UUID) — obrigatório
//
// Segurança:
//   - company_id NUNCA vem do body: derivado de chat_conversations.company_id
//   - membership validado em company_users (is_active = true)
//   - service_role usado apenas após validação de auth + membership
//   - Nota criada com is_editable = false (imutável via trigger de banco)
//
// Idempotência:
//   - Retorna nota existente se criada nos últimos 2 minutos para a mesma conversa
//   - Previne duplicidade por double-click ou retry rápido
//
// Créditos:
//   - Verificados antes da chamada ao LLM (margem de 1.3x)
//   - Empresa pai (company_type = 'parent') isenta de débito
//   - Se débito falhar após LLM: nota criada com metadata.billing_failed = true
//     (garante que o resumo não se perde)
// =============================================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { runAgent } from '../lib/agents/runner.js'

const USE_ID          = 'chat:summary:conversation'
const CREDIT_RATE     = 100    // créditos por 1000 tokens
const MARGIN_FACTOR   = 1.3    // saldo mínimo = estimado * 1.3
const MIN_CREDITS     = 10     // mínimo por resumo
const IDEMPOTENCY_MIN = 2      // janela de idempotência em minutos
const MAX_MESSAGES    = 100    // limite de mensagens para o LLM

// Formata data/hora no padrão BR: DD/MM/YYYY HH:mm
function formatDatetimeBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(date)
}

// Estima tokens a partir do tamanho do texto (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Calcula créditos a debitar baseado em tokens estimados
function calculateCredits(tokens: number): number {
  return Math.max(MIN_CREDITS, Math.ceil((tokens / 1000) * CREDIT_RATE))
}

// Verifica saldo de créditos da empresa
async function getCompanyBalance(svc: any, companyId: string): Promise<number> {
  const { data } = await svc
    .from('company_credits')
    .select('plan_credits, extra_credits')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data?.plan_credits ?? 0) + (data?.extra_credits ?? 0)
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ─── 1. Autenticação ───────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // Nome do usuário para auditoria na nota — extraído do token, sem query extra
    const meta     = (user.user_metadata ?? {}) as Record<string, string>
    const userName = meta.display_name?.trim() || meta.full_name?.trim() || user.email || user.id

    // ─── 2. Validação do body — apenas conversation_id ────────────────────
    const body = req.body ?? {}
    const conversationId = typeof body.conversation_id === 'string'
      ? body.conversation_id.trim()
      : ''

    if (!conversationId) {
      jsonError(res, 400, 'conversation_id é obrigatório'); return
    }

    // ─── 3. Buscar conversa e derivar company_id ──────────────────────────
    // company_id NUNCA vem do body — extraído do registro de conversa
    const { data: conv, error: convErr } = await svc
      .from('chat_conversations')
      .select('id, company_id, lead_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convErr || !conv) {
      jsonError(res, 404, 'Conversa não encontrada'); return
    }

    const companyId: string = conv.company_id

    // ─── 4. Validar membership ────────────────────────────────────────────
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ─── 5. Validar vínculo com lead ──────────────────────────────────────
    if (!conv.lead_id) {
      jsonError(res, 422, 'Conversa não vinculada a um lead. Associe um lead para gerar o resumo.'); return
    }

    const leadId: number = conv.lead_id

    // ─── 6. Buscar lead (re-valida company_id) ────────────────────────────
    const { data: lead, error: leadErr } = await svc
      .from('leads')
      .select('id, name')
      .eq('id', leadId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle()

    if (leadErr || !lead) {
      jsonError(res, 404, 'Lead vinculado não encontrado'); return
    }

    // ─── 7. Idempotência: retornar nota existente se criada recentemente ──
    const idempotencyWindow = new Date(Date.now() - IDEMPOTENCY_MIN * 60 * 1000).toISOString()
    const { data: existingNote } = await svc
      .from('internal_notes')
      .select('id, content, created_at, metadata')
      .eq('company_id', companyId)
      .eq('lead_id', leadId)
      .eq('source', 'ai:chat_summary')
      .filter('metadata->conversation_id', 'eq', conversationId)
      .gte('created_at', idempotencyWindow)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingNote) {
      res.status(200).json({
        success:  true,
        summary:  existingNote.content,
        note_id:  existingNote.id,
        reused:   true,
      })
      return
    }

    // ─── 8. Buscar mensagens da conversa (máximo 100, ordem cronológica) ──
    const { data: messages, error: msgErr } = await svc
      .from('chat_messages')
      .select('direction, content, timestamp, created_at')
      .eq('conversation_id', conversationId)
      .eq('company_id', companyId)
      .not('content', 'is', null)
      .neq('content', '')
      .order('timestamp', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGES)

    if (msgErr) {
      jsonError(res, 500, 'Erro ao buscar mensagens da conversa'); return
    }

    if (!messages || messages.length === 0) {
      jsonError(res, 422, 'Nenhuma mensagem disponível para gerar o resumo'); return
    }

    // Reverter para ordem cronológica (busca foi DESC para pegar as mais recentes)
    const orderedMessages = [...messages].reverse()

    // Serializar mensagens para o LLM
    const serializedMessages = orderedMessages
      .map(m => {
        const ts = m.timestamp ?? m.created_at
        const time = ts
          ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : ''
        const direction = m.direction === 'inbound' ? 'Contato' : 'Atendente'
        return `[${direction}${time ? ` ${time}` : ''}]: ${m.content}`
      })
      .join('\n')

    // ─── 9. Verificar agente configurado e créditos ───────────────────────
    // runAgent valida internamente o use_id e chama resolveAgent.
    // Se não houver binding, retorna { ok: false, errorCode: 'no_binding' }.
    // Fazemos a verificação de créditos aqui, antes de chamar o LLM.

    // 9a. Verificar se empresa é pai (isenta de créditos)
    const { data: companyRow } = await svc
      .from('companies')
      .select('company_type')
      .eq('id', companyId)
      .maybeSingle()
    const isParentCompany = companyRow?.company_type === 'parent'

    // 9b. Verificar saldo (apenas empresas não-pai)
    if (!isParentCompany) {
      const estimatedTokens = estimateTokens(serializedMessages)
      const creditsEstimated = calculateCredits(estimatedTokens)
      const balance = await getCompanyBalance(svc, companyId)
      const requiredBalance = Math.ceil(creditsEstimated * MARGIN_FACTOR)

      if (balance < requiredBalance) {
        jsonError(res, 402, `Saldo de créditos insuficiente. Necessário: ${requiredBalance}, disponível: ${balance}`); return
      }
    }

    // ─── 10. Executar agente de IA ────────────────────────────────────────
    const userMessage = [
      `Conversa com o lead: ${lead.name}`,
      '',
      serializedMessages,
    ].join('\n')

    const runResult = await runAgent(USE_ID, {
      userMessage,
      company_id: companyId,
      user_id:    user.id,
      channel:    'web',
      entity_type: 'lead',
      entity_id:   String(lead.id),
      conversation_id: conversationId,
    })

    if (!runResult.ok) {
      const errorCode = (runResult as any).errorCode ?? 'agent_error'
      if (errorCode === 'no_binding' || errorCode === 'agent_inactive') {
        jsonError(res, 422, 'Agente de resumo não configurado. Acesse Configurações > Agentes Globais para configurar.')
      } else {
        jsonError(res, 502, `Erro ao executar agente de IA: ${errorCode}`)
      }
      return
    }

    if (runResult.fallback) {
      jsonError(res, 422, 'Agente de resumo não disponível no momento. Tente novamente.'); return
    }

    const summaryText = runResult.result

    // ─── 11. Débito de créditos (padrão ai-analysis.ts) ──────────────────
    const finalTokens     = estimateTokens(serializedMessages)
    const creditsToDebit  = calculateCredits(finalTokens)
    const requestId       = crypto.randomUUID()

    let billingFailed = false

    if (!isParentCompany) {
      const { data: debitResult, error: debitError } = await svc.rpc('debit_credits_atomic', {
        p_company_id:       companyId,
        p_credits:          creditsToDebit,
        p_feature_type:     'insights',
        p_total_tokens:     finalTokens,
        p_execution_log_id: requestId,
      })

      const debitOk = !debitError && debitResult?.ok === true

      if (!debitOk) {
        // LLM concluiu mas débito falhou — criar nota com flag billing_failed
        // para não perder o resumo gerado
        billingFailed = true
        console.error('[summarize-lead-note] Falha no débito de créditos:', debitError?.message ?? JSON.stringify(debitResult))
      }
    }

    // ─── 12. Criar nota imutável no Lead ──────────────────────────────────
    const now          = new Date()
    const formattedNow = formatDatetimeBR(now)

    const noteContent = [
      `Resumo gerado por IA`,
      `Data: ${formattedNow}`,
      `Solicitado por: ${userName}`,
      '',
      summaryText,
    ].join('\n')

    const noteMetadata: Record<string, unknown> = {
      conversation_id:      conversationId,
      generated_at:         now.toISOString(),
      message_count:        orderedMessages.length,
      requested_by_user_id: user.id,
      requested_by_name:    userName,
    }
    if (billingFailed) noteMetadata.billing_failed = true

    const { data: note, error: noteErr } = await svc
      .from('internal_notes')
      .insert({
        company_id:   companyId,
        lead_id:      leadId,
        content:      noteContent,
        created_by:   user.id,
        source:       'ai:chat_summary',
        ai_agent_id:  runResult.agent_id ?? null,
        is_editable:  false,
        metadata:     noteMetadata,
      })
      .select('id, content, created_at')
      .single()

    if (noteErr || !note) {
      // Resumo gerado mas nota não criada — retornar o texto para não perder
      console.error('[summarize-lead-note] Falha ao criar nota:', noteErr?.message)
      res.status(500).json({
        ok:      false,
        error:   'Resumo gerado mas falha ao salvar a nota. Copie o texto abaixo.',
        summary: summaryText,
      })
      return
    }

    // ─── 13. Resposta de sucesso ───────────────────────────────────────────
    res.status(200).json({
      success:  true,
      summary:  summaryText,
      note_id:  note.id,
      reused:   false,
    })

  } catch (err: any) {
    console.error('[summarize-lead-note] Erro inesperado:', err?.message ?? err)
    jsonError(res, 500, 'Erro interno no servidor')
  }
}
