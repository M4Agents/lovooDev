// =============================================================================
// fulfillmentSync — Sync Service de Fulfillment de Pedidos Nuvemshop
//
// Responsabilidades:
//   1. Localizar a oportunidade pelo nuvemshop_order_id
//   2. Atualizar campos de rastreamento (tracking) e status via statusMapper
//   3. Registrar evento idempotente na timeline da oportunidade
//
// ── Restrições obrigatórias (Plano v5.1) ─────────────────────────────────────
// NUNCA alterar:
//   - value           (valor financeiro da oportunidade)
//   - lead_id         (vínculo com o lead)
//   - opportunity_items (itens da oportunidade)
//
// ── Status ───────────────────────────────────────────────────────────────────
// Exclusivamente via statusMapper.mapOrderStatusToCrm().
//   order/fulfilled → 'won'    (override: entrega concluída = ciclo encerrado)
//   order/packed    → status derivado de order.status (geralmente 'open')
//
// ── Timeline (idempotente) ───────────────────────────────────────────────────
// Chave de idempotência: 'nuvemshop:{order_id}:{event_type}'
// Inserção via ON CONFLICT DO NOTHING — events duplicados são silenciosamente
// ignorados sem lançar erro.
//
// Campos da timeline:
//   event_type:  'order_packed' | 'order_fulfilled'
//   metadata:    { label, tracking_number?, tracking_url?, carrier?,
//                  nuvemshop_order_id, store_id, raw_fulfillment_status }
//   actor_id:    null (evento gerado pelo sistema, não por usuário)
//
// ── Dados de rastreamento ─────────────────────────────────────────────────────
// Persistidos na oportunidade apenas quando presentes na API:
//   nuvemshop_tracking_number  → order.shipping_tracking_number
//   nuvemshop_tracking_url     → order.shipping_tracking_url
//   nuvemshop_shipping_carrier → order.shipping_carrier_name
//   nuvemshop_fulfillment_status → order.fulfillment_status (bruto)
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import {
  mapOrderStatusToCrm,
  mapFulfillmentTopicToTimeline,
  isClosed,
} from '../statusMapper.js';

// ── Utilitários ───────────────────────────────────────────────────────────────

/**
 * Valida e sanitiza uma URL de rastreamento antes da persistência.
 *
 * Aceita apenas protocolos http/https.
 * Retorna null e loga warning para URLs inválidas (evita persistir lixo).
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function sanitizeTrackingUrl(url) {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn(JSON.stringify({
        level:      'warn',
        event:      'fulfillment_tracking_url_invalid_protocol',
        protocol:   parsed.protocol,
        resolution: 'url_discarded',
      }));
      return null;
    }
    return parsed.toString();
  } catch {
    console.warn(JSON.stringify({
      level:      'warn',
      event:      'fulfillment_tracking_url_parse_error',
      resolution: 'url_discarded',
      // Nunca logar a URL bruta (pode conter dados sensíveis)
    }));
    return null;
  }
}

// ── Localização da oportunidade ───────────────────────────────────────────────

/**
 * Busca oportunidade pelo nuvemshop_order_id dentro do contexto da empresa.
 * Fulfillment sem oportunidade correspondente é um evento legítimo (pedido
 * processado antes da sincronização inicial). Retorna null e loga warning.
 *
 * @returns {Promise<object|null>}
 */
async function findOpportunity({ svc, companyId, nuvemshopOrderId }) {
  const { data, error } = await svc
    .from('opportunities')
    .select('id, status, nuvemshop_tracking_number')
    .eq('company_id', companyId)
    .eq('nuvemshop_order_id', nuvemshopOrderId)
    .maybeSingle();

  if (error) throw new Error(`[fulfillmentSync] opportunity_lookup_failed: ${error.message}`);
  return data ?? null;
}

// ── Atualização da oportunidade ───────────────────────────────────────────────

/**
 * Monta os campos de rastreamento a partir dos dados do pedido.
 * Inclui apenas campos de tracking e status — nunca valor, lead ou itens.
 */
function buildFulfillmentUpdateRow({ orderData, topic }) {
  const crmStatus = mapOrderStatusToCrm({
    topic,
    orderStatus:   orderData.status,
    paymentStatus: orderData.payment_status,
  });
  const closed     = isClosed(crmStatus);
  const now        = new Date().toISOString();

  const row = {
    status:                    crmStatus,
    nuvemshop_sync_status:     'synced',
    nuvemshop_raw_status:      orderData.status            ?? null,
    nuvemshop_fulfillment_status: orderData.fulfillment_status ?? null,
    updated_at:                now,
    ...(closed ? { closed_at: now, actual_close_date: now.slice(0, 10) } : {}),
    // NUNCA incluir: value, lead_id, itens (restrição obrigatória do plano)
  };

  // Rastreamento: persiste somente quando presente e válido
  const trackingNumber = orderData.shipping_tracking_number?.trim() || null;
  const trackingUrl    = sanitizeTrackingUrl(orderData.shipping_tracking_url);  // validação obrigatória
  const carrier        = orderData.shipping_carrier_name?.trim()    || null;

  if (trackingNumber !== null) row.nuvemshop_tracking_number  = trackingNumber;
  if (trackingUrl    !== null) row.nuvemshop_tracking_url     = trackingUrl;
  if (carrier        !== null) row.nuvemshop_shipping_carrier = carrier;

  return row;
}

