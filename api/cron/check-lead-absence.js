// =============================================================================
// api/cron/check-lead-absence.js
//
// Cron: Detectar leads ausentes e criar schedules de follow-up automático.
// Execução: a cada 30 minutos (vercel.json: "*/30 * * * *")
//
// RESPONSABILIDADE:
//   Buscar conversas com IA ativa e sem mensagem INBOUND do lead há mais do
//   que o threshold configurado no assignment. Cria um schedule de follow_up
//   para cada conversa elegível que ainda não tenha um schedule pendente.
//
// CORREÇÕES EM RELAÇÃO À VERSÃO ANTERIOR:
//   1. Usa last_inbound_at (não last_message_at) — detecta ausência real do lead,
//      ignorando mensagens outbound do próprio agente.
//   2. Threshold configurável por assignment (não global de 48h).
//   3. Popula assignment_id + agent_id corretamente (era invertido antes).
//   4. Filtra apenas assignments com follow_up_enabled = true.
//   5. Sem N+1: duas queries (assignments + conversations) em vez de N queries.
//
// SEGURANÇA MULTI-TENANT:
//   - company_id validado em TODA query
//   - Cross-tenant check: assignment.company_id === conversation.company_id
//   - service_role usado apenas neste servidor; nunca exposto ao frontend
//   - Deduplicação: índice único parcial no banco (idx_agent_contact_schedules_dedup)
//     + verificação em código como defense-in-depth
//
// SEMÂNTICA DE agent_id vs assignment_id:
//   assignment_id = company_agent_assignments.id (configura o canal/empresa)
//   agent_id      = lovoo_agents.id (o modelo LLM base — via assignment.agent_id)
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const BATCH_LIMIT = 100

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

  // ── PASSO 1: Carregar assignments com follow_up habilitado ──────────────────
  // Sem N+1: uma única query para todos os assignments elegíveis.
  // ai_assignment_id não tem FK — impossível usar embedded join no PostgREST.
  const { data: assignments, error: assignmentErr } = await svc
    .from('company_agent_assignments')
    .select('id, company_id, agent_id, follow_up_enabled, follow_up_absence_hours, follow_up_max_attempts, follow_up_interval_hours')
    .eq('is_active', true)
    .eq('follow_up_enabled', true)
    .gt('follow_up_max_attempts', 0)

  if (assignmentErr) {
    console.error('[CRON:lead-absence] Erro ao buscar assignments:', assignmentErr.message)
    return res.status(500).json({ error: assignmentErr.message })
  }

  if (!assignments?.length) {
    console.log('[CRON:lead-absence] Nenhum assignment com follow_up habilitado')
    return res.status(200).json({ schedules_created: 0, reason: 'no_enabled_assignments' })
  }

  console.log(`[CRON:lead-absence] ${assignments.length} assignments com follow_up habilitado`)

  // Mapa rápido: assignmentId → config
  const assignmentMap = new Map(assignments.map(a => [a.id, a]))
  const assignmentIds = assignments.map(a => a.id)

  // ── PASSO 2: Buscar conversas elegíveis por assignment ───────────────────────
  // CORREÇÃO: query feita por assignment com threshold pré-filtrado no SQL.
  // Isso garante que o BATCH_LIMIT só se aplique às conversas já elegíveis,
  // não a todas as ativas. Sem esse filtro, conversas recentes eram descartadas
  // pelo LIMIT antes de chegar na verificação de threshold no JS.
  const allConversations = []
  for (const assignment of assignments) {
    const thresholdMs  = assignment.follow_up_absence_hours * 60 * 60 * 1000
    const thresholdISO = new Date(Date.now() - thresholdMs).toISOString()

    const { data: convs, error: convErr } = await svc
      .from('chat_conversations')
      .select('id, company_id, lead_id, ai_assignment_id, last_inbound_at')
      .eq('ai_state', 'ai_active')
      .eq('ai_assignment_id', assignment.id)
      .not('last_inbound_at', 'is', null)
      .not('lead_id', 'is', null)
      .lt('last_inbound_at', thresholdISO)
      .order('last_inbound_at', { ascending: true })
      .limit(BATCH_LIMIT)

    if (convErr) {
      console.error('[CRON:lead-absence] Erro ao buscar conversas para assignment:', {
        assignment_id: assignment.id,
        error: convErr.message,
      })
      continue
    }

    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'acb88e'},body:JSON.stringify({sessionId:'acb88e',location:'check-lead-absence.js:passo2',message:'conversas_por_assignment',data:{assignment_id:assignment.id,threshold_iso:thresholdISO,total_found:convs?.length??0,conv_ids:(convs??[]).map(c=>c.id)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    console.log(`[CRON:lead-absence] Assignment ${assignment.id}: ${convs?.length ?? 0} conversas elegíveis (threshold: ${thresholdISO})`)
    allConversations.push(...(convs ?? []))
  }

  const conversations = allConversations

  if (!conversations.length) {
    console.log('[CRON:lead-absence] Nenhuma conversa com ausência detectada')
    return res.status(200).json({ schedules_created: 0 })
  }

  console.log(`[CRON:lead-absence] ${conversations.length} conversas candidatas para análise`)

  let created = 0
  let skipped = 0

  for (const conv of conversations) {
    const { company_id, id: conversation_id, lead_id, ai_assignment_id, last_inbound_at } = conv

    // ── Validar assignment ────────────────────────────────────────────────────
    const assignment = assignmentMap.get(ai_assignment_id)
    if (!assignment) {
      // Assignment não está na lista habilitada (race condition entre queries)
      skipped++
      continue
    }

    // Cross-tenant: assignment.company_id deve bater com conversation.company_id
    if (assignment.company_id !== company_id) {
      console.error('[CRON:lead-absence] ❌ Cross-tenant detectado:', {
        conversation_id,
        conv_company: company_id,
        assignment_company: assignment.company_id,
        ai_assignment_id,
      })
      skipped++
      continue
    }

    // ── Verificar threshold individual ────────────────────────────────────────
    const thresholdMs   = assignment.follow_up_absence_hours * 60 * 60 * 1000
    const thresholdDate = new Date(Date.now() - thresholdMs)

    if (new Date(last_inbound_at) > thresholdDate) {
      // Lead ainda está dentro do prazo — não é ausente
      skipped++
      continue
    }

    // ── Verificar tentativas anteriores já realizadas ─────────────────────────
    // Conta apenas tentativas ENVIADAS com sucesso (status='sent') — exclui
    // cancelamentos (lead respondeu = não conta) e falhas técnicas (failed = não conta)
    const { count: sentCount, error: sentErr } = await svc
      .from('agent_contact_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .eq('conversation_id', conversation_id)
      .eq('reason', 'follow_up')
      .eq('status', 'sent')

    if (sentErr) {
      console.error('[CRON:lead-absence] Erro ao contar tentativas anteriores:', sentErr.message)
      continue
    }

    if ((sentCount ?? 0) >= assignment.follow_up_max_attempts) {
      console.log('[CRON:lead-absence] Max attempts atingido:', {
        conversation_id,
        sent_count: sentCount,
        max_attempts: assignment.follow_up_max_attempts,
      })
      skipped++
      continue
    }

    // ── Verificar schedule pendente ou processing já existente ────────────────
    // Defense-in-depth: o índice único no banco também protege contra duplicatas.
    const { data: existing, error: existErr } = await svc
      .from('agent_contact_schedules')
      .select('id')
      .eq('company_id', company_id)
      .eq('conversation_id', conversation_id)
      .eq('reason', 'follow_up')
      .in('status', ['pending', 'processing'])
      .maybeSingle()

    if (existErr) {
      console.error('[CRON:lead-absence] Erro ao verificar schedule existente:', existErr.message)
      continue
    }

    if (existing) {
      skipped++
      continue
    }

    // ── Criar schedule ─────────────────────────────────────────────────────────
    // message_hint < 300 chars (limite do campo)
    const messageHint =
      '[FOLLOWUP] Gere uma mensagem natural com base no histórico e sem repetir mensagens anteriores.'

    const { error: insertErr } = await svc
      .from('agent_contact_schedules')
      .insert({
        company_id,
        lead_id,
        conversation_id,
        // Semântica correta:
        agent_id:      assignment.agent_id,   // lovoo_agents.id (via assignment)
        assignment_id: assignment.id,          // company_agent_assignments.id
        reason:        'follow_up',
        scheduled_at:  new Date().toISOString(),
        attempt_number: 0,
        max_attempts:  assignment.follow_up_max_attempts,
        interval_hours: assignment.follow_up_interval_hours,
        status:        'pending',
        // Snapshot do último inbound para revalidação antes do envio
        last_inbound_snapshot: last_inbound_at,
        message_hint:  messageHint,
        retry_count:   0,
      })

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Conflito no índice único: outra execução do cron chegou primeiro
        console.log('[CRON:lead-absence] Dedup: schedule já existe (race condition normal):', {
          conversation_id,
        })
        skipped++
      } else {
        console.error('[CRON:lead-absence] Erro ao criar schedule:', {
          conversation_id,
          error: insertErr.message,
        })
      }
      continue
    }

    console.log('[CRON:lead-absence] ✅ Schedule criado:', {
      conversation_id,
      company_id,
      assignment_id: assignment.id,
      agent_id: assignment.agent_id,
      absence_hours: assignment.follow_up_absence_hours,
      last_inbound_at,
    })
    created++
  }

  console.log(`[CRON:lead-absence] Concluído: ${created} criados, ${skipped} ignorados, ${conversations.length} analisados`)
  return res.status(200).json({
    schedules_created: created,
    skipped,
    total_checked: conversations.length,
  })
}
