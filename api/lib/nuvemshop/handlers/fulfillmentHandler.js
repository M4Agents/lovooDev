// =============================================================================
// fulfillmentHandler — Handler de Eventos de Fulfillment Nuvemshop
//
// Eventos suportados:
//   order/packed    → pedido embalado, pronto para envio
//   order/fulfilled → pedido enviado / entregue
//
// Fluxo:
//   1. Validar contexto (companyId, storeId, orderId no payload)
//   2. Buscar dados completos do pedido via GET /orders/{id}
//   3. Delegar ao fulfillmentSync (update oportunidade + timeline)
//
// ── O que este handler NÃO faz ───────────────────────────────────────────────
// - Não altera valor da oportunidade
// - Não altera o Lead vinculado
// - Não altera os itens da oportunidade
// - Não converte status manualmente (delega ao statusMapper via fulfillmentSync)
// =============================================================================

import { getSupabaseAdmin }             from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }        from '../tokenCrypto.js';
import { createNuvemshopClient }        from '../nuvemshopClient.js';
import { upsertFulfillment }            from '../sync/fulfillmentSync.js';
import { dispatchNuvemshopTrigger }     from '../../automation/dispatchNuvemshopTrigger.js';

const SUPPORTED_TOPICS = new Set(['order/packed', 'order/fulfilled']);

export async function fulfillmentHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  if (!SUPPORTED_TOPICS.has(topic)) {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'fulfillment_handler_unsupported_topic',
      topic,
      company_id:     companyId,
      correlation_id: correlationId,
    }));
    return { ok: true, skipped: true };
  }

  const nuvemshopOrderId = String(payload?.id ?? '');
  if (!nuvemshopOrderId) {
    throw new Error('[fulfillmentHandler] Payload sem order.id');
  }

  const svc = getSupabaseAdmin();

  // ── Buscar conexão e token ────────────────────────────────────────────────
  const { data: conn, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, access_token_enc, status')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr) throw new Error(`[fulfillmentHandler] connection_lookup_failed: ${connErr.message}`);
  if (!conn)   throw new Error(`[fulfillmentHandler] Conexão ativa não encontrada: company=${companyId} store=${storeId}`);

  const accessToken = decryptNuvemshopToken(conn.access_token_enc);
  const client      = createNuvemshopClient({ storeId, accessToken, correlationId });

  // ── Buscar dados completos do pedido ──────────────────────────────────────
  // Necessário para obter tracking_number, tracking_url, carrier e status atualizado.
  let orderData;
  try {
    orderData = await client.get(`orders/${nuvemshopOrderId}`);
  } catch (err) {
    if (err?.status === 404) {
      console.warn(JSON.stringify({
        level:              'warn',
        event:              'fulfillment_order_not_found_in_api',
        company_id:         companyId,
        nuvemshop_order_id: nuvemshopOrderId,
        topic,
        resolution:         'skip_order_may_have_been_deleted',
        correlation_id:     correlationId,
      }));
      return { ok: true };
    }
    throw new Error(`[fulfillmentHandler] Falha ao buscar pedido ${nuvemshopOrderId}: ${err.message}`);
  }

  if (!orderData) {
    throw new Error(`[fulfillmentHandler] Resposta vazia para pedido ${nuvemshopOrderId}`);
  }

  // ── Delegar ao Sync Service ───────────────────────────────────────────────
  const syncResult = await upsertFulfillment({
    companyId,
    storeId,
    orderData,
    topic,
    svc,
  });

  if (syncResult.skipped) {
    console.warn(JSON.stringify({
      level:              'warn',
      event:              'fulfillment_skipped_no_opportunity',
      company_id:         companyId,
      nuvemshop_order_id: nuvemshopOrderId,
      topic,
      resolution:         'reconciliation_will_resolve',
      correlation_id:     correlationId,
    }));
    return { ok: true };
  }

  console.info(JSON.stringify({
    level:               'info',
    event:               'fulfillment_synced',
    topic,
    company_id:          companyId,
    nuvemshop_order_id:  nuvemshopOrderId,
    opportunity_id:      syncResult.opportunityId,
    timeline_inserted:   syncResult.timelineInserted,
    correlation_id:      correlationId,
  }));

  // ── Disparar automações (fire-and-forget) ─────────────────────────────────
  // leadId não está disponível neste handler — o dispatcher resolve via opportunityId
  const TOPIC_TO_TRIGGER = {
    'order/packed':    'nuvemshop.order_packed',
    'order/fulfilled': 'nuvemshop.order_fulfilled',
  };
  const triggerType = TOPIC_TO_TRIGGER[topic];

  if (triggerType && syncResult.opportunityId) {
    // Aguardado (await) para garantir conclusão dentro do lifetime da Vercel Function.
    // O dispatcher tem fail-safe total (try/catch externo) — nunca lança exceção.
    // leadId é resolvido internamente pelo dispatcher via opportunityId.
    await dispatchNuvemshopTrigger({
      companyId,
      triggerType,
      leadId:        null,
      opportunityId: syncResult.opportunityId,
      nuvemshopVars: {
        store_id:         storeId,
        order_id:         nuvemshopOrderId,
        order_status:     String(orderData?.status                      ?? ''),
        payment_status:   String(orderData?.payment_status              ?? ''),
        tracking_number:  String(orderData?.shipping_tracking_number    ?? ''),
        shipping_carrier: String(orderData?.shipping_carrier_name       ?? ''),
        customer_id:      String(orderData?.customer?.id                ?? ''),
      },
    }).catch(err => console.error(JSON.stringify({
      level:              'error',
      event:              'fulfillment_automation_dispatch_failed',
      trigger:            triggerType,
      company_id:         companyId,
      nuvemshop_order_id: nuvemshopOrderId,
      correlation_id:     correlationId,
      message:            err?.message,
    })));
  }

  return {
    ok:               true,
    opportunityId:    syncResult.opportunityId,
    timelineInserted: syncResult.timelineInserted,
  };
}
