// =============================================================================
// orderHandler — Handler de Eventos de Pedidos Nuvemshop
//
// Eventos suportados:
//   order/created → cria oportunidade vinculada ao lead
//   order/paid    → atualiza status para 'won'
//   order/updated → atualiza oportunidade e itens
//
// Responsabilidades deste handler:
//   1. Validar contexto (companyId, storeId, nuvemshopOrderId)
//   2. Buscar dados completos do pedido via GET /orders/{id}
//   3. Buscar transações via GET /orders/{id}/transactions
//   4. Delegar toda a lógica de negócio ao orderSync
//
// Não converte status manualmente (exclusivamente via statusMapper no orderSync).
// Não cria produtos automaticamente (responsabilidade do productHandler/reconciliação).
// =============================================================================

import { getSupabaseAdmin }              from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }         from '../tokenCrypto.js';
import { createNuvemshopClient }         from '../nuvemshopClient.js';
import { upsertOrder }                   from '../sync/orderSync.js';
import { dispatchNuvemshopTrigger }      from '../../automation/dispatchNuvemshopTrigger.js';

const SUPPORTED_TOPICS = new Set(['order/created', 'order/paid', 'order/updated', 'order/cancelled']);

/**
 * Formata os itens do pedido como texto legível para uso em mensagens de automação.
 * Cada linha: "Nome × Qtd — R$ Preço"
 * Retorna string vazia se não houver itens.
 */
function formatOrderItems(products) {
  if (!Array.isArray(products) || products.length === 0) return '';
  return products
    .map(p => {
      const name  = p.name    || p.product_name || 'Produto';
      const qty   = Number(p.quantity) || 1;
      const price = Number(p.price)    || 0;
      const formattedPrice = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return `${name} × ${qty} — ${formattedPrice}`;
    })
    .join('\n');
}

export async function orderHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // ── Validação de contexto ─────────────────────────────────────────────────
  if (!SUPPORTED_TOPICS.has(topic)) {
    console.warn(JSON.stringify({
      level:         'warn',
      event:         'order_handler_unsupported_topic',
      topic,
      company_id:    companyId,
      correlation_id: correlationId,
    }));
    return { ok: true, skipped: true };
  }

  const nuvemshopOrderId = String(payload?.id ?? '');
  if (!nuvemshopOrderId) {
    throw new Error('[orderHandler] Payload sem order.id');
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

  if (connErr) throw new Error(`[orderHandler] connection_lookup_failed: ${connErr.message}`);
  if (!conn)   throw new Error(`[orderHandler] Conexão ativa não encontrada para company=${companyId} store=${storeId}`);

  const accessToken = decryptNuvemshopToken(conn.access_token_enc);
  const client      = createNuvemshopClient({ storeId, accessToken, correlationId });

  // ── Buscar pedido completo ─────────────────────────────────────────────────
  let orderData;
  try {
    orderData = await client.get(`orders/${nuvemshopOrderId}`);
  } catch (err) {
    if (err?.status === 404) {
      console.warn(JSON.stringify({
        level:              'warn',
        event:              'order_not_found_in_api',
        company_id:         companyId,
        nuvemshop_order_id: nuvemshopOrderId,
        topic,
        resolution:         'skip_no_opportunity_update',
        correlation_id:     correlationId,
      }));
      return { ok: true };
    }
    throw new Error(`[orderHandler] Falha ao buscar pedido ${nuvemshopOrderId}: ${err.message}`);
  }

  if (!orderData) {
    throw new Error(`[orderHandler] Resposta vazia para pedido ${nuvemshopOrderId}`);
  }

  // ── Buscar transações (GET /orders/{id}/transactions) ─────────────────────
  let transactionData = [];
  try {
    const response = await client.get(`orders/${nuvemshopOrderId}/transactions`);
    transactionData = Array.isArray(response) ? response : [];
  } catch (err) {
    // Falha em transações não deve bloquear a oportunidade
    console.warn(JSON.stringify({
      level:              'warn',
      event:              'order_transactions_fetch_failed',
      company_id:         companyId,
      nuvemshop_order_id: nuvemshopOrderId,
      error:              err.message,
      resolution:         'proceed_without_payment_data',
      correlation_id:     correlationId,
    }));
  }

  // ── Delegar ao Sync Service ───────────────────────────────────────────────
  const syncResult = await upsertOrder({
    companyId,
    storeId,
    orderData,
    transactionData,
    topic,
    svc,
  });

  console.info(JSON.stringify({
    level:              'info',
    event:              'order_synced',
    topic,
    company_id:         companyId,
    nuvemshop_order_id: nuvemshopOrderId,
    opportunity_id:     syncResult.opportunityId,
    lead_id:            syncResult.leadId,
    action:             syncResult.action,
    correlation_id:     correlationId,
  }));

  // ── Disparar automações (fire-and-forget) ─────────────────────────────────
  const TOPIC_TO_TRIGGER = {
    'order/created':   'nuvemshop.order_created',
    'order/paid':      'nuvemshop.order_paid',
    'order/cancelled': 'nuvemshop.order_cancelled',
  };
  const triggerType = TOPIC_TO_TRIGGER[topic];

  if (triggerType) {
    if (syncResult.leadId) {
      // Aguardado (await) para garantir conclusão dentro do lifetime da Vercel Function.
      // O dispatcher tem fail-safe total (try/catch externo) — nunca lança exceção.
      await dispatchNuvemshopTrigger({
        companyId,
        triggerType,
        leadId:        syncResult.leadId,
        opportunityId: syncResult.opportunityId ?? null,
        nuvemshopVars: {
          store_id:       storeId,
          order_id:       nuvemshopOrderId,
          order_number:   String(orderData?.number          ?? ''),
          order_status:   String(orderData?.status          ?? ''),
          payment_status: String(orderData?.payment_status  ?? ''),
          order_items:    formatOrderItems(orderData?.products),
          customer_id:    String(orderData?.customer?.id    ?? ''),
        },
      }).catch(err => console.error(JSON.stringify({
        level:              'error',
        event:              'order_automation_dispatch_failed',
        trigger:            triggerType,
        company_id:         companyId,
        nuvemshop_order_id: nuvemshopOrderId,
        correlation_id:     correlationId,
        message:            err?.message,
      })));
    } else {
      console.warn(JSON.stringify({
        level:              'warn',
        event:              'automation_skipped_no_lead',
        trigger:            triggerType,
        company_id:         companyId,
        nuvemshop_order_id: nuvemshopOrderId,
        reason:             'orderSync did not return leadId',
        correlation_id:     correlationId,
      }));
    }
  }

  return { ok: true, opportunityId: syncResult.opportunityId, leadId: syncResult.leadId, action: syncResult.action };
}
