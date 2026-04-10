// =============================================================================
// api/cron/check-lead-absence.js
//
// Cron: Detectar leads ausentes e criar schedules de follow-up automático.
// Execução: a cada 30 minutos (vercel.json: "*/30 * * * *")
//
// RESPONSABILIDADE:
//   Buscar conversas com IA ativa mas sem mensagem do lead por mais de
//   ABSENCE_THRESHOLD_HOURS horas e criar um schedule de follow_up automático
//   (se ainda não existir um pendente).
//
// SEGURANÇA MULTI-TENANT:
//   - company_id presente em TODA query
//   - Deduplicação via constraint unique parcial (company_id + conversation_id + reason WHERE pending)
//   - ON CONFLICT DO NOTHING: idempotente mesmo se cron sobrepõe execuções
//
// CONFIGURAÇÃO (por empresa — futuro):
//   Por ora, ABSENCE_THRESHOLD_HOURS é global.
//   Fase 3: configurável por agent_flow_definitions.stages[].follow_up_hours
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const ABSENCE_THRESHOLD_HOURS = 48
const BATCH_LIMIT             = 100
const MAX_FOLLOW_UP_ATTEMPTS  = 3
const FOLLOW_UP_INTERVAL_HOURS = 48

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

export default async function handler(req, res) {
  if (!validateCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ error: 'Supabase service_role não configurado' })
  }

  console.log('[CRON:lead-absence] Iniciando verificação de ausência de leads')

  // Threshold de ausência
  const absenceThreshold = new Date(
    Date.now() - ABSENCE_THRESHOLD_HOURS * 60 * 60 * 1000
  ).toISOString()

  // Busca conversas com IA ativa sem mensagem recente do lead
  // lead_last_message_at: último timestamp de mensagem com direction='inbound'
  // Usa chat_conversations que já tem campos ai_state e last_message_at
  const { data: conversations, error: fetchErr } = await svc
    .from('chat_conversations')
    .select('id, company_id, lead_id, ai_assignment_id, last_message_at')
    .eq('ai_state', 'ai_active')
    .not('lead_id', 'is', null)
    .not('ai_assignment_id', 'is', null)
    .lt('last_message_at', absenceThreshold)
    .limit(BATCH_LIMIT)

  if (fetchErr) {
    console.error('[CRON:lead-absence] Erro ao buscar conversas:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }

  if (!conversations?.length) {
    console.log('[CRON:lead-absence] Nenhuma conversa com ausência detectada')
    return res.status(200).json({ schedules_created: 0 })
  }

  console.log(`[CRON:lead-absence] ${conversations.length} conversas com ausência detectada`)

  let created = 0
  let skipped = 0

  for (const conv of conversations) {
    const { company_id, id: conversation_id, lead_id, ai_assignment_id } = conv

    // Valida que lead pertence à mesma empresa (cross-tenant check)
    const { data: lead } = await svc
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!lead) {
      console.error(`[CRON:lead-absence] ❌ Cross-tenant: lead ${lead_id} não pertence à empresa ${company_id}`)
      continue
    }

    // Verifica se já existe schedule de follow_up PENDENTE para esta conversa
    // (deduplicação extra além da constraint unique)
    const { data: existing } = await svc
      .from('agent_contact_schedules')
      .select('id')
      .eq('company_id', company_id)
      .eq('conversation_id', conversation_id)
      .eq('reason', 'follow_up')
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    // Verifica total de tentativas anteriores para não exceder max_attempts
    const { count: previousAttempts } = await svc
      .from('agent_contact_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .eq('conversation_id', conversation_id)
      .eq('reason', 'follow_up')
      .in('status', ['sent', 'failed'])

    if ((previousAttempts ?? 0) >= MAX_FOLLOW_UP_ATTEMPTS) {
      console.log(`[CRON:lead-absence] Lead ${lead_id}: max attempts atingido — não criando novo follow_up`)
      skipped++
      continue
    }

    // Cria schedule de follow_up
    // ON CONFLICT DO NOTHING: idempotente se unique constraint já existir
    const { error: insertErr } = await svc
      .from('agent_contact_schedules')
      .insert({
        company_id,
        lead_id,
        conversation_id,
        agent_id:       ai_assignment_id,
        reason:         'follow_up',
        scheduled_at:   new Date().toISOString(),
        attempt_number: 0,
        max_attempts:   MAX_FOLLOW_UP_ATTEMPTS,
        interval_hours: FOLLOW_UP_INTERVAL_HOURS,
        status:         'pending',
        created_by:     'system',
      })

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Constraint unique: já existe schedule pendente (race condition com outro cron)
        skipped++
      } else {
        console.error(`[CRON:lead-absence] Erro ao criar schedule para lead ${lead_id}:`, insertErr.message)
      }
      continue
    }

    console.log(`[CRON:lead-absence] ✅ Schedule follow_up criado para lead ${lead_id} em conversa ${conversation_id}`)
    created++
  }

  console.log(`[CRON:lead-absence] Concluído: ${created} schedules criados, ${skipped} ignorados`)
  return res.status(200).json({
    schedules_created: created,
    skipped,
    total_checked: conversations.length,
  })
}
