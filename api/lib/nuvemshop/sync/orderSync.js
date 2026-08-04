// =============================================================================
// orderSync — Sync Service de Pedidos/Oportunidades Nuvemshop
//
// Responsabilidades:
//   1. Garantir lead vinculado (via customerSync)
//   2. Criar ou atualizar oportunidade em opportunities
//   3. Sincronizar opportunity_items de forma incremental (preservando UUIDs)
//   4. Persistir payment_data seguro via statusMapper.extractSafePaymentData
//
// ── Vínculos ─────────────────────────────────────────────────────────────────
// Oportunidade → Lead (lead_id): obrigatório
// Oportunidade → Nuvemshop     : nuvemshop_order_id (TEXT), nuvemshop_store_id
//
// ── Produtos do pedido ───────────────────────────────────────────────────────
// Localização: external_source = 'nuvemshop', external_id = String(product_id),
//              com suporte a variant_id para resolução futura em opportunity_items.
//
// Itens com produto não encontrado:
//   - Log estruturado com product_id e variant_id
//   - Oportunidade mantida com valor total do pedido (value_mode = 'manual')
//   - Reconciliação resolverá na próxima sincronização
//
// ── Status ───────────────────────────────────────────────────────────────────
// Exclusivamente via statusMapper.mapOrderStatusToCrm().
// Status bruto preservado em nuvemshop_raw_status para auditoria.
//
// ── Segurança financeira ─────────────────────────────────────────────────────
// Dados de transação filtrados via statusMapper.extractSafePaymentData().
// NUNCA armazenar: número completo do cartão, CVV, tokens, credenciais.
//
// ── value_mode = 'manual' ────────────────────────────────────────────────────
// OBRIGATÓRIO para todos os pedidos Nuvemshop.
//
// Significa que o valor financeiro oficial da oportunidade é SEMPRE o informado
// pela Nuvemshop (order.total). Ele NUNCA deve ser recalculado automaticamente
// pelo CRM a partir dos itens da oportunidade.
//
// Motivo: os itens podem estar incompletos (produtos ainda não sincronizados
// são omitidos da tabela opportunity_items). Recalcular de items parciais
// produziria um valor menor que o real. O campo `value` sempre reflete o
// total exato do pedido, independente de quantos itens foram resolvidos.
//
// ── Sincronização incremental de itens ───────────────────────────────────────
// Estratégia: UPSERT por product_id + DELETE de itens removidos.
//   - Itens existentes (mesmo product_id) são ATUALIZADOS, preservando o UUID.
//   - Novos itens recebem UUID gerado pelo banco.
//   - Itens removidos do pedido são excluídos.
//
// Benefícios vs. DELETE+INSERT:
//   - UUIDs estáveis permitem rastreabilidade de auditoria.
//   - Evita "piscar" de IDs em integrações externas.
//   - Menor footprint de escrita no banco.
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import { upsertCustomer }   from './customerSync.js';
import {
  mapOrderStatusToCrm,
  extractSafePaymentData,
  isClosed,
} from '../statusMapper.js';

// ── Resolução de lead ─────────────────────────────────────────────────────────

/**
 * Garante que existe um lead vinculado ao cliente do pedido.
 * Delega integralmente ao customerSync para manter a única fonte de deduplicação.
 */
async function resolveLeadId({ companyId, storeId, orderCustomer, svc }) {
  if (!orderCustomer?.id) {
    throw new Error('[orderSync] Pedido sem customer.id — vínculo obrigatório com lead');
  }

  const result = await upsertCustomer({
    companyId,
    storeId,
    customerData: orderCustomer,
    svc,
  });

  return result.leadId;
}

// ── Resolução de produtos ────────────────────────────────────────────────────

/**
 * Resolve produtos do pedido a partir do catálogo sincronizado.
 *
 * Critérios de busca:
 *   external_source = 'nuvemshop'
 *   external_id     = String(item.product_id)
 *   company_id      = companyId
 *
 * Itens sem match → pulados (log estruturado + reconciliação).
 * variant_id preservado para resolução futura em opportunity_items.
 *
 * @returns {Array<{ item: object, productId: UUID }>}
 */
