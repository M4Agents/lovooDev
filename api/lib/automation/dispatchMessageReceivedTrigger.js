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

/**
 * CONTRATO DE eventData — message.received
 * =========================================
 *
 * Este é o formato padrão que TODOS os dispatchers de mensagem DEVEM
 * seguir ao chamar esta função ou ao disparar o evento message.received.
 * O triggerEvaluator.js depende desses campos para filtrar mensagens e
 * evitar loops. Novas integrações (Cloud API, webchat, etc.) devem
 * respeitar este contrato.
 *
 * Campos de identificação (obrigatórios):
 *   @param {string}  companyId       - UUID da empresa (multi-tenant)
 *
 * Campos de contexto (recomendados):
 *   @param {string}  leadId          - ID do lead relacionado à mensagem
 *   @param {string}  conversationId  - UUID da conversa no banco
 *   @param {string}  instanceId      - ID da instância (ex: número WhatsApp)
 *   @param {string}  messageId       - ID único da mensagem salva
 *   @param {string}  text            - Conteúdo textual da mensagem
 *
 * Campos de origem (obrigatórios para proteção anti-loop):
 *   @param {'inbound'|'outbound'} direction
 *     - 'inbound'  → mensagem veio do lead
 *     - 'outbound' → mensagem foi enviada pela plataforma ou agente
 *
 *   @param {boolean} from_agent
 *     - true  → mensagem gerada pelo agente de IA
 *     - false → mensagem enviada pelo lead ou operador humano
 *
 *   @param {'lead'|'agent'|'system'} sender_type
 *     - 'lead'   → remetente é o lead/contato externo
 *     - 'agent'  → remetente é o agente de IA
 *     - 'system' → mensagem gerada internamente pelo sistema
 *
 *   @param {string} origin
 *     - Canal/origem da mensagem (ex: 'whatsapp', 'webchat', 'api', 'system')
 *
 *   @param {boolean} is_from_me
 *     - true  → mensagem enviada pela própria plataforma (outbound)
 *     - false → mensagem recebida externamente (inbound)
 *
 *   @param {string|null} entry_point_source
 *     - 'click_to_chat_link' → mensagem originada via link click-to-chat
 *     - null                 → mensagem normal ou integração sem suporte ao campo
 *     Versões antigas da Uazapi não enviam contextInfo; null é o valor seguro.
 *
 * Comportamento do triggerEvaluator com esses campos:
 *   - Se direction === 'outbound'   → automação NÃO dispara
 *   - Se from_agent === true        → automação NÃO dispara
 *   - Se sender_type === 'agent'    → automação NÃO dispara
 *   - Se sender_type === 'system'   → automação NÃO dispara
 *   - Se origin === 'system'        → automação NÃO dispara
 *   - Se is_from_me === true        → automação NÃO dispara
 *
 * Referência de tipos TypeScript: src/types/automation.ts → MessageReceivedEventData
 */

import { getSupabaseAdmin }                       from './supabaseAdmin.js'
import { matchesTriggerConditions }               from './triggerEvaluator.js'
import { createExecution, processFlowAsync }      from './executor.js'

const DEDUP_WINDOW_MS = 60 * 1000  // 60 s — mesma janela de trigger-event.ts

/**
 * Dispara automações para o evento message.received diretamente no servidor.
 *
 * @param {object} params
 * @param {string}  params.companyId        - UUID da empresa (obrigatório)
 * @param {number}  [params.leadId]         - ID numérico do lead (opcional; null para Instagram)
 * @param {string}  [params.conversationId] - UUID da conversa (opcional)
 * @param {string}  [params.instanceId]     - UUID/string da instância WhatsApp (opcional)
 * @param {string}  [params.connectionId]   - UUID da conexão Instagram (opcional)
 * @param {string}  [params.messageId]      - ID da mensagem salva no banco (opcional)
 * @param {string}  [params.igMessageId]    - ig_message_id da Meta — chave de idempotência (Instagram)
 * @param {string}  [params.channel]        - 'whatsapp' | 'instagram' (default: 'whatsapp')
 * @param {string}  [params.text]           - Texto da mensagem (opcional)
 * @param {object}  [supabaseOverride]      - Cliente Supabase alternativo (testes)
 *
 * @returns {Promise<DispatchResult>} Resultado estruturado. Nunca lança exceção para o caller.
 *   { matchedFlows, createdExecutions, existingExecutions, skippedFlows, failedFlows, errors }
 */
