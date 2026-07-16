// =====================================================
// DELAY HANDLER — Fase A do nó delay no backend
//
// Responsabilidade: pausar execução em nó delay e criar
// o schedule para retomada posterior via cron.
//
// Campos reais usados:
//   automation_executions:  status, paused_at, resume_at, current_node_id, variables
//   automation_schedules:   scheduled_for, entity_id, entity_type, trigger_data
//
// Formatos de delay suportados:
//   duration + unit (seconds, minutes, hours, days)
//   targetDateTime (ISO string — data/hora fixa)
//   businessHoursOnly (ajusta para próximo horário comercial: seg-sex 9h-18h)
//
// Modos:
//   wait_mode ausente / "time"  → comportamento legado (delay_resume)
//   wait_mode "time_or_response" → aguarda resposta do lead ou timeout (delay_response_timeout)
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
// Modo legado: pausar e criar schedule de retomada por tempo (delay_resume)
// Preserva exatamente o comportamento original — não altere esta função.
// ---------------------------------------------------------------------------

async function pauseAtDelayLegacy(node, config, context, supabase, resumeAt) {
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

// ---------------------------------------------------------------------------
// Modo time_or_response: aguarda resposta do lead OU timeout
//
// Ordem das operações:
//   1. criar schedule (delay_response_timeout)
//   2. pausar execução com marcador _awaiting_delay_response
//   3. rollback do schedule se a pausa falhar
//
// O marcador é salvo junto ao pause para garantir que o banco nunca
// fique em estado paused sem marcador (schedule_id já é conhecido no momento).
//
// Rollback manual documentado:
//   A criação do schedule e a pausa da execução são duas operações
//   distintas sem atomicidade nativa. Se a pausa falhar após o schedule
//   ser criado, o schedule é removido pelo schedule_id + company_id
//   para não deixar um schedule órfão. Não usamos transação porque o
//   projeto não tem RPC transacional reutilizável para schedule + pause.
// ---------------------------------------------------------------------------

async function pauseAtDelayTimeOrResponse(node, config, context, supabase, expiresAt) {
  // Referência de tempo única — evita divergências entre started_at e scheduled_for
  const startedAt    = new Date()
  const expiresAtIso = expiresAt.toISOString()
  const startedAtIso = startedAt.toISOString()

  // response_variable: string configurada pelo editor ou null
  const responseVariable = (typeof config.response_variable === 'string' && config.response_variable.trim())
    ? config.response_variable.trim()
    : null

  // -------------------------------------------------------------------------
  // Passo 1: criar schedule
  // entity_type = 'delay_response_timeout' — identificado pelo cron e claim
  // entity_id   = node.id — validado pela claim RPC contra marker.node_id
  // scheduled_for = expires_at — instante do timeout
  // -------------------------------------------------------------------------
  const { data: schedule, error: schedError } = await supabase
    .from('automation_schedules')
    .insert({
      execution_id:  context.executionId,
      flow_id:       context.flowId,
      company_id:    context.companyId,
      scheduled_for: expiresAtIso,
      status:        'pending',
      entity_type:   'delay_response_timeout',
      entity_id:     node.id,
      trigger_data:  {
        delay_config: {
          duration:          config.duration        || null,
          unit:              config.unit            || null,
          targetDateTime:    config.targetDateTime  || null,
          businessHoursOnly: config.businessHoursOnly || false,
        },
      },
      created_at: startedAtIso,
    })
    .select('id')
    .single()

  if (schedError) {
    // Schedule não criado — não pausar, não gravar marcador
    console.error(
      `[delayHandler] falha ao criar schedule delay_response_timeout` +
      ` (company: ${context.companyId}, execution: ${context.executionId}, node: ${node.id}):` +
      ` ${schedError.message}`
    )
    throw new Error(`Erro ao criar schedule delay_response_timeout: ${schedError.message}`)
  }

  const scheduleId = schedule.id

  console.log(
    `[delayHandler] schedule delay_response_timeout criado` +
    ` (company: ${context.companyId}, execution: ${context.executionId},` +
    ` node: ${node.id}, schedule: ${scheduleId}, expires: ${expiresAtIso})`
  )

  // -------------------------------------------------------------------------
  // Passo 2: pausar execução com marcador _awaiting_delay_response
  //
  // Cópia imutável das variables — preserva todas as variáveis existentes.
  // _awaiting_delay_response é um marcador interno persistido no banco.
  // Contém schedule_id para que o claim RPC possa validar a corrida corretamente.
  // -------------------------------------------------------------------------
  const nextVariables = {
    ...(context.variables || {}),
    _awaiting_delay_response: {
      node_id:           node.id,
      schedule_id:       scheduleId,
      started_at:        startedAtIso,
      expires_at:        expiresAtIso,
      response_variable: responseVariable,
    },
  }

  const { error: pauseError } = await supabase
    .from('automation_executions')
    .update({
      status:          'paused',
      paused_at:       startedAtIso,
      resume_at:       expiresAtIso,
      current_node_id: node.id,
      variables:       nextVariables,
    })
    .eq('id', context.executionId)

  if (pauseError) {
    // -------------------------------------------------------------------------
    // Rollback do schedule — filtro por id + company_id evita remover
    // schedules de outras execuções por engano
    // -------------------------------------------------------------------------
    console.error(
      `[delayHandler] falha ao pausar execução` +
      ` (company: ${context.companyId}, execution: ${context.executionId}, node: ${node.id}):` +
      ` ${pauseError.message} — tentando rollback do schedule ${scheduleId}`
    )

    const { error: rollbackError } = await supabase
      .from('automation_schedules')
      .delete()
      .eq('id', scheduleId)
      .eq('company_id', context.companyId)

    if (rollbackError) {
      console.error(
        `[delayHandler] falha no rollback do schedule ${scheduleId}` +
        ` (company: ${context.companyId}): ${rollbackError.message}` +
        ` — schedule órfão pode existir no banco`
      )
    } else {
      console.log(`[delayHandler] rollback do schedule ${scheduleId} concluído`)
    }

    // Propagar o erro original da pausa — não esconder falhas
    throw new Error(`Erro ao pausar execução (delay_response_timeout): ${pauseError.message}`)
  }

  console.log(
    `[delayHandler] execução ${context.executionId} pausada aguardando resposta do lead` +
    ` (node: ${node.id}, schedule: ${scheduleId}, expires: ${expiresAtIso})`
  )

  return {
    paused:               true,
    resumeAt:             expiresAtIso,
    scheduleId,
    businessHoursApplied: !!config.businessHoursOnly,
    delay: {
      duration:       config.duration       || null,
      unit:           config.unit           || null,
      targetDateTime: config.targetDateTime || null,
    },
  }
}

// ---------------------------------------------------------------------------
// Pausar execução no nó delay — ponto de entrada principal
// ---------------------------------------------------------------------------

export async function pauseAtDelay(node, context, supabase) {
  // Aceitar config em node.data.config ou diretamente em node.data (legado)
  const config = node.data?.config || node.data || {}

  const waitMode = config.wait_mode || 'time'

  // -------------------------------------------------------------------------
  // Modo time_or_response: calcula timeout, depois delega
  // -------------------------------------------------------------------------
  if (waitMode === 'time_or_response') {
    let expiresAt

    try {
      expiresAt = calculateResumeAt(config)
    } catch (configErr) {
      console.warn(`[delayHandler] config inválida no nó ${node.id} (time_or_response): ${configErr.message} — skipped`)
      return { skipped: true, reason: `delay inválido: ${configErr.message}` }
    }

    if (config.businessHoursOnly) {
      expiresAt = adjustToBusinessHours(expiresAt)
      console.log(`[delayHandler] businessHoursOnly ativo (time_or_response) → ajustado para: ${expiresAt.toISOString()}`)
    }

    return pauseAtDelayTimeOrResponse(node, config, context, supabase, expiresAt)
  }

  // -------------------------------------------------------------------------
  // Modo legado (wait_mode ausente ou "time"):
  // Preserva exatamente o comportamento original.
  // -------------------------------------------------------------------------
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

  return pauseAtDelayLegacy(node, config, context, supabase, resumeAt)
}
