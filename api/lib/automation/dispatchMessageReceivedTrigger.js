// =====================================================
// DISPATCH MESSAGE RECEIVED TRIGGER
//
// Dispatcher backend compartilhado para o evento message.received.
// Usado pelos webhooks WhatsApp (Uazapi) que não possuem JWT de usuário.
//
// Reutiliza a mesma infraestrutura do trigger-event.ts:
//   - supabaseAdmin.js  → cliente com service_role
//   - triggerEvaluator.js → matching de flows
//   - executor.js       → criação e execução real
//
// Fail-safe: nunca lança exceção para o caller.
// =====================================================

import { getSupabaseAdmin }                       from './supabaseAdmin.js'
import { matchesTriggerConditions }               from './triggerEvaluator.js'
import { createExecution, processFlowAsync }      from './executor.js'

const DEDUP_WINDOW_MS = 60 * 1000  // 60 s — mesma janela de trigger-event.ts

/**
 * Dispara automações para o evento message.received diretamente no servidor.
 *
 * @param {object} params
 * @param {string}  params.companyId       - UUID da empresa (obrigatório)
 * @param {number}  [params.leadId]        - ID numérico do lead (opcional)
 * @param {string}  [params.conversationId] - UUID da conversa (opcional)
 * @param {string}  [params.instanceId]    - UUID/string da instância WhatsApp (opcional)
 * @param {string}  [params.messageId]     - ID da mensagem salva no banco (opcional)
 * @param {string}  [params.text]          - Texto da mensagem (opcional, uso futuro em filtros)
 * @param {object}  [supabaseOverride]     - Cliente Supabase alternativo (testes)
 */
export async function dispatchMessageReceivedTrigger(
  {
    companyId,
    leadId       = null,
    conversationId = null,
    instanceId   = null,
    messageId    = null,
    text         = null,
    direction    = null,
    from_agent   = null,
    sender_type  = null,
    origin       = null,
    is_from_me   = null,
  },
  supabaseOverride
) {
  const tag = `[dispatchMessageReceivedTrigger][company:${companyId}][lead:${leadId}][conv:${conversationId}]`

  if (!companyId) {
    console.warn(`${tag} companyId é obrigatório — abortando`)
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

    if (flowsErr) {
      console.error(`${tag} erro ao buscar flows:`, flowsErr.message)
      return
    }

    if (!flows || flows.length === 0) {
      console.log(`${tag} nenhum flow ativo encontrado`)
      return
    }

    // 2. Montar evento e filtrar flows compatíveis com message.received
    const event = {
      type: 'message.received',
      data: {
        lead_id:         leadId,
        conversation_id: conversationId,
        instance_id:     instanceId,
        message_id:      messageId,
        text,
        channel:         'whatsapp',
        // Campos de origem — permitem que triggerEvaluator filtre loops
        // independentemente de quem chamar este dispatcher no futuro
        direction,
        from_agent,
        sender_type,
        origin,
        is_from_me,
      },
    }

    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    if (matchedFlows.length === 0) {
      console.log(`${tag} nenhum flow corresponde ao evento — total avaliados: ${flows.length}`)
      return
    }

    console.log(`${tag} ${matchedFlows.length} flow(s) correspondente(s) — iniciando execuções`)

    // 3. Para cada flow compatível: deduplicar, criar execução e processar
    for (const flow of matchedFlows) {
      try {
        // Deduplicação: checar execução recente para o mesmo lead + flow (quando leadId disponível)
        if (leadId) {
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
        }

        // Criar execução real
        const triggerData = {
          lead_id:         leadId,
          conversation_id: conversationId,
          instance_id:     instanceId,
          message_id:      messageId,
          text,
          channel:         'whatsapp',
        }
        const execution = await createExecution(flow, triggerData, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado`)

        // Processar flow (processFlowAsync já é assíncrono internamente)
        await processFlowAsync(flow, execution, supabase)

      } catch (flowErr) {
        console.error(`${tag} flow=${flow.id} — erro ao processar:`, flowErr?.message)
      }
    }

  } catch (err) {
    // Fail-safe: nunca quebra o caller
    console.error(`${tag} erro inesperado:`, err?.message)
  }
}
