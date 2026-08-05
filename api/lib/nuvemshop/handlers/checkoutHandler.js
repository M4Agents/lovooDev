// =============================================================================
// checkoutHandler — Handler de Carrinhos Abandonados Nuvemshop
//
// Evento suportado:
//   checkout/abandoned → cria ou atualiza lead com dados do carrinho abandonado
//
// Fluxo:
//   1. Validar contexto (companyId, storeId, checkoutId no payload)
//   2. Buscar dados completos via GET /checkouts/{id}
//   3. Delegar ao checkoutSync (deduplicação + upsert de lead)
//   4. Preparar dados para gatilho de automação (sem executar o fluxo)
//
// ── Segurança do abandoned_checkout_url ──────────────────────────────────────
// ⚠️  DADO SENSÍVEL.
//   - Nunca incluir em logs (nem warn, nem debug)
//   - Nunca retornar no response desta função
//   - Apenas checkoutSync persiste a URL no banco
//   - Referenciado em automações por checkoutId, nunca pela URL
//
// ── Gatilho de Automação ─────────────────────────────────────────────────────
// O resultado inclui: leadId, checkoutId, cartTotal, action, companyId, storeId.
// O engine de automações pode usar esses dados para disparar o evento
// 'checkout_abandoned'. Fluxo de WhatsApp/IA não é implementado nesta fase.
// =============================================================================

import { getSupabaseAdmin }                  from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }             from '../tokenCrypto.js';
import { createNuvemshopClient }             from '../nuvemshopClient.js';
import { upsertCheckout }                    from '../sync/checkoutSync.js';
import { dispatchNuvemshopTrigger }          from '../../automation/dispatchNuvemshopTrigger.js';

/**
 * Formata os itens do carrinho abandonado para uso em automações.
 * Estrutura Nuvemshop: checkoutData.line_items[].{ name, quantity, price }
 */
function formatCartItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';
  return lineItems
    .map(item => {
      const name  = item.name    || item.product_name || 'Produto';
      const qty   = Number(item.quantity) || 1;
      const price = Number(item.price)    || 0;
      const formattedPrice = price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return `${name} × ${qty} — ${formattedPrice}`;
    })
    .join('\n');
}

export async function checkoutHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  if (topic !== 'checkout/abandoned') {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'checkout_handler_unsupported_topic',
      topic,
      company_id:     companyId,
      correlation_id: correlationId,
    }));
    return { ok: true, skipped: true };
  }

  const nuvemshopCheckoutId = String(payload?.id ?? '');
  if (!nuvemshopCheckoutId) {
    throw new Error('[checkoutHandler] Payload sem checkout.id');
  }

  const svc = getSupabaseAdmin();

  // ── Buscar conexão ────────────────────────────────────────────────────────
  const { data: conn, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, access_token_enc, status')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr) throw new Error(`[checkoutHandler] connection_lookup_failed: ${connErr.message}`);
  if (!conn)   throw new Error(`[checkoutHandler] Conexão ativa não encontrada para company=${companyId} store=${storeId}`);

  const accessToken = decryptNuvemshopToken(conn.access_token_enc);
  const client      = createNuvemshopClient({ storeId, accessToken, correlationId });

  // ── Buscar checkout completo via API ──────────────────────────────────────
  // Necessário para obter abandoned_checkout_url e dados completos do carrinho.
  let checkoutData;
  try {
    checkoutData = await client.get(`checkouts/${nuvemshopCheckoutId}`);
  } catch (err) {
    if (err?.status === 404) {
      // Checkout pode ter sido convertido em pedido ou expirado
      console.warn(JSON.stringify({
        level:                 'warn',
        event:                 'checkout_not_found_in_api',
        company_id:            companyId,
        nuvemshop_checkout_id: nuvemshopCheckoutId,
        topic,
        resolution:            'skip_checkout_may_have_been_converted_to_order',
        correlation_id:        correlationId,
        // Nunca logar: abandoned_checkout_url
      }));
      return { ok: true };
    }
    throw new Error(`[checkoutHandler] Falha ao buscar checkout ${nuvemshopCheckoutId}: ${err.message}`);
  }

  if (!checkoutData) {
    throw new Error(`[checkoutHandler] Resposta vazia para checkout ${nuvemshopCheckoutId}`);
  }

  // #region agent log — inspecionar estrutura real do objeto checkout
  fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c830cd'},body:JSON.stringify({sessionId:'c830cd',location:'checkoutHandler.js:checkout_structure',message:'checkout_data_keys',hypothesisId:'field_names',data:{keys:Object.keys(checkoutData),customer_keys:checkoutData.customer?Object.keys(checkoutData.customer):null,contact_email:checkoutData.contact_email??'__missing__',contact_name:checkoutData.contact_name??'__missing__',email:checkoutData.email??'__missing__',name:checkoutData.name??'__missing__',total_price:checkoutData.total_price??'__missing__',subtotal_price:checkoutData.subtotal_price??'__missing__',total:checkoutData.total??'__missing__',currency:checkoutData.currency??'__missing__',customer_id:checkoutData.customer?.id??null,customer_email:checkoutData.customer?.email??null,line_items_count:Array.isArray(checkoutData.line_items)?checkoutData.line_items.length:null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  // ── Delegar ao Sync Service ───────────────────────────────────────────────
  const syncResult = await upsertCheckout({
    companyId,
    storeId,
    checkoutData,
    svc,
  });

  // ── Log estruturado (SEM a URL) ───────────────────────────────────────────
  console.info(JSON.stringify({
    level:                 'info',
    event:                 'checkout_abandoned_synced',
    topic,
    company_id:            companyId,
    nuvemshop_checkout_id: syncResult.checkoutId,
    lead_id:               syncResult.leadId,
    action:                syncResult.action,
    matched_by:            syncResult.matchedBy,
    cart_total:            syncResult.cartTotal,
    correlation_id:        correlationId,
    // Nunca logar: abandoned_checkout_url, nuvemshop_checkout_url
  }));

  // ── Disparar automações ───────────────────────────────────────────────────
  // Aguardado (await) para garantir conclusão dentro do lifetime da Vercel Function.
  // O dispatcher tem fail-safe total (try/catch externo) — nunca lança exceção.
  // checkout_url NUNCA incluído nas variáveis de automação.
  if (syncResult.leadId) {
    await dispatchNuvemshopTrigger({
      companyId,
      triggerType: 'nuvemshop.checkout_abandoned',
      leadId:      syncResult.leadId,
      opportunityId: null,
      nuvemshopVars: {
        store_id:    storeId,
        checkout_id: String(syncResult.checkoutId ?? ''),
        cart_total:  String(syncResult.cartTotal   ?? checkoutData?.total_price ?? ''),
        customer_id: String(checkoutData?.customer?.id ?? ''),
        order_items: formatCartItems(checkoutData?.line_items),
      },
    }).catch(err => console.error(JSON.stringify({
      level:          'error',
      event:          'checkout_automation_dispatch_failed',
      company_id:     companyId,
      checkout_id:    syncResult.checkoutId,
      correlation_id: correlationId,
      message:        err?.message,
    })));
  } else {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'automation_skipped_no_lead',
      trigger:        'nuvemshop.checkout_abandoned',
      company_id:     companyId,
      checkout_id:    syncResult.checkoutId,
      reason:         'checkoutSync did not return leadId',
      correlation_id: correlationId,
    }));
  }

  return {
    ok:     true,
    leadId: syncResult.leadId,
    action: syncResult.action,
  };
}
