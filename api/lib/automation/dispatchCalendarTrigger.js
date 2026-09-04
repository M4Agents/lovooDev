// =====================================================
// DISPATCH CALENDAR TRIGGER
//
// Dispatcher backend para eventos de calendário.
// Compartilha a mesma infraestrutura do motor de automação:
//   - supabaseAdmin.js       → cliente com service_role
//   - triggerEvaluator.js   → matching de flows
//   - executor.js            → criação e execução real
//
// Fail-safe: NUNCA lança exceção para o caller.
// Uma falha aqui não pode desfazer a atividade criada
// nem alterar a resposta HTTP ao frontend.
// =====================================================

import { getSupabaseAdmin }                                      from './supabaseAdmin.js'
import { matchesTriggerConditions, matchesCalendarActivity }    from './triggerEvaluator.js'
import { createExecution, processFlowAsync }                    from './executor.js'

// Janela de deduplicação: 60 segundos (mesma janela usada pelos demais dispatchers)
const DEDUP_WINDOW_MS = 60 * 1000

/**
 * Dispara automações para eventos de calendário diretamente no servidor.
 *
 * @param {string} triggerType     - Tipo do evento: 'calendar.activity_created' | 'calendar.activity_completed' | ...
 * @param {object} activity        - Snapshot da atividade APÓS a alteração
 * @param {string} companyId       - UUID da empresa — OBRIGATÓRIO e EXPLÍCITO
 * @param {object} [eventMetadata] - Metadados opcionais do evento (ex: previous_scheduled_date, previous_assigned_to)
 *                                   Adicionados ao triggerData.event_metadata. Não usado para autorização.
 *                                   Backward-compatible: callers da Fase 2 não passam este parâmetro.
 * @param {object} [supabaseOverride] - Cliente Supabase opcional (para testes); usa supabaseAdmin se omitido
 */
