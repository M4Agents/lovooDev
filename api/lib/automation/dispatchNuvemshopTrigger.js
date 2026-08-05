// =====================================================
// DISPATCH NUVEMSHOP TRIGGER
//
// Dispatcher backend para eventos da integração Nuvemshop.
// Suporta os 6 tipos de gatilho:
//   nuvemshop.checkout_abandoned
//   nuvemshop.order_created
//   nuvemshop.order_paid
//   nuvemshop.order_cancelled
//   nuvemshop.order_fulfilled
//   nuvemshop.order_packed
//
// Segue exatamente o mesmo contrato de dispatchLeadCreatedTrigger.js:
//   - supabaseAdmin.js     → cliente com service_role
//   - triggerEvaluator.js  → matching de flows (pura, sem I/O)
//   - executor.js          → criação e execução real
//
// Fail-safe: nunca lança exceção para o caller.
//
// Deduplicação: persistente via dedup_key armazenada em trigger_data (JSONB).
// Sem janela de tempo — garante idempotência mesmo em retries tardios.
// Filtro PostgREST: trigger_data->>dedup_key (sem aspas SQL na chave).
//
// Pré-filtro: nodes::text ILIKE reduz flows antes de matchesTriggerConditions.
// matchesTriggerConditions permanece como verificação definitiva.
//
// Chamada segura nos handlers: await + .catch() — garante conclusão dentro do
// lifetime da Vercel Function. O dispatcher nunca lança exceção (try/catch externo).
//
// Limitações aceitas:
//   - Dedup TOCTOU: sem lock transacional entre SELECT e INSERT da execução.
//     Race condition improvável (worker usa lock por resource_id), mas documentado.
//   - leadId ausente para fulfillment: resolvido via lookup em opportunities.
//     Se não encontrado, dispatch é silenciosamente ignorado.
// =====================================================

import { getSupabaseAdmin }                 from './supabaseAdmin.js'
import { matchesTriggerConditions }          from './triggerEvaluator.js'
import { createExecution, processFlowAsync } from './executor.js'

/**
 * Dispara automações para eventos da integração Nuvemshop.
 *
 * Deve ser chamado com await + .catch() nos handlers (garante conclusão no lifetime da Vercel Function):
 *   await dispatchNuvemshopTrigger({ ... }).catch(err => console.error(...))
 *
 * @param {object}      params
 * @param {string}      params.companyId      UUID da empresa (obrigatório)
 * @param {string}      params.triggerType    Tipo do gatilho nuvemshop.*
 * @param {number|null} params.leadId         ID numérico do lead (null para fulfillment — resolvido internamente)
 * @param {string|null} params.opportunityId  UUID da oportunidade (opcional)
 * @param {object}      params.nuvemshopVars  Variáveis do evento: { store_id, checkout_id, cart_total, order_id, ... }
 * @param {object}      [supabaseOverride]    Cliente Supabase opcional (para testes)
 */
