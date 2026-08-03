// =============================================================================
// GET /api/nuvemshop/tabs/opportunity
//
// Retorna os dados Nuvemshop de uma Oportunidade para exibição na aba
// "Nuvemshop" do modal de Oportunidade no CRM.
//
// Query params:
//   opportunity_id  string    UUID da oportunidade (obrigatório)
//   company_id      string    UUID da empresa (obrigatório)
//
// ── O que este endpoint retorna ──────────────────────────────────────────────
//   has_nuvemshop               boolean — se a oportunidade possui vínculo
//   integration_status          'active' | 'disconnected' | 'none'
//   store_name                  string | null
//   nuvemshop_order_id          string | null
//   nuvemshop_store_id          string | null
//   nuvemshop_raw_status        string | null — status bruto da Nuvemshop
//   nuvemshop_sync_status       string | null
//   nuvemshop_fulfillment_status  string | null
//   nuvemshop_tracking_number   string | null
//   nuvemshop_tracking_url      string | null
//   nuvemshop_shipping_carrier  string | null
//   payment_method              string | null — extraído de nuvemshop_payment_data
//   installments                number | null — extraído de nuvemshop_payment_data
//   brand                       string | null — extraído de nuvemshop_payment_data
//   captured_amount             number | null — extraído de nuvemshop_payment_data
//   timeline                    array  — eventos da integração na timeline
//
// ── O que este endpoint NUNCA retorna ────────────────────────────────────────
//   - nuvemshop_payment_data raw completo (JSONB não exposto diretamente)
//   - número completo de cartão, CVV, tokens
//   - access_token
//   - payloads brutos da Nuvemshop
//
// Segurança:
//   - JWT obrigatório via Authorization: Bearer
//   - company_id validado contra membership real do usuário
//   - Isolamento multi-tenant garantido por .eq('company_id', companyId)
// =============================================================================

import { getSupabaseAdmin }                               from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, VIEW_DATA_ROLES }       from '../../lib/nuvemshop/validateNuvemshopCaller.js';
// VIEW_DATA_ROLES inclui seller — qualquer membro ativo pode ver dados NS em Oportunidades.

// Campos seguros extraídos de nuvemshop_payment_data
const SAFE_PAYMENT_FIELDS = ['payment_method', 'installments', 'brand', 'captured_amount'];

function extractSafePaymentFields(paymentData) {
  if (!paymentData || typeof paymentData !== 'object') {
    return { payment_method: null, installments: null, brand: null, captured_amount: null };
  }
  return {
    payment_method:  paymentData.payment_method  ?? null,
    installments:    paymentData.installments    ?? null,
    brand:           paymentData.brand           ?? null,
    captured_amount: paymentData.captured_amount ?? null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const {
    opportunity_id: opportunityId,
    company_id:     companyId,
  } = req.query ?? {};

  if (!opportunityId) return res.status(400).json({ error: 'opportunity_id é obrigatório' });
  if (!companyId)     return res.status(400).json({ error: 'company_id é obrigatório' });

  const svc = getSupabaseAdmin();

  // ── RBAC: JWT + membership + role ─────────────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: VIEW_DATA_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Buscar dados Nuvemshop da oportunidade ─────────────────────────────────
  const { data: opp, error: oppErr } = await svc
    .from('opportunities')
    .select(
      'id, company_id, nuvemshop_order_id, nuvemshop_store_id, nuvemshop_raw_status, ' +
      'nuvemshop_sync_status, nuvemshop_payment_data, ' +
      'nuvemshop_fulfillment_status, nuvemshop_tracking_number, ' +
      'nuvemshop_tracking_url, nuvemshop_shipping_carrier',
    )
    .eq('id', opportunityId)
    .eq('company_id', companyId)  // isolamento multi-tenant
    .maybeSingle();

  if (oppErr) {
    return res.status(500).json({ error: 'Erro ao buscar dados da oportunidade' });
  }
  if (!opp) {
    return res.status(404).json({ error: 'Oportunidade não encontrada' });
  }

  const hasNuvemshop = !!opp.nuvemshop_order_id;

  if (!hasNuvemshop) {
    return res.status(200).json({
      has_nuvemshop:      false,
      integration_status: 'none',
    });
  }

  // ── Status da integração ──────────────────────────────────────────────────
  let integrationStatus = 'none';
  let storeName         = null;

  if (opp.nuvemshop_store_id) {
    const { data: conn } = await svc
      .from('nuvemshop_connections')
      .select('status, store_name')
      .eq('company_id', companyId)
      .eq('nuvemshop_store_id', opp.nuvemshop_store_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conn) {
      integrationStatus = conn.status === 'active' ? 'active' : 'disconnected';
      storeName         = conn.store_name ?? null;
    }
  }

  // ── Timeline de eventos da integração ────────────────────────────────────
  // Busca apenas eventos gerados pela integração Nuvemshop (com idempotency_key)
  const { data: timelineRaw } = await svc
    .from('opportunity_timeline_events')
    .select('id, event_type, metadata, created_at, idempotency_key')
    .eq('opportunity_id', opportunityId)
    .not('idempotency_key', 'is', null)      // apenas eventos da integração
    .order('created_at', { ascending: true })
    .limit(50);

  const timeline = (timelineRaw ?? []).map((evt) => ({
    id:             evt.id,
    event_type:     evt.event_type,
    label:          evt.metadata?.label                   ?? evt.event_type,
    tracking_number: evt.metadata?.tracking_number        ?? null,
    carrier:        evt.metadata?.carrier                 ?? null,
    raw_status:     evt.metadata?.raw_fulfillment_status  ?? null,
    occurred_at:    evt.metadata?.external_event_time     ?? evt.created_at,
    created_at:     evt.created_at,
  }));

  // ── Extrair campos seguros de pagamento ───────────────────────────────────
  const safePayment = extractSafePaymentFields(opp.nuvemshop_payment_data);

  return res.status(200).json({
    has_nuvemshop:              true,
    integration_status:         integrationStatus,
    store_name:                 storeName,
    nuvemshop_order_id:         opp.nuvemshop_order_id         ?? null,
    nuvemshop_store_id:         opp.nuvemshop_store_id         ?? null,
    nuvemshop_raw_status:       opp.nuvemshop_raw_status       ?? null,
    nuvemshop_sync_status:      opp.nuvemshop_sync_status      ?? null,
    nuvemshop_fulfillment_status: opp.nuvemshop_fulfillment_status ?? null,
    nuvemshop_tracking_number:  opp.nuvemshop_tracking_number  ?? null,
    nuvemshop_tracking_url:     opp.nuvemshop_tracking_url     ?? null,
    nuvemshop_shipping_carrier: opp.nuvemshop_shipping_carrier ?? null,
    ...safePayment,
    timeline,
    // nuvemshop_payment_data: NUNCA retornado — apenas campos extraídos acima
  });
}