export async function dispatchCalendarTrigger(triggerType, activity, companyId, eventMetadata, supabaseOverride) {
  const tag = `[dispatchCalendarTrigger][type:${triggerType}][company:${companyId}][activity:${activity?.id}]`

  // ── Validação de parâmetros obrigatórios ─────────────────────────────────
  if (!companyId) {
    console.warn(`${tag} companyId é obrigatório — dispatcher abortado`)
    return
  }

  if (!triggerType) {
    console.warn(`${tag} triggerType é obrigatório — dispatcher abortado`)
    return
  }

  if (!activity?.id) {
    console.warn(`${tag} activity.id é obrigatório — dispatcher abortado`)
    return
  }

  // ── Validação defensiva de multi-tenant ──────────────────────────────────
  // Nunca inferir tenant apenas por activity.company_id.
  // companyId deve ter sido validado pelo endpoint antes de chegar aqui.
  if (activity.company_id !== companyId) {
    console.error(`${tag} DIVERGÊNCIA DE COMPANY — activity.company_id=${activity.company_id} ≠ companyId=${companyId} — dispatcher abortado por segurança`)
    return
  }

  // Suporte backward-compatible: se eventMetadata for um cliente Supabase (chamadores legados
  // que passavam supabaseOverride como 4º arg), tratar como supabaseOverride
  // Heurística: objeto com método 'from' é um cliente Supabase
  let resolvedMetadata = eventMetadata
  let resolvedSupabase = supabaseOverride
  if (eventMetadata && typeof eventMetadata === 'object' && typeof eventMetadata.from === 'function') {
    resolvedMetadata = null
    resolvedSupabase = eventMetadata
  }

  const supabase = resolvedSupabase ?? getSupabaseAdmin()

  try {
    // ── Buscar flows ativos da empresa ────────────────────────────────────
    // Não buscar globalmente — filtrar sempre por company_id.
    const { data: flows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, name, nodes, edges, trigger_operator, is_over_plan')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (flowsErr) {
      console.error(`${tag} erro ao buscar flows:`, flowsErr.message)
      return
    }

    if (!flows || flows.length === 0) {
      console.log(`${tag} nenhum flow ativo encontrado para a empresa`)
      return
    }

    // ── Montar evento e filtrar flows compatíveis ─────────────────────────
    const event = {
      type: triggerType,
      data: {
        activity_id: activity.id,
        lead_id:     activity.lead_id,
        activity,
      },
    }

    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    if (matchedFlows.length === 0) {
      console.log(`${tag} nenhum flow corresponde ao evento — total avaliados: ${flows.length}`)
      return
    }

    console.log(`${tag} ${matchedFlows.length} flow(s) correspondente(s) — iniciando execuções`)

    // ── Montar triggerData ────────────────────────────────────────────────
    // Snapshot da atividade APÓS a alteração.
    // IMPORTANTE: este snapshot é CONTEXTO, não autorização.
    // Ações que modificam a atividade devem recarregar do banco por id + company_id.
    const triggerData = {
      activity_id: activity.id,
      lead_id:     activity.lead_id ?? null,

      // Snapshot completo da atividade (estado APÓS a operação)
      activity: {
        id:                 activity.id,
        company_id:         activity.company_id,
        lead_id:            activity.lead_id,
        title:              activity.title,
        activity_type:      activity.activity_type,
        priority:           activity.priority,
        assigned_to:        activity.assigned_to,
        owner_user_id:      activity.owner_user_id,
        scheduled_date:     activity.scheduled_date,
        scheduled_time:     activity.scheduled_time,
        scheduled_datetime: activity.scheduled_datetime,
        status:             activity.status,
        reminder_minutes:   activity.reminder_minutes,
        duration_minutes:   activity.duration_minutes,
      },

      // Variáveis disponíveis para uso em nós do flow (ex: mensagens com substituição)
      variables: {
        'atividade.titulo':         activity.title          || '',
        'atividade.tipo':           activity.activity_type  || '',
        'atividade.data':           activity.scheduled_date || '',
        'atividade.hora':           activity.scheduled_time || '',
        'atividade.prioridade':     activity.priority       || '',
        'atividade.responsavel_id': activity.assigned_to    || '',
      },

      // Metadados do evento (opcional) — contexto adicional sobre a transição.
      // Exemplos: previous_scheduled_date, previous_assigned_to, previous_status.
      // NUNCA usar para autorização — apenas contexto informativo.
      ...(resolvedMetadata && typeof resolvedMetadata === 'object'
        ? { event_metadata: resolvedMetadata }
        : {}),
    }

    // ── Para cada flow compatível: deduplicar, criar execução e processar ─
    for (const flow of matchedFlows) {
      // Enforcement de plano: flow acima do limite não executa
      if (flow.is_over_plan === true) {
        console.warn(`${tag} flow=${flow.id} is_over_plan=true — ignorado (plano excedido)`)
        continue
      }

      try {
        // Deduplicação por janela de tempo: mesmo activity_id + flow_id
        // Evita execução duplicada em caso de retry ou race condition.
        const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
        const { data: existing } = await supabase
          .from('automation_executions')
          .select('id')
          .eq('company_id', companyId)
          .eq('flow_id', flow.id)
          .filter('trigger_data->>activity_id', 'eq', activity.id)
          .gte('started_at', since)
          .limit(1)
          .maybeSingle()

        if (existing) {
          console.warn(`${tag} flow=${flow.id} ignorado — execução duplicada na janela de ${DEDUP_WINDOW_MS / 1000}s`)
          continue
        }

        // Criar execução com contexto enriquecido
        const execution = await createExecution(flow, triggerData, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado`)

        // Processar flow (fire-and-forget internamente)
        await processFlowAsync(flow, execution, supabase)

      } catch (flowErr) {
        // Erro em um flow não impede os demais
        console.error(`${tag} flow=${flow.id} — erro ao processar:`, flowErr?.message)
      }
    }

  } catch (err) {
    // Fail-safe: nunca quebra o caller
    console.error(`${tag} erro inesperado:`, err?.message)
  }
}

// =============================================================================
// claimAndDispatchTemporalTrigger
//
// Função exclusiva para o cron process-calendar-triggers.
//
// Diferenças em relação ao dispatchCalendarTrigger:
//   1. Recebe um flow JÁ resolvido (sem re-query de flows por empresa).
//      Evita o padrão N×M (activity × busca de flows) do cron.
//   2. Dedup via calendar_automation_trigger_log (INSERT atômico com UNIQUE).
//      Não usa a janela de 60s de automation_executions.
//   3. occurrence_key determinística baseada em scheduled_datetime real.
//      Um reagendamento altera scheduled_datetime → nova occurrence_key → nova execução.
//
// Ciclo de vida do claim:
//   1. Tentativa atômica de INSERT em calendar_automation_trigger_log
//      via upsert com ignoreDuplicates=true.
//   2. Se UNIQUE conflict → outra instância ganhou → 'skipped'.
//   3. Se INSERT venceu → este processo é responsável → cria execução.
//   4. execution_id é preenchido na tabela de log após createExecution (best-effort).
//   5. Em caso de erro após o claim: o registro PERMANECE no log.
//      NÃO é apagado automaticamente para evitar re-entradas em loop.
//
// @param {object}  params
// @param {string}  params.triggerType    - 'calendar.activity_due_soon' | 'calendar.activity_overdue'
// @param {object}  params.activity       - Snapshot completo da atividade
// @param {object}  params.flow           - Flow já resolvido (id, nodes, is_over_plan, company_id)
// @param {string}  params.companyId      - UUID da empresa — obrigatório e explícito
// @param {string}  params.occurrenceKey  - Chave determinística (gerada pelo cron)
//                                          Formato: "due_soon:{minutes}:{scheduled_datetime_iso_utc}"
//                                                   "overdue:{minutes}:{scheduled_datetime_iso_utc}"
// @param {object}  params.triggerConfig  - Config do trigger no nó start (minutes_before|minutes_after,
//                                          activity_type, priority etc.)
// @param {object}  [params.supabase]     - Cliente opcional (padrão: supabaseAdmin)
// @returns {Promise<'dispatched'|'skipped'|'error'>}
// =============================================================================
export async function claimAndDispatchTemporalTrigger({
  triggerType,
  activity,
  flow,
  companyId,
  occurrenceKey,
  triggerConfig,
  supabase: supabaseOverride,
}) {
  const tag = `[claimTemporal][type:${triggerType}][flow:${flow?.id}][activity:${activity?.id}]`

  // ── Validações defensivas ─────────────────────────────────────────────────
  if (!companyId || !triggerType || !activity?.id || !flow?.id || !occurrenceKey) {
    console.warn(`${tag} parâmetros inválidos — skip`)
    return 'skipped'
  }

  if (activity.company_id !== companyId) {
    console.error(`${tag} divergência de company — activity.company_id=${activity.company_id} ≠ companyId=${companyId} — abort`)
    return 'error'
  }

  if (flow.is_over_plan === true) {
    console.warn(`${tag} flow is_over_plan=true — skip (plano excedido)`)
    return 'skipped'
  }

  // ── Verificar filtros de activity_type/priority do trigger ────────────────
  // matchesCalendarActivity aplica os filtros configurados no trigger (tipo e prioridade).
  // A elegibilidade temporal (janela de tempo) já foi verificada pelo cron antes de chamar esta função.
  const passesFilter = matchesCalendarActivity(
    { config: triggerConfig || {} },
    { activity },
  )
  if (!passesFilter) {
    console.log(`${tag} atividade não corresponde aos filtros do trigger — skip`)
    return 'skipped'
  }

  const supabase = supabaseOverride ?? getSupabaseAdmin()

  // ── Claim atômico via upsert com ignoreDuplicates ─────────────────────────
  // supabase-js v2: upsert + ignoreDuplicates:true implementa INSERT ... ON CONFLICT DO NOTHING.
  // Se a UNIQUE constraint (company_id, activity_id, flow_id, trigger_type, occurrence_key)
  // já existir: ignoreDuplicates=true faz o INSERT ser ignorado silenciosamente
  // e .select() retorna null → este processo não ganhou o claim → 'skipped'.
  // Se o INSERT vencer: .select() retorna o registro inserido → este processo processa.
  const { data: claimed } = await supabase
    .from('calendar_automation_trigger_log')
    .upsert(
      {
        company_id:     companyId,
        activity_id:    activity.id,
        flow_id:        flow.id,
        trigger_type:   triggerType,
        occurrence_key: occurrenceKey,
      },
      {
        onConflict:      'company_id,activity_id,flow_id,trigger_type,occurrence_key',
        ignoreDuplicates: true,
      },
    )
    .select('id')
    .maybeSingle()

  if (!claimed?.id) {
    console.log(`${tag} ocorrência já processada (UNIQUE conflict) — skip`)
    return 'skipped'
  }

  const logId = claimed.id
  console.log(`${tag} claim vencido logId=${logId} — iniciando execução`)

  // ── Montar triggerData ────────────────────────────────────────────────────
  const triggerData = {
    activity_id: activity.id,
    lead_id:     activity.lead_id ?? null,

    // Snapshot da atividade no momento do evento temporal
    activity: {
      id:                 activity.id,
      company_id:         activity.company_id,
      lead_id:            activity.lead_id,
      title:              activity.title,
      activity_type:      activity.activity_type,
      priority:           activity.priority,
      assigned_to:        activity.assigned_to,
      owner_user_id:      activity.owner_user_id,
      scheduled_date:     activity.scheduled_date,
      scheduled_time:     activity.scheduled_time,
      scheduled_datetime: activity.scheduled_datetime,
      status:             activity.status,
      reminder_minutes:   activity.reminder_minutes,
      duration_minutes:   activity.duration_minutes,
    },

    // Variáveis para interpolação em nós do flow
    variables: {
      'atividade.titulo':         activity.title          || '',
      'atividade.tipo':           activity.activity_type  || '',
      'atividade.data':           activity.scheduled_date?.toString() || '',
      'atividade.hora':           activity.scheduled_time?.toString() || '',
      'atividade.prioridade':     activity.priority       || '',
      'atividade.responsavel_id': activity.assigned_to    || '',
    },

    // Contexto do trigger temporal — não usar para autorização
    temporal_trigger: {
      trigger_type:   triggerType,
      occurrence_key: occurrenceKey,
      ...triggerConfig,
    },
  }

  try {
    // ── Criar execução ────────────────────────────────────────────────────
    const execution = await createExecution(flow, triggerData, companyId, supabase)

    if (!execution) {
      console.error(`${tag} createExecution retornou null — falha após claim`)
      // Claim permanece no log (evita re-tentativas em loop)
      return 'error'
    }

    // ── Associar execution_id ao claim (best-effort) ──────────────────────
    // Não lança exceção se falhar — o claim e a execução já estão garantidos.
    await supabase
      .from('calendar_automation_trigger_log')
      .update({ execution_id: execution.id })
      .eq('id', logId)
      .eq('company_id', companyId)
      .then(({ error }) => {
        if (error) console.warn(`${tag} falha ao atualizar execution_id no log:`, error.message)
      })

    console.log(`${tag} execution=${execution.id} — processando flow`)

    // ── Processar flow (await conforme padrão da Fase 2+) ─────────────────
    await processFlowAsync(flow, execution, supabase)

    return 'dispatched'

  } catch (err) {
    console.error(`${tag} erro após claim — execução falhou:`, err?.message)
    // Claim permanece no log para evitar loops de re-tentativa.
    // Em caso de falha sistêmica recorrente, investigar via calendar_automation_trigger_log.
    return 'error'
  }
}
