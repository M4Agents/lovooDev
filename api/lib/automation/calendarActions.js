// =====================================================
// CALENDAR ACTIONS — ações de automação para calendário
//
// Fase 2: implementa SOMENTE send_user_activity_notification.
//
// Padrão: chamado por crmActions.js (executeCrmAction)
// exatamente como as demais actions do motor.
// NÃO alterar executor.js — a integração é feita via crmActions.js.
//
// Segurança obrigatória em toda query:
//   activity:             id = activityId AND company_id = companyId
//   activity_notifications: company_id = companyId
//   company_users:        company_id = companyId AND is_active = true
// =====================================================

// ---------------------------------------------------------------------------
// Ação: send_user_activity_notification
//
// Fluxo:
//   1. Obtém companyId do context
//   2. Obtém activityId de context.triggerData.activity_id
//   3. Recarrega atividade ATUAL do banco (id + company_id) — não usa snapshot
//   4. Resolve destinatário: config.recipient_type === 'assigned_to' (padrão)
//   5. Valida que o destinatário é membro ativo da empresa
//   6. Insere em activity_notifications com company_id da empresa
// ---------------------------------------------------------------------------

async function sendUserActivityNotification(config, context, supabase) {
  const companyId = context.companyId

  if (!companyId) {
    throw new Error('companyId ausente no contexto')
  }

  // ── 1. Obter activity_id do triggerData ──────────────────────────────────
  const activityId = context.triggerData?.activity_id

  if (!activityId) {
    console.warn('[calendarActions][send_user_activity_notification] activity_id ausente no triggerData — skip')
    return { skipped: true, reason: 'activity_id ausente no triggerData' }
  }

  // ── 2. Recarregar atividade ATUAL do banco ───────────────────────────────
  // NUNCA usar apenas o snapshot — recarregar para garantir estado atual.
  // NUNCA buscar apenas por id — sempre id + company_id (multi-tenant).
  const { data: activity, error: activityErr } = await supabase
    .from('lead_activities')
    .select('id, company_id, lead_id, title, activity_type, priority, assigned_to, owner_user_id, scheduled_date, scheduled_time, status')
    .eq('id', activityId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (activityErr) {
    throw new Error(`Erro ao recarregar atividade: ${activityErr.message}`)
  }

  if (!activity) {
    console.warn(`[calendarActions][send_user_activity_notification] atividade id=${activityId} não encontrada na empresa=${companyId} — skip`)
    return { skipped: true, reason: 'atividade não encontrada na empresa' }
  }

  // ── 3. Resolver destinatário ─────────────────────────────────────────────
  // Fase 2: suporta apenas recipient_type = 'assigned_to' (padrão).
  // Comportamento explícito: se assigned_to for null, skip seguro com log.
  const recipientType = config.recipient_type || 'assigned_to'

  let recipientUserId = null

  if (recipientType === 'assigned_to') {
    if (!activity.assigned_to) {
      console.warn(`[calendarActions][send_user_activity_notification] atividade id=${activityId} não possui assigned_to — skip (nenhuma notificação enviada)`)
      return { skipped: true, reason: 'atividade sem assigned_to — nenhuma notificação enviada' }
    }
    recipientUserId = activity.assigned_to
  } else {
    console.warn(`[calendarActions][send_user_activity_notification] recipient_type="${recipientType}" não suportado nesta fase — skip`)
    return { skipped: true, reason: `recipient_type "${recipientType}" não implementado` }
  }

  // ── 4. Validar que o destinatário é membro ativo da empresa ──────────────
  // Fonte de verdade: company_users.
  // is_active = true obrigatório — nunca notificar usuário inativo.
  // company_id = companyId obrigatório — nunca aceitar membership de outra empresa.
  const { data: member, error: memberErr } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('user_id', recipientUserId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (memberErr) {
    throw new Error(`Erro ao validar membership do destinatário: ${memberErr.message}`)
  }

  if (!member) {
    console.warn(`[calendarActions][send_user_activity_notification] destinatário user=${recipientUserId} não é membro ativo da empresa=${companyId} — skip`)
    return { skipped: true, reason: 'destinatário não é membro ativo da empresa' }
  }

  // ── 5. Montar notificação ────────────────────────────────────────────────
  const activityTypeLabels = {
    call:      '📞 Ligação',
    meeting:   '🤝 Reunião',
    email:     '📧 E-mail',
    task:      '✅ Tarefa',
    follow_up: '🔄 Follow-up',
    demo:      '🎯 Demo',
    other:     '📋 Outro',
  }

  const activityLabel = activityTypeLabels[activity.activity_type] || '📅 Atividade'
  const title   = `${activityLabel}: ${activity.title}`
  const message = config.message_template
    ? config.message_template
        .replace('{{titulo}}',     activity.title          || '')
        .replace('{{tipo}}',       activity.activity_type  || '')
        .replace('{{data}}',       activity.scheduled_date || '')
        .replace('{{hora}}',       activity.scheduled_time || '')
    : `Nova atividade agendada para ${activity.scheduled_date} às ${activity.scheduled_time}`

  // ── 6. Inserir em activity_notifications ─────────────────────────────────
  // Usar somente colunas reais confirmadas no projeto (process-activity-notifications.js).
  // company_id obrigatório para garantir isolamento multi-tenant.
  const now = new Date().toISOString()

  const { error: insertErr } = await supabase
    .from('activity_notifications')
    .insert({
      company_id:        companyId,
      activity_id:       activity.id,
      user_id:           recipientUserId,
      notification_type: 'activity_assigned',
      title,
      message,
      status:            'sent',
      sent_at:           now,
      scheduled_for:     now,
    })

  if (insertErr) {
    throw new Error(`Erro ao inserir activity_notification: ${insertErr.message}`)
  }

  console.log(`[calendarActions][send_user_activity_notification] notificação criada — activity=${activityId} user=${recipientUserId} company=${companyId}`)

  return { success: true, recipient_user_id: recipientUserId }
}

// ---------------------------------------------------------------------------
// Entry point principal — chamado por crmActions.js
//
// Segue exatamente o mesmo contrato de executeCrmAction:
//   handleCalendarAction(node, context, supabase)
//
// Futuras ações de calendário (create_activity, complete_activity, etc.)
// serão adicionadas aqui nas Fases 3+.
// ---------------------------------------------------------------------------

export async function handleCalendarAction(node, context, supabase) {
  const config     = node.data?.config || {}
  const actionType = config.actionType

  console.log(`[calendarActions] executando: ${actionType}`)

  try {
    switch (actionType) {
      case 'send_user_activity_notification':
        return await sendUserActivityNotification(config, context, supabase)

      default:
        console.log(`[calendarActions] ação não suportada nesta fase: ${actionType} — skipped`)
        return { skipped: true, reason: `ação de calendário não suportada nesta fase: ${actionType}` }
    }
  } catch (err) {
    console.error(`[calendarActions] erro em ${actionType}:`, err?.message)
    throw err
  }
}