// ── Timeline idempotente ──────────────────────────────────────────────────────

/**
 * Insere evento na timeline da oportunidade de forma idempotente.
 * ON CONFLICT DO NOTHING garante que reprocessamentos do mesmo webhook
 * não geram registros duplicados.
 *
 * Chave de idempotência: 'nuvemshop:{order_id}:{event_type}'
 */
async function insertTimelineEvent({ svc, companyId, opportunityId, orderData, topic }) {
  const { eventType, label } = mapFulfillmentTopicToTimeline(topic);

  const trackingNumber   = orderData.shipping_tracking_number?.trim() || null;
  const trackingUrl      = sanitizeTrackingUrl(orderData.shipping_tracking_url);
  const carrier          = orderData.shipping_carrier_name?.trim()    || null;

  // external_event_time: timestamp original do evento na Nuvemshop.
  // Preserva a cronologia real dos eventos, independente de quando o
  // webhook foi processado pelo worker. Permite ordenação fiel da timeline.
  const externalEventTime = orderData.updated_at ?? null;

  const metadata = {
    label,
    nuvemshop_order_id:     String(orderData.id),
    store_id:               orderData.store_id          ?? null,
    raw_fulfillment_status: orderData.fulfillment_status ?? null,
    external_event_time:    externalEventTime,            // timestamp original Nuvemshop
    // Rastreamento (incluído apenas quando disponível e válido)
    ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
    ...(trackingUrl    ? { tracking_url:    trackingUrl    } : {}),
    ...(carrier        ? { carrier                          } : {}),
  };

  const idempotencyKey = `nuvemshop:${orderData.id}:${eventType}`;

  // Tentativa de insert — conflito silencioso se a chave já existir
  const { error } = await svc
    .from('opportunity_timeline_events')
    .insert({
      company_id:      companyId,
      opportunity_id:  opportunityId,
      event_type:      eventType,
      actor_id:        null,      // evento de sistema
      metadata,
      idempotency_key: idempotencyKey,
    });

  if (error) {
    // Código 23505 = unique_violation → evento já registrado (idempotência OK)
    if (error.code === '23505') return { inserted: false, reason: 'already_exists' };
    throw new Error(`[fulfillmentSync] timeline_insert_failed: ${error.message}`);
  }

  return { inserted: true };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Atualiza uma oportunidade com dados de fulfillment e registra evento na timeline.
 *
 * Se a oportunidade não for encontrada (pedido ainda não sincronizado),
 * loga um warning e retorna sem erro — a reconciliação resolverá posteriormente.
 *
 * @param {{
 *   companyId:  string,
 *   storeId:    string,
 *   orderData:  object,   Resposta de GET /orders/{id}
 *   topic:      string,   'order/packed' | 'order/fulfilled'
 *   svc?:       object
 * }} params
 * @returns {Promise<{
 *   ok:            boolean,
 *   opportunityId: string|null,
 *   timelineInserted: boolean,
 *   skipped?:      boolean
 * }>}
 */
export async function upsertFulfillment({ companyId, storeId, orderData, topic, svc: _svc }) {
  const svc              = _svc ?? getSupabaseAdmin();
  const nuvemshopOrderId = String(orderData.id);

  // 1. Localizar oportunidade
  const opportunity = await findOpportunity({ svc, companyId, nuvemshopOrderId });

  if (!opportunity) {
    console.warn(JSON.stringify({
      level:              'warn',
      event:              'fulfillment_opportunity_not_found',
      company_id:         companyId,
      nuvemshop_order_id: nuvemshopOrderId,
      topic,
      resolution:         'skip_reconciliation_will_resolve',
    }));
    return { ok: true, opportunityId: null, timelineInserted: false, skipped: true };
  }

  // 2. Atualizar oportunidade (tracking + status — nunca value/lead/itens)
  const updateRow = buildFulfillmentUpdateRow({ orderData, topic });

  const { error: updateErr } = await svc
    .from('opportunities')
    .update(updateRow)
    .eq('id', opportunity.id)
    .eq('company_id', companyId);

  if (updateErr) throw new Error(`[fulfillmentSync] opportunity_update_failed: ${updateErr.message}`);

  // 3. Registrar evento idempotente na timeline
  const timelineResult = await insertTimelineEvent({
    svc, companyId,
    opportunityId: opportunity.id,
    orderData,
    topic,
  });

  return {
    ok:               true,
    opportunityId:    opportunity.id,
    timelineInserted: timelineResult.inserted,
  };
}