async function resolveOrderProducts({ svc, companyId, orderProducts }) {
  if (!orderProducts?.length) return [];

  const externalIds = [...new Set(orderProducts.map(p => String(p.product_id)))];

  const { data: found, error } = await svc
    .from('products')
    .select('id, external_id')
    .eq('company_id', companyId)
    .eq('external_source', 'nuvemshop')
    .in('external_id', externalIds)
    .eq('is_active', true);

  if (error) throw new Error(`[orderSync] products_lookup_failed: ${error.message}`);

  // Mapa: external_id → products.id (UUID)
  const idMap = new Map((found ?? []).map(p => [p.external_id, p.id]));

  const resolved = [];
  const missing  = [];

  for (const item of orderProducts) {
    const extId    = String(item.product_id);
    const productId = idMap.get(extId);

    if (productId) {
      resolved.push({ item, productId });
    } else {
      missing.push({ product_id: extId, variant_id: item.variant_id ?? null });
    }
  }

  if (missing.length > 0) {
    console.warn(JSON.stringify({
      level:            'warn',
      event:            'order_items_products_not_found',
      company_id:       companyId,
      missing_products: missing,
      total_items:      orderProducts.length,
      resolved_items:   resolved.length,
      resolution:       'items_skipped_opportunity_kept_value_manual',
    }));
  }

  return resolved;
}

// ── opportunity_items ────────────────────────────────────────────────────────

function buildItemRow({ companyId, opportunityId, productId, item, now }) {
  const unitPrice = Number(item.price)       || 0;
  const quantity  = Number(item.quantity)    || 1;
  const lineTotal = Number(item.total_price) || parseFloat((unitPrice * quantity).toFixed(2));

  return {
    company_id:           companyId,
    opportunity_id:       opportunityId,
    product_id:           productId,
    service_id:           null,
    line_type:            'product',
    name_snapshot:        item.name || `Produto ${item.product_id}`,
    description_snapshot: item.sku  || null,
    unit_price:           unitPrice,
    quantity,
    discount_type:        'fixed',
    discount_value:       0,
    line_total:           lineTotal,
    updated_at:           now,
  };
}

/**
 * Sincroniza os itens da oportunidade de forma incremental.
 *
 * Estratégia (preserva UUIDs existentes):
 *   1. Busca itens atuais: mapa { product_id → row_uuid }
 *   2. Para cada item resolvido:
 *      - Mesmo product_id já existe  → UPDATE (UUID preservado)
 *      - product_id novo             → INSERT (UUID gerado pelo banco)
 *   3. Itens cujo product_id não está mais no pedido → DELETE
 *
 * Chave de matching: product_id (UUID do catálogo CRM).
 * Itens com produto não encontrado no catálogo são ignorados.
 * A constraint opportunity_items_line_xor exige product_id != null para 'product'.
 */
async function syncOpportunityItems({ svc, companyId, opportunityId, resolvedItems, now }) {
  // 1. Busca itens existentes da oportunidade
  const { data: existing, error: fetchErr } = await svc
    .from('opportunity_items')
    .select('id, product_id')
    .eq('opportunity_id', opportunityId)
    .eq('company_id', companyId);

  if (fetchErr) throw new Error(`[orderSync] items_fetch_failed: ${fetchErr.message}`);

  // Mapa: product_id (UUID) → row id (UUID) dos itens já persistidos
  const existingMap = new Map((existing ?? []).map(r => [r.product_id, r.id]));

  // IDs de produto que devem existir após a sincronização
  const incomingProductIds = new Set(resolvedItems.map(r => r.productId));

  // 2. UPSERT incremental: atualiza existentes, insere novos
  for (const { item, productId } of resolvedItems) {
    const row        = buildItemRow({ companyId, opportunityId, productId, item, now });
    const existingId = existingMap.get(productId);

    if (existingId) {
      // UPDATE: preserva UUID e created_at originais
      const { error } = await svc
        .from('opportunity_items')
        .update(row)
        .eq('id', existingId)
        .eq('company_id', companyId);
      if (error) throw new Error(`[orderSync] item_update_failed: ${error.message}`);
    } else {
      // INSERT: novo item com UUID gerado pelo banco
      const { error } = await svc
        .from('opportunity_items')
        .insert({ ...row, created_at: now });
      if (error) throw new Error(`[orderSync] item_insert_failed: ${error.message}`);
    }
  }

  // 3. DELETE: apenas itens cujo produto foi removido do pedido
  const idsToDelete = (existing ?? [])
    .filter(r => !incomingProductIds.has(r.product_id))
    .map(r => r.id);

  if (idsToDelete.length > 0) {
    const { error } = await svc
      .from('opportunity_items')
      .delete()
      .in('id', idsToDelete)
      .eq('company_id', companyId);
    if (error) throw new Error(`[orderSync] items_delete_failed: ${error.message}`);
  }
}

