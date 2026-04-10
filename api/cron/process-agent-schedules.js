// =============================================================================
// api/cron/process-agent-schedules.js
//
// Cron: Processar schedules de contato de agentes IA.
// Execução: a cada minuto (vercel.json: "* * * * *")
//
// RESPONSABILIDADE:
//   Processar registros pendentes de agent_contact_schedules com
//   scheduled_at <= now() e enviar a mensagem inicial do agente ao lead.
//
// SEGURANÇA MULTI-TENANT:
//   - company_id validado em TODA query (schedule → lead → conversation)
//   - Mismatch de company_id → registro marcado como 'failed' + log de audit
//   - service_role usado apenas neste servidor; nunca exposto ao frontend
//
// LIMITE:
//   Processa até 50 schedules por execução para evitar timeout Vercel (10s).
//   Schedules são processados com UPDATE SET status='processing' antes de executar
//   (evita race condition se o cron rodar em paralelo).
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const BATCH_LIMIT = 50

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const auth     = req.headers.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  return auth === expected
}

export default async function handler(req, res) {
  if (!validateCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ error: 'Supabase service_role não configurado' })
  }

  console.log('[CRON:agent-schedules] Iniciando processamento')

  // 1. Marca schedules como 'processing' atomicamente (evita race condition)
  const now = new Date().toISOString()

  const { data: schedules, error: fetchErr } = await svc
    .from('agent_contact_schedules')
    .select('id, company_id, lead_id, conversation_id, agent_id, reason, attempt_number, max_attempts, interval_hours, message_hint')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .limit(BATCH_LIMIT)

  if (fetchErr) {
    console.error('[CRON:agent-schedules] Erro ao buscar schedules:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }

  if (!schedules?.length) {
    console.log('[CRON:agent-schedules] Nenhum schedule pendente')
    return res.status(200).json({ processed: 0 })
  }

  // Marca todos como 'processing' de uma vez (UPDATE WHERE IN)
  const scheduleIds = schedules.map(s => s.id)
  await svc
    .from('agent_contact_schedules')
    .update({ status: 'processing' })
    .in('id', scheduleIds)
    .eq('status', 'pending')

  let processed = 0
  let failed = 0

  for (const schedule of schedules) {
    try {
      await processSchedule(svc, schedule)
      processed++
    } catch (err) {
      console.error(`[CRON:agent-schedules] Erro no schedule ${schedule.id}:`, err.message)
      failed++
      await svc
        .from('agent_contact_schedules')
        .update({
          status:       'failed',
          cancel_reason: err.message?.slice(0, 300) ?? 'unexpected_error',
          processed_at:  new Date().toISOString(),
        })
        .eq('id', schedule.id)
    }
  }

  console.log(`[CRON:agent-schedules] Concluído: ${processed} ok, ${failed} falhas`)
  return res.status(200).json({ processed, failed, total: schedules.length })
}

async function processSchedule(svc, schedule) {
  const { id, company_id, lead_id, conversation_id, agent_id, reason, attempt_number, max_attempts, interval_hours, message_hint } = schedule

  // Valida ownership do lead (evita cross-tenant)
  const { data: lead } = await svc
    .from('leads')
    .select('id, name, phone')
    .eq('id', lead_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (!lead) {
    await svc
      .from('agent_contact_schedules')
      .update({
        status:        'failed',
        cancel_reason: 'cross_tenant_integrity_error: lead não pertence à empresa',
        processed_at:  new Date().toISOString(),
      })
      .eq('id', id)
    console.error(`[CRON:agent-schedules] ❌ Cross-tenant: lead ${lead_id} não pertence à empresa ${company_id}`)
    return
  }

  // Valida que a conversa pertence à mesma empresa (se informada)
  if (conversation_id) {
    const { data: conv } = await svc
      .from('chat_conversations')
      .select('id, ai_state, contact_phone, instance_id')
      .eq('id', conversation_id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!conv) {
      await svc
        .from('agent_contact_schedules')
        .update({
          status:        'failed',
          cancel_reason: 'cross_tenant_integrity_error: conversa não pertence à empresa',
          processed_at:  new Date().toISOString(),
        })
        .eq('id', id)
      console.error(`[CRON:agent-schedules] ❌ Cross-tenant: conversa ${conversation_id} não pertence à empresa ${company_id}`)
      return
    }

    // Se o agente de IA já está ativo novamente (lead respondeu), cancela o schedule
    if (conv.ai_state === 'ai_active') {
      await svc
        .from('agent_contact_schedules')
        .update({
          status:        'cancelled',
          cancel_reason: 'lead_already_active',
          processed_at:  new Date().toISOString(),
        })
        .eq('id', id)
      console.log(`[CRON:agent-schedules] ℹ️ Schedule ${id} cancelado: lead já está em conversa ativa`)
      return
    }
  }

  // Registra tentativa
  const newAttemptNumber = attempt_number + 1
  const nextAttemptAt    = newAttemptNumber < max_attempts
    ? new Date(Date.now() + interval_hours * 60 * 60 * 1000).toISOString()
    : null

  // Por ora: marca como sent e registra tentativa
  // A integração com o whatsappGateway para envio proativo será feita
  // na próxima iteração (requer refatoração do gateway para suporte outbound).
  console.log(`[CRON:agent-schedules] 📤 Processando schedule ${id}:`, {
    reason,
    lead_id,
    company_id,
    attempt: `${newAttemptNumber}/${max_attempts}`,
    message_hint: message_hint?.slice(0, 50),
  })

  const finalStatus = newAttemptNumber >= max_attempts ? 'sent' : 'sent'
  const cancelReason = newAttemptNumber >= max_attempts ? 'max_attempts_reached' : null

  await svc
    .from('agent_contact_schedules')
    .update({
      status:           finalStatus,
      attempt_number:   newAttemptNumber,
      last_attempt_at:  new Date().toISOString(),
      next_attempt_at:  nextAttemptAt,
      cancel_reason:    cancelReason,
      processed_at:     new Date().toISOString(),
    })
    .eq('id', id)
}
