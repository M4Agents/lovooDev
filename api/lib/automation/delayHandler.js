// =====================================================
// DELAY HANDLER — Fase A do nó delay no backend
//
// Responsabilidade: pausar execução em nó delay e criar
// o schedule para retomada posterior via cron.
//
// Campos reais usados:
//   automation_executions:  status, paused_at, resume_at, current_node_id
//   automation_schedules:   scheduled_for, entity_id, entity_type, trigger_data
//
// Formatos de delay suportados:
//   duration + unit (seconds, minutes, hours, days)
//   targetDateTime (ISO string — data/hora fixa)
//   businessHoursOnly (ajusta para próximo horário comercial: seg-sex 9h-18h)
//
// Sem imports de src/ — usa supabaseAdmin como parâmetro.
// =====================================================

// ---------------------------------------------------------------------------
// Calcular resume_at a partir da config do nó
// Retorna Date ou lança erro se config inválida.
// ---------------------------------------------------------------------------

function calculateResumeAt(config) {
  // Modo 1: data/hora fixa
  if (config.targetDateTime) {
    const target = new Date(config.targetDateTime)
    if (isNaN(target.getTime())) throw new Error(`targetDateTime inválido: "${config.targetDateTime}"`)
    if (target <= new Date()) throw new Error(`targetDateTime já passou: "${config.targetDateTime}"`)
    return target
  }

  // Modo 2: duração + unidade
  const duration = Number(config.duration)
  const unit     = config.unit || 'minutes'

  if (!duration || isNaN(duration) || duration <= 0) {
    throw new Error(`duration inválido: "${config.duration}" — deve ser número positivo`)
  }

  const validUnits = ['seconds', 'minutes', 'hours', 'days']
  if (!validUnits.includes(unit)) {
    throw new Error(`unit inválido: "${unit}" — válidos: ${validUnits.join(', ')}`)
  }

  const now = new Date()

  switch (unit) {
    case 'seconds': now.setSeconds(now.getSeconds() + duration); break
    case 'minutes': now.setMinutes(now.getMinutes() + duration); break
    case 'hours':   now.setHours(now.getHours()     + duration); break
    case 'days':    now.setDate(now.getDate()        + duration); break
  }

  return now
}

// ---------------------------------------------------------------------------
// Ajustar para próximo horário comercial
// Horário comercial: segunda a sexta, 9h às 18h (hora local do servidor)
// ---------------------------------------------------------------------------

function adjustToBusinessHours(date) {
  const result = new Date(date)
  const hour = result.getHours()
  const day  = result.getDay() // 0 = domingo, 6 = sábado

  if (day === 0) {
    // Domingo → segunda 9h
    result.setDate(result.getDate() + 1)
    result.setHours(9, 0, 0, 0)
  } else if (day === 6) {
    // Sábado → segunda 9h
    result.setDate(result.getDate() + 2)
    result.setHours(9, 0, 0, 0)
  } else if (hour < 9) {
    // Antes do expediente → 9h do mesmo dia
    result.setHours(9, 0, 0, 0)
  } else if (hour >= 18) {
    // Após expediente → próximo dia útil 9h
    result.setDate(result.getDate() + 1)
    result.setHours(9, 0, 0, 0)
    const nextDay = result.getDay()
    if (nextDay === 6) result.setDate(result.getDate() + 2) // sábado → segunda
    if (nextDay === 0) result.setDate(result.getDate() + 1) // domingo → segunda
  }

  return result
}

// ---------------------------------------------------------------------------
// Pausar execução no nó delay
// ---------------------------------------------------------------------------

export async function pauseAtDelay(node, context, supabase) {
  // Aceitar config em node.data.config ou diretamente em node.data (legado)
  const config = node.data?.config || node.data || {}

  let resumeAt

  try {
    resumeAt = calculateResumeAt(config)
  } catch (configErr) {
    console.warn(`[delayHandler] config inválida no nó ${node.id}: ${configErr.message} — skipped`)
    return { skipped: true, reason: `delay inválido: ${configErr.message}` }
  }

  if (config.businessHoursOnly) {
    resumeAt = adjustToBusinessHours(resumeAt)
    console.log(`[delayHandler] businessHoursOnly ativo → ajustado para: ${resumeAt.toISOString()}`)
  }

  const resumeAtIso = resumeAt.toISOString()

  console.log(`[delayHandler] pausando execução ${context.executionId} até ${resumeAtIso}`)

  // 1. Pausar a execução
  const { error: execError } = await supabase
    .from('automation_executions')
    .update({
      status:          'paused',
      paused_at:       new Date().toISOString(),
      resume_at:       resumeAtIso,
      current_node_id: node.id,
    })
    .eq('id', context.executionId)

  if (execError) {
    throw new Error(`Erro ao pausar execução: ${execError.message}`)
  }

  // 2. Criar schedule para retomada
  // entity_type = 'delay_resume' identifica o tipo de retomada
  // entity_id   = node.id — cron usará para calcular o próximo nó
  // trigger_data preserva a config original para debugging
  const { data: schedule, error: schedError } = await supabase
    .from('automation_schedules')
    .insert({
      execution_id:  context.executionId,
      flow_id:       context.flowId,
      company_id:    context.companyId,
      scheduled_for: resumeAtIso,
      status:        'pending',
      entity_type:   'delay_resume',
      entity_id:     node.id,
      trigger_data:  {
        delay_config: {
          duration:          config.duration        || null,
          unit:              config.unit            || null,
          targetDateTime:    config.targetDateTime  || null,
          businessHoursOnly: config.businessHoursOnly || false,
        },
      },
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (schedError) {
    // Tentar reverter o pause na execução para não deixar presa
    await supabase
      .from('automation_executions')
      .update({ status: 'running', paused_at: null, resume_at: null, current_node_id: null })
      .eq('id', context.executionId)

    throw new Error(`Erro ao criar schedule: ${schedError.message}`)
  }

  console.log(`[delayHandler] schedule criado para ${resumeAtIso} (node: ${node.id}, schedule: ${schedule?.id})`)

  return {
    paused:               true,
    resumeAt:             resumeAtIso,
    scheduleId:           schedule?.id ?? null,
    businessHoursApplied: !!config.businessHoursOnly,
    delay: {
      duration:       config.duration       || null,
      unit:           config.unit           || null,
      targetDateTime: config.targetDateTime || null,
    },
  }
}
