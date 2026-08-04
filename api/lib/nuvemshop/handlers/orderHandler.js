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

import { getSupabaseAdmin }        from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }            from '../tokenCrypto.js';
import { createNuvemshopClient }   from '../nuvemshopClient.js';
import { upsertOrder }             from '../sync/orderSync.js';

const SUPPORTED_TOPICS = new Set(['order/created', 'order/paid', 'order/updated']);

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
    .select('id, nuvemshop_store_id, encrypted_access_token, status')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr) throw new Error(`[orderHandler] connection_lookup_failed: ${connErr.message}`);
  if (!conn)   throw new Error(`[orderHandler] Conexão ativa não encontrada para company=${companyId} store=${storeId}`);

  const accessToken = decryptNuvemshopToken(conn.encrypted_access_token);
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

  return { ok: true, opportunityId: syncResult.opportunityId, action: syncResult.action };
}