export async function dispatchMessageReceivedTrigger(
  {
    companyId,
    leadId             = null,
    conversationId     = null,
    instanceId         = null,
    connectionId       = null,  // UUID da conexão Instagram
    messageId          = null,
    igMessageId        = null,  // ig_message_id da Meta — chave de idempotência
    channel            = 'whatsapp',  // default retrocompatível: ausente = WhatsApp
    text               = null,
    direction          = null,
    from_agent         = null,
    sender_type        = null,
    origin             = null,
    is_from_me         = null,
    // Fonte de origem da mensagem (ex: 'click_to_chat_link').
    // null quando o campo não existe no payload — versões antigas da Uazapi
    // ou integrações que não suportam esse metadata.
    entry_point_source = null,
  },
  supabaseOverride
) {
  const tag = `[dispatchMessageReceivedTrigger][company:${companyId}][channel:${channel}][lead:${leadId}][conv:${conversationId}]`

  if (!companyId) {
    console.warn(`${tag} companyId é obrigatório — abortando`)
    return { matchedFlows: 0, createdExecutions: 0, existingExecutions: 0, skippedFlows: 0, failedFlows: 0, errors: [] }
  }

  const supabase = supabaseOverride ?? getSupabaseAdmin()

  // Resultado agregado — retornado ao caller (cron) para auditoria
  const dispatchResult = {
    matchedFlows:      0,
    createdExecutions: 0,
    existingExecutions:0,
    skippedFlows:      0,
    failedFlows:       0,
    errors:            [],
  }

  try {
    // 1. Buscar flows ativos da empresa (is_over_plan incluso para enforcement de plano)
    const { data: flows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, name, nodes, edges, trigger_operator, is_over_plan')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (flowsErr) {
      console.error(`${tag} erro ao buscar flows:`, flowsErr.message)
      return dispatchResult
    }

    if (!flows || flows.length === 0) {
      console.log(`${tag} nenhum flow ativo encontrado`)
      return dispatchResult
    }

    // 2. Montar evento e filtrar flows compatíveis com message.received
    const event = {
      type: 'message.received',
      data: {
        lead_id:             leadId,
        conversation_id:     conversationId,
        instance_id:         instanceId ?? connectionId,  // WhatsApp usa instanceId, Instagram usa connectionId
        connection_id:       connectionId,
        message_id:          messageId,
        ig_message_id:       igMessageId,
        text,
        channel,             // paramétrico — 'whatsapp' | 'instagram'
        // Campos de origem — permitem que triggerEvaluator filtre loops
        direction,
        from_agent,
        sender_type,
        origin:              origin ?? channel,
        is_from_me,
        entry_point_source,
      },
    }

    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    if (matchedFlows.length === 0) {
      console.log(`${tag} nenhum flow corresponde ao evento — total avaliados: ${flows.length}`)
      return dispatchResult
    }

    dispatchResult.matchedFlows = matchedFlows.length
    console.log(`${tag} ${matchedFlows.length} flow(s) correspondente(s) — iniciando execuções`)

    // 2b. Carregar campos personalizados do lead para interpolação de variáveis {{custom.*}}
    //     Mesmo padrão de dispatchLeadCreatedTrigger.js — fail-safe, não bloqueia o dispatch.
    let customVariables = {}
    if (leadId) {
      try {
        const { data: customValues } = await supabase
          .from('lead_custom_values')
          .select('value, lead_custom_fields(field_name, field_type, company_id)')
          .eq('lead_id', leadId)

        for (const cv of customValues ?? []) {
          const field = cv.lead_custom_fields
          if (!field?.field_name || field.company_id !== companyId) continue

          let displayValue = cv.value ?? ''
          if (field.field_type === 'boolean') {
            displayValue = cv.value === 'true' ? 'Sim' : 'Não'
          }
          customVariables[`custom_${field.field_name}`] = displayValue
        }

        console.log(`${tag} campos personalizados carregados: ${Object.keys(customVariables).length}`)
      } catch (customErr) {
        console.warn(`${tag} erro ao carregar campos personalizados (não crítico):`, customErr?.message)
      }
    }

    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'499c2f'},body:JSON.stringify({sessionId:'499c2f',location:'dispatchMessageReceivedTrigger.js:customFields',message:'custom fields carregados para message.received',data:{leadId,customKeys:Object.keys(customVariables)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // 3. Para cada flow compatível: deduplicar, criar execução e processar
    for (const flow of matchedFlows) {
      // Enforcement de plano: flow acima do limite não executa
      if (flow.is_over_plan === true) {
        console.warn(`${tag} flow=${flow.id} is_over_plan=true — ignorado (plano excedido)`)
        dispatchResult.skippedFlows++
        continue
      }

      try {
        // Deduplicação por ig_message_id (Instagram) — garantia contra retry do schedule
        if (channel === 'instagram' && igMessageId) {
          const { data: existingIg } = await supabase
            .from('automation_executions')
            .select('id')
            .eq('company_id', companyId)
            .eq('flow_id', flow.id)
            .eq('trigger_data->>ig_message_id', igMessageId)
            .eq('trigger_data->>channel', 'instagram')
            .maybeSingle()

          if (existingIg) {
            console.warn(`${tag} flow=${flow.id} — execution Instagram já criada para ig_message_id=${igMessageId} — skip`)
            dispatchResult.existingExecutions++
            continue
          }
        }

        // Deduplicação legada por lead_id + flow (WhatsApp, quando leadId disponível)
        if (channel !== 'instagram' && leadId) {
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
            dispatchResult.existingExecutions++
            continue
          }
        }

        // Criar execução real
        const triggerData = {
          lead_id:         leadId,
          conversation_id: conversationId,
          instance_id:     instanceId ?? connectionId,
          connection_id:   connectionId,
          message_id:      messageId,
          ig_message_id:   igMessageId,
          text,
          channel,
          variables:       customVariables,
        }
        const execution = await createExecution(flow, triggerData, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          dispatchResult.failedFlows++
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado`)
        dispatchResult.createdExecutions++

        // Processar flow (processFlowAsync já é assíncrono internamente)
        await processFlowAsync(flow, execution, supabase)

      } catch (flowErr) {
        // Erros 23505 do índice de dedup de execution = já existe — não é falha operacional
        if (flowErr?.code === '23505') {
          console.warn(`${tag} flow=${flow.id} — 23505: execution já existe para ig_message_id=${igMessageId}`)
          dispatchResult.existingExecutions++
        } else {
          console.error(`${tag} flow=${flow.id} — erro ao processar:`, flowErr?.message)
          dispatchResult.failedFlows++
          dispatchResult.errors.push(`flow:${flow.id}:${flowErr?.message?.substring(0, 200) ?? 'unknown'}`)
        }
      }
    }

  } catch (err) {
    // Fail-safe: nunca quebra o caller
    console.error(`${tag} erro inesperado:`, err?.message)
    dispatchResult.errors.push(`global:${err?.message?.substring(0, 200) ?? 'unknown'}`)
  }

  return dispatchResult
}
