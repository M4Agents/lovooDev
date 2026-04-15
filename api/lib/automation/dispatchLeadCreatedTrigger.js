// =====================================================
// DISPATCH LEAD CREATED TRIGGER
//
// Dispatcher backend compartilhado para o evento lead.created.
// Usado por endpoints que não têm JWT de usuário (api_key, webhooks).
//
// Reutiliza a mesma infraestrutura do trigger-event.ts:
//   - supabaseAdmin.js  → cliente com service_role
//   - triggerEvaluator.js → matching de flows
//   - executor.js       → criação e execução real
//
// Fail-safe: nunca lança exceção para o caller.
// =====================================================

import { getSupabaseAdmin }         from './supabaseAdmin.js'
import { matchesTriggerConditions }  from './triggerEvaluator.js'
import { createExecution, processFlowAsync } from './executor.js'

const DEDUP_WINDOW_MS = 60 * 1000  // 60 segundos — mesma janela do trigger-event.ts

/**
 * Dispara automações para o evento lead.created diretamente no servidor.
 *
 * @param {object} params
 * @param {string} params.companyId  - UUID da empresa
 * @param {number} params.leadId     - ID numérico do lead recém-criado
 * @param {string} [params.source]   - Origem: 'api' | 'webhook' | 'whatsapp' | 'import' | 'manual' | 'chat'
 * @param {object} [supabaseOverride] - Cliente Supabase opcional (para testes); usa supabaseAdmin se omitido
 */
export async function dispatchLeadCreatedTrigger({ companyId, leadId, source = 'api' }, supabaseOverride) {
  const tag = `[dispatchLeadCreatedTrigger][company:${companyId}][lead:${leadId}][source:${source}]`

  // #region agent log
  console.error(`[DBG-3620d6][H2-dispatcher] ENTRY tag=${tag}`)
  // #endregion

  if (!companyId || !leadId) {
    console.warn(`${tag} parâmetros inválidos — companyId e leadId são obrigatórios`)
    return
  }

  const supabase = supabaseOverride ?? getSupabaseAdmin()

  try {
    // 1. Buscar flows ativos da empresa
    const { data: flows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, name, nodes, edges, trigger_operator')
      .eq('company_id', companyId)
      .eq('is_active', true)

    // #region agent log
    console.error(`[DBG-3620d6][H2-dispatcher] flows query concluída flowsCount=${flows?.length ?? 0} err=${flowsErr?.message ?? null}`)
    // #endregion

    if (flowsErr) {
      console.error(`${tag} erro ao buscar flows:`, flowsErr.message)
      return
    }

    if (!flows || flows.length === 0) {
      console.log(`${tag} nenhum flow ativo encontrado`)
      return
    }

    // 2. Montar evento e filtrar flows compatíveis com lead.created
    const event = {
      type: 'lead.created',
      data: { lead_id: leadId, source },
    }

    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    // #region agent log
    console.error(`[DBG-3620d6][H2-dispatcher] matchedFlows=${matchedFlows.length} de ${flows.length} flows avaliados source=${source}`)
    // #endregion

    if (matchedFlows.length === 0) {
      console.log(`${tag} nenhum flow corresponde ao evento — total avaliados: ${flows.length}`)
      return
    }

    console.log(`${tag} ${matchedFlows.length} flow(s) correspondente(s) — iniciando execuções`)

    // 3. Para cada flow compatível: deduplicar, criar execução e processar
    for (const flow of matchedFlows) {
      try {
        // Deduplicação: checar execução recente para o mesmo lead + flow
        const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
        const { data: existing } = await supabase
          .from('automation_executions')
          .select('id')
          .eq('company_id', companyId)
          .eq('flow_id', flow.id)
          .eq('lead_id', leadId)
          .gte('started_at', since)
          .limit(1)
          .maybeSingle()

        if (existing) {
          console.warn(`${tag} flow=${flow.id} ignorado — execução duplicada na janela de ${DEDUP_WINDOW_MS / 1000}s`)
          continue
        }

        // Criar execução real
        const triggerData = { lead_id: leadId, source }
        const execution = await createExecution(flow, triggerData, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado`)

        // Processar flow (fire-and-forget internamente — processFlowAsync já é assíncrono)
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