export async function dispatchNuvemshopTrigger(
  { companyId, triggerType, leadId, opportunityId, nuvemshopVars },
  supabaseOverride
) {
  const tag = `[dispatchNuvemshopTrigger][company:${companyId}][trigger:${triggerType}][lead:${leadId}]`

  if (!companyId || !triggerType) {
    console.warn(`${tag} parâmetros inválidos — companyId e triggerType são obrigatórios`)
    return
  }

  const supabase = supabaseOverride ?? getSupabaseAdmin()

  try {
    // 1. Resolver leadId para triggers de fulfillment
    //    fulfillmentHandler não tem leadId direto — buscamos via opportunityId
    let resolvedLeadId = leadId
    if (!resolvedLeadId && opportunityId) {
      const { data: opp } = await supabase
        .from('opportunities')
        .select('lead_id')
        .eq('id', opportunityId)
        .eq('company_id', companyId)
        .maybeSingle()

      resolvedLeadId = opp?.lead_id ?? null
    }

    if (!resolvedLeadId) {
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'automation_skipped_no_lead',
        trigger:        triggerType,
        company_id:     companyId,
        opportunity_id: opportunityId ?? null,
        reason:         'leadId not found — dispatch skipped',
      }))
      return
    }

    // 2. Buscar flows ativos da empresa.
    //    NOTA: .filter('nodes::text', 'ilike', ...) foi removido — o PostgREST não aplica
    //    o cast ::text via REST API e retorna "operator does not exist: jsonb ~~* unknown".
    //    O filtro por triggerType é feito em JS via matchesTriggerConditions (padrão dos
    //    demais dispatchers: dispatchLeadCreatedTrigger, dispatchOpportunityTrigger, etc.)
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
      console.log(`${tag} nenhum flow ativo encontrado`)
      return
    }

    // 3. Montar evento e filtrar flows compatíveis (matchesTriggerConditions é pura, sem I/O)
    const event = {
      type: triggerType,
      data: { ...nuvemshopVars, lead_id: resolvedLeadId },
    }

    const matchedFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

    if (matchedFlows.length === 0) {
      console.log(`${tag} nenhum flow corresponde ao evento — total avaliados: ${flows.length}`)
      return
    }

    console.log(`${tag} ${matchedFlows.length} flow(s) correspondente(s) — iniciando execuções`)

    // 4. Montar camada nuvemshop.* — todas as variáveis disponíveis para o tipo
    //    lead.*, opportunity.* e company.* são resolvidos pelo whatsappSender
    //    a partir de resolvedLeadId e opportunityId na execução
    const nuvemshopLayer = {
      'nuvemshop.store_id':         String(nuvemshopVars?.store_id         ?? ''),
      'nuvemshop.checkout_id':      String(nuvemshopVars?.checkout_id      ?? ''),
      'nuvemshop.cart_total':       String(nuvemshopVars?.cart_total       ?? ''),
      'nuvemshop.order_id':         String(nuvemshopVars?.order_id         ?? ''),
      'nuvemshop.order_number':     String(nuvemshopVars?.order_number     ?? ''),
      'nuvemshop.order_status':     String(nuvemshopVars?.order_status     ?? ''),
      'nuvemshop.payment_status':   String(nuvemshopVars?.payment_status   ?? ''),
      'nuvemshop.order_items':      String(nuvemshopVars?.order_items      ?? ''),
      'nuvemshop.tracking_number':  String(nuvemshopVars?.tracking_number  ?? ''),
      'nuvemshop.tracking_url':     String(nuvemshopVars?.tracking_url     ?? ''),
      'nuvemshop.shipping_carrier': String(nuvemshopVars?.shipping_carrier ?? ''),
      'nuvemshop.customer_id':      String(nuvemshopVars?.customer_id      ?? ''),
      'nuvemshop.checkout_url':     '',  // preenchido abaixo apenas para checkout_abandoned
    }

    // checkout_url: dado sensível — buscado do banco apenas para o trigger de carrinho abandonado.
    // Nunca logado. Enviado exclusivamente ao próprio cliente via WhatsApp.
    if (triggerType === 'nuvemshop.checkout_abandoned' && resolvedLeadId) {
      try {
        const { data: leadRow } = await supabase
          .from('leads')
          .select('nuvemshop_checkout_url')
          .eq('id', resolvedLeadId)
          .eq('company_id', companyId)
          .maybeSingle()

        nuvemshopLayer['nuvemshop.checkout_url'] = leadRow?.nuvemshop_checkout_url ?? ''
      } catch (urlErr) {
        // Falha não deve bloquear o dispatch — a variável permanece vazia
        console.warn(`${tag} erro ao buscar checkout_url (não crítico):`, urlErr?.message)
      }
    }

    // 5. Montar camada custom_* — campos personalizados do lead
    let customVariables = {}
    try {
      const { data: customValues } = await supabase
        .from('lead_custom_values')
        .select('value, lead_custom_fields(field_name, field_type, company_id)')
        .eq('lead_id', resolvedLeadId)

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

    const mergedVariables = { ...nuvemshopLayer, ...customVariables }

    // 6. Chave de deduplicação estável por evento
    //    Usa order_id para pedidos/fulfillment, checkout_id para carrinhos
    const resourceId = nuvemshopVars?.order_id || nuvemshopVars?.checkout_id || ''

    // 7. Para cada flow compatível: enforcar plano, deduplicar, criar execução e processar
    for (const flow of matchedFlows) {
      // Enforcement de plano: flow acima do limite não executa
      if (flow.is_over_plan === true) {
        console.warn(`${tag} flow=${flow.id} is_over_plan=true — ignorado (plano excedido)`)
        continue
      }

      try {
        // Deduplicação persistente: chave estável sem janela de tempo
        // Garante idempotência em retries tardios (horas/dias depois)
        const dedupKey = `ns:${triggerType}:${resourceId}`

        // PostgREST espera o nome da chave JSONB sem aspas SQL:
        //   trigger_data->>dedup_key  (correto)
        //   trigger_data->>'dedup_key' (incorreto — PostgREST não interpreta aspas SQL)
        const { data: existing } = await supabase
          .from('automation_executions')
          .select('id')
          .eq('company_id', companyId)
          .eq('flow_id', flow.id)
          .filter('trigger_data->>dedup_key', 'eq', dedupKey)
          .limit(1)
          .maybeSingle()

        if (existing) {
          console.warn(`${tag} flow=${flow.id} ignorado — dedup_key já registrada: ${dedupKey}`)
          continue
        }

        // Criar execução com dedup_key e variáveis enriquecidas
        const triggerData = {
          dedup_key:      dedupKey,
          lead_id:        resolvedLeadId,
          opportunity_id: opportunityId ?? null,
          variables:      mergedVariables,
          source:         'nuvemshop',
        }

        const execution = await createExecution(flow, triggerData, companyId, supabase)

        if (!execution) {
          console.error(`${tag} flow=${flow.id} — createExecution retornou null`)
          continue
        }

        console.log(`${tag} flow=${flow.id} execution=${execution.id} — disparado (dedup_key=${dedupKey})`)

        // Processar flow — awaited por flow individual para capturar erros e garantir log estruturado
        await processFlowAsync(flow, execution, supabase)

      } catch (flowErr) {
        // Erro em um flow não impede os demais
        console.error(`${tag} flow=${flow.id} — erro ao processar:`, flowErr?.message)
      }
    }

  } catch (err) {
    // Fail-safe total: nunca quebra o caller (handler de evento)
    console.error(`${tag} erro inesperado:`, err?.message)
  }
}