// ── Builder de oportunidade ───────────────────────────────────────────────────

function buildOpportunityRow({
  companyId, storeId, leadId, orderData, transactionData, topic, now,
}) {
  const crmStatus   = mapOrderStatusToCrm({
    topic,
    orderStatus:    orderData.status,
    paymentStatus:  orderData.payment_status,
  });
  const closed      = isClosed(crmStatus);
  const closedAtStr = closed ? now : null;
  const todayDate   = closed ? now.slice(0, 10) : null;

  const txPayment   = extractSafePaymentData(
    Array.isArray(transactionData) ? transactionData[0] : null,
  );

  // Enriquecer payment_data com payment_status do pedido como fallback.
  // Quando não há transação (pagamento manual ou gateway sem registro),
  // order.payment_status ('paid', 'pending', etc.) é a única fonte disponível.
  const safePayment = txPayment
    ? {
        ...txPayment,
        payment_status: txPayment.payment_status ?? orderData.payment_status ?? null,
      }
    : orderData.payment_status
      ? { payment_status: orderData.payment_status }
      : null;

  return {
    company_id:            companyId,
    lead_id:               leadId,
    title:                 `Pedido #${orderData.number ?? orderData.id}`,
    value:                 Number(orderData.total)    || 0,
    currency:              orderData.currency         ?? 'BRL',
    status:                crmStatus,
    source:                'nuvemshop',
    probability:           crmStatus === 'won' ? 100 : crmStatus === 'lost' ? 0 : 50,
    value_mode:            'manual',
    items_subtotal:        null,           // não calculado de items parciais
    closed_at:             closedAtStr,
    actual_close_date:     todayDate,

    nuvemshop_order_id:    String(orderData.id),
    nuvemshop_store_id:    storeId,
    nuvemshop_order_number: String(orderData.number ?? orderData.id),
    nuvemshop_sync_status: 'synced',
    nuvemshop_payment_data: safePayment,
    nuvemshop_raw_status:   orderData.status ?? null,

    updated_at: now,
  };
}

// ── Posicionamento no funil ───────────────────────────────────────────────────

/**
 * Posiciona uma oportunidade recém-criada no funil padrão da empresa.
 *
 * Estratégia:
 *   1. Busca funil padrão (is_default = true, is_active = true)
 *   2. Fallback: primeiro funil ativo por data de criação
 *   3. Busca primeira etapa do funil (position ASC)
 *   4. Insere em opportunity_funnel_positions
 *
 * Falha silenciosa: um erro aqui não cancela a criação da oportunidade.
 * A oportunidade pode ser posicionada manualmente via UI.
 *
 * @param {{ svc, companyId, opportunityId, leadId, now }}
 */
