// =====================================================
// DISPATCH OPPORTUNITY TRIGGER
//
// Dispatcher backend para o evento opportunity.stage_changed.
// Chamado por moveOpportunity() e changeFunnel() em crmActions.js
// após confirmação de sucesso da operação CRM.
//
// Segue exatamente o padrão de dispatchLeadCreatedTrigger.js:
//   - supabaseAdmin.js     → cliente com service_role
//   - triggerEvaluator.js  → matching de flows (pura, sem I/O)
//   - executor.js          → criação e execução real
//
// Fail-safe: nunca lança exceção para o caller.
//
// Limitações aceitas nesta entrega:
//   - Deduplicação best effort: race condition TOCTOU entre SELECT e INSERT
//   - Sem outbox transacional (evento pode ser perdido em falha pós-operação)
//   - Execução síncrona (await) pode sofrer timeout em flows longos no Vercel
//   - fromFunnelId não é avaliado pelo matcher atual (rastreabilidade futura)
//   - Filtros minValue/maxValue funcionam apenas quando opportunityValue é fornecido
//   - Dedup não impede autorrecursão causal (sem sourceFlowId/sourceExecutionId)
// =====================================================

import { getSupabaseAdmin }                    from './supabaseAdmin.js'
import { matchesTriggerConditions }             from './triggerEvaluator.js'
import { createExecution, processFlowAsync }    from './executor.js'

const DEDUP_WINDOW_MS = 60 * 1000  // 60 segundos — mesma janela do trigger-event.ts

/**
 * Dispara automações para o evento opportunity.stage_changed diretamente no servidor.
 *
 * Deve ser chamado apenas após confirmação de sucesso da operação CRM.
 * Nunca deve ser chamado após falha parcial.
 *
 * @param {object}      params
 * @param {string}      params.companyId         UUID da empresa (obrigatório)
 * @param {string}      params.opportunityId      UUID da oportunidade (obrigatório)
 * @param {number|null} [params.leadId]           ID numérico do lead (best effort; pode ser null)
 * @param {string|null} [params.oldStageId]       UUID da etapa anterior (null = sem posição anterior, ex: cross-funnel)
 * @param {string}      params.newStageId         UUID da etapa de destino
 * @param {string|null} [params.funnelId]         UUID do funil de destino
 * @param {string|null} [params.fromFunnelId]     UUID do funil de origem (rastreabilidade; não avaliado pelo matcher)
 * @param {number|null} [params.opportunityValue] Valor da oportunidade (habilita filtros minValue/maxValue do matcher)
 * @param {object}      [supabaseOverride]        Cliente Supabase opcional (para testes); usa supabaseAdmin se omitido
 */
export async function dispatchOpportunityStageChangedTrigger(
  {
    companyId,
    opportunityId,
    leadId,
    oldStageId,
    newStageId,
    funnelId,
    fromFunnelId,
    opportunityValue,
  },
  supabaseOverride
) {
  const tag = `[dispatchOpportunityTrigger][company:${companyId}][opp:${opportunityId}]`

  // 1. Validar parâmetros obrigatórios
  if (!companyId || !opportunityId) {
    console.warn(`${tag} parâmetros inválidos — companyId e opportunityId são obrigatórios`)
    return
  }

  // 2. Guard: evitar disparo quando não houve mudança real de etapa.
  //    Usa comparação estrita (!=) para preservar null como válido (cross-funnel sem posição anterior).
  if (
    oldStageId != null &&
    newStageId != null &&
    oldStageId === newStageId
  ) {
    return
  }

  const supabase = supabaseOverride ?? getSupabaseAdmin()

  try {
    // 3. Buscar flows ativos da empresa
    const { data: flows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, name, nodes, edges, trigger_operator, is_over_plan')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (flowsErr) {
      console.error(`${tag} erro ao buscar flows:`, flowsErr.message)
      return
    }

    if (!flows || flows.length === 0) return

    // 4. Montar evento — referência: formato completo do FunnelBoard.tsx
    const opportunityCtx = { funnel_id: funnelId ?? null }
    if (opportunityValue != null) {
      opportunityCtx.value = opportunityValue
    }

    const event = {
      type: 'opportunity.stage_changed',
      data: {
        opportunity_id:  opportunityId,
        old_stage:       oldStageId     ?? null,
        new_stage:       newStageId,
        opportunity:     opportunityCtx,
        lead_id:         leadId         ?? null,
        conversation_id: null,
        from_funnel_id:  fromFunnelId   ?? null,
      },
    }

    // 5. Filtrar flows compatíveis (matchesTriggerConditions é pura, sem I/O)
    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    if (matchedFlows.length === 0) return

    // 6. Para cada flow compatível: enforcar plano, deduplicar, criar execução e processar
    for (const flow of matchedFlows) {
      // Enforcement de plano: flow acima do limite não executa
      if (flow.is_over_plan === true) {
        console.warn(`${tag} flow=${flow.id} is_over_plan=true — ignorado (plano excedido)`)
        continue
      }

      try {
        // Deduplicação por company_id + flow_id + opportunity_id (não por lead_id)
        const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
        const { data: existing } = await supabase
          .from('automation_executions')
          .select('id')
          .eq('company_id', companyId)
          .eq('flow_id', flow.id)
          .eq('opportunity_id', opportunityId)
          .gte('started_at', since)
          .limit(1)
          .maybeSingle()

        if (existing) {
          console.warn(`${tag} flow=${flow.id} ignorado — dedup na janela de ${DEDUP_WINDOW_MS / 1000}s`)
          continue
        }

        // Criar execução — createExecution já verifica is_over_plan e limite mensal internamente
        const execution = await createExecution(flow, event.data, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado`)

        // Processar flow de forma síncrona (padrão atual do sistema)
        await processFlowAsync(flow, execution, supabase)

      } catch (flowErr) {
        // Erro em um flow não impede os demais
        console.error(`${tag} flow=${flow.id} — erro ao processar:`, flowErr?.message)
      }
    }

  } catch (err) {
    // Fail-safe: nunca quebra o caller (moveOpportunity / changeFunnel)
    console.error(`${tag} erro inesperado:`, err?.message)
  }
}