async function positionInDefaultFunnel({ svc, companyId, opportunityId, leadId, now }) {
  try {
    // 1. Funil padrão
    let { data: funnel } = await svc
      .from('sales_funnels')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_default', true)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // 2. Fallback: primeiro funil ativo
    if (!funnel) {
      const { data: fallback } = await svc
        .from('sales_funnels')
        .select('id')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      funnel = fallback;
    }

    if (!funnel?.id) {
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'order_opportunity_no_funnel_found',
        company_id:     companyId,
        opportunity_id: opportunityId,
        resolution:     'opportunity_created_without_funnel_position',
      }));
      return;
    }

    // 3. Primeira etapa do funil
    const { data: firstStage } = await svc
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', funnel.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!firstStage?.id) {
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'order_opportunity_no_stage_found',
        company_id:     companyId,
        funnel_id:      funnel.id,
        opportunity_id: opportunityId,
      }));
      return;
    }

    // 4. Posicionar no funil
    const { error: posErr } = await svc
      .from('opportunity_funnel_positions')
      .insert({
        lead_id:          leadId,
        opportunity_id:   opportunityId,
        funnel_id:        funnel.id,
        stage_id:         firstStage.id,
        position_in_stage: 0,
        entered_stage_at: now,
        updated_at:       now,
      });

    if (posErr) {
      console.error(JSON.stringify({
        level:          'error',
        event:          'order_opportunity_funnel_position_failed',
        company_id:     companyId,
        opportunity_id: opportunityId,
        funnel_id:      funnel.id,
        stage_id:       firstStage.id,
        error:          posErr.message,
      }));
    } else {
      console.log(JSON.stringify({
        level:          'info',
        event:          'order_opportunity_positioned_in_funnel',
        company_id:     companyId,
        opportunity_id: opportunityId,
        funnel_id:      funnel.id,
        stage_id:       firstStage.id,
      }));
    }
  } catch (err) {
    // Falha silenciosa — não cancela a criação da oportunidade
    console.error(JSON.stringify({
      level:          'error',
      event:          'order_opportunity_funnel_position_exception',
      company_id:     companyId,
      opportunity_id: opportunityId,
      error:          err.message,
    }));
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza uma oportunidade a partir de um pedido Nuvemshop.
 *
 * @param {{
 *   companyId:       string,
 *   storeId:         string,
 *   orderData:       object,      Resposta de GET /orders/{id}
 *   transactionData: object[],    Resposta de GET /orders/{id}/transactions
 *   topic:           string,      Tópico do webhook (ex: 'order/paid')
 *   svc?:            object
 * }} params
 * @returns {Promise<{
 *   ok:             boolean,
 *   opportunityId:  string,
 *   leadId:         number,
 *   action:         'created'|'updated'
 * }>}
 */
export async function upsertOrder({ companyId, storeId, orderData, transactionData, topic, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();
  const now = new Date().toISOString();

  const nuvemshopOrderId = String(orderData.id);

  // 1. Garantir lead
  const leadId = await resolveLeadId({
    companyId,
    storeId,
    orderCustomer: orderData.customer,
    svc,
  });

  // 2. Resolver produtos do pedido
  const resolvedItems = await resolveOrderProducts({
    svc,
    companyId,
    orderProducts: orderData.products ?? [],
  });

  // 3. Oportunidade: buscar existente
  const { data: existing, error: lookupErr } = await svc
    .from('opportunities')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('nuvemshop_order_id', nuvemshopOrderId)
    .maybeSingle();

  if (lookupErr) throw new Error(`[orderSync] opportunity_lookup_failed: ${lookupErr.message}`);

  const oppRow = buildOpportunityRow({
    companyId, storeId, leadId, orderData, transactionData, topic, now,
  });

  let opportunityId;
  let action;

  if (existing) {
    // UPDATE
    const { data: updated, error: updateErr } = await svc
      .from('opportunities')
      .update(oppRow)
      .eq('id', existing.id)
      .eq('company_id', companyId)
      .select('id')
      .single();

    if (updateErr) throw new Error(`[orderSync] opportunity_update_failed: ${updateErr.message}`);
    opportunityId = updated.id;
    action        = 'updated';
  } else {
    // INSERT
    const insertRow = { ...oppRow, created_at: now };
    const { data: inserted, error: insertErr } = await svc
      .from('opportunities')
      .insert(insertRow)
      .select('id')
      .single();

    if (insertErr) throw new Error(`[orderSync] opportunity_insert_failed: ${insertErr.message}`);
    opportunityId = inserted.id;
    action        = 'created';

    // ── Posicionar no funil padrão da empresa ─────────────────────────────────
    // Toda oportunidade criada pela integração Nuvemshop deve entrar no funil
    // padrão da empresa (is_default = true) ou no primeiro funil ativo disponível.
    // Sem este registro em opportunity_funnel_positions, a oportunidade fica
    // "flutuante" — visível no banco mas sem funil na UI.
    await positionInDefaultFunnel({ svc, companyId, opportunityId, leadId, now });
  }

  // 4. Sincronizar itens de forma incremental (UUIDs existentes preservados)
  await syncOpportunityItems({ svc, companyId, opportunityId, resolvedItems, now });

  return { ok: true, opportunityId, leadId, action };
}
