// =============================================================================
// GET /api/nuvemshop/tabs/lead
//
// Retorna os dados Nuvemshop de um Lead para exibição na aba "Nuvemshop"
// do modal de Lead no CRM.
//
// Query params:
//   lead_id     string    UUID do lead (obrigatório)
//   company_id  string    UUID da empresa (obrigatório)
//
// ── O que este endpoint retorna ──────────────────────────────────────────────
//   has_nuvemshop       boolean   — se o lead possui vínculo Nuvemshop
//   nuvemshop_customer_id         — ID do cliente na Nuvemshop
//   nuvemshop_store_id            — ID da loja vinculada
//   nuvemshop_checkout_id         — ID do checkout abandonado (se houver)
//   cart_total                    — valor do carrinho (somente leitura)
//   cart_items                    — itens do carrinho (array sanitizado)
//   nuvemshop_sync_status         — status da última sincronização
//   synced_at                     — data da última sincronização do lead
//   store_name                    — nome da loja (join via nuvemshop_connections)
//   integration_status            — 'active' | 'disconnected' | 'none'
//
// ── O que este endpoint NUNCA retorna ────────────────────────────────────────
//   - nuvemshop_checkout_url  (endpoint separado, restrito por role)
//   - access_token (nunca exposto ao frontend)
//   - dados sensíveis de pagamento
//
// Segurança:
//   - JWT obrigatório via Authorization: Bearer
//   - company_id validado contra membership real do usuário
//   - Isolamento multi-tenant: nunca retorna dados de outra empresa
// =============================================================================

import { getSupabaseAdmin }                               from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, VIEW_DATA_ROLES }       from '../../lib/nuvemshop/validateNuvemshopCaller.js';
// VIEW_DATA_ROLES inclui seller — qualquer membro ativo pode ver dados NS em Leads.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { lead_id: leadId, company_id: companyId } = req.query ?? {};

  if (!leadId)    return res.status(400).json({ error: 'lead_id é obrigatório' });
  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const svc = getSupabaseAdmin();

  // ── RBAC: JWT + membership + role ─────────────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: VIEW_DATA_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Buscar dados Nuvemshop do lead ─────────────────────────────────────────
  // Seleciona apenas campos não-sensíveis. checkout_url é excluído.
  const { data: lead, error: leadErr } = await svc
    .from('leads')
    .select(
      'id, nuvemshop_customer_id, nuvemshop_store_id, nuvemshop_checkout_id, ' +
      'cart_total, cart_items, nuvemshop_sync_status, updated_at, company_id',
    )
    .eq('id', leadId)
    .eq('company_id', companyId)  // isolamento multi-tenant
    .maybeSingle();

  if (leadErr) {
    return res.status(500).json({ error: 'Erro ao buscar dados do lead' });
  }
  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado' });
  }

  const hasNuvemshop = !!(lead.nuvemshop_customer_id || lead.nuvemshop_checkout_id);

  if (!hasNuvemshop) {
    return res.status(200).json({
      has_nuvemshop:      false,
      integration_status: 'none',
    });
  }

  // ── Buscar status da integração (para indicar se está ativa ou desconectada) ──
  let integrationStatus = 'none';
  let storeName         = null;

  if (lead.nuvemshop_store_id) {
    const { data: conn } = await svc
      .from('nuvemshop_connections')
      .select('status, store_name')
      .eq('company_id', companyId)
      .eq('nuvemshop_store_id', lead.nuvemshop_store_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conn) {
      integrationStatus = conn.status === 'active' ? 'active' : 'disconnected';
      storeName         = conn.store_name ?? null;
    }
  }

  return res.status(200).json({
    has_nuvemshop:          true,
    integration_status:     integrationStatus,
    store_name:             storeName,
    nuvemshop_customer_id:  lead.nuvemshop_customer_id  ?? null,
    nuvemshop_store_id:     lead.nuvemshop_store_id     ?? null,
    nuvemshop_checkout_id:  lead.nuvemshop_checkout_id  ?? null,
    cart_total:             lead.cart_total              ?? null,
    cart_items:             Array.isArray(lead.cart_items) ? lead.cart_items : [],
    nuvemshop_sync_status:  lead.nuvemshop_sync_status  ?? null,
    synced_at:              lead.updated_at              ?? null,
    // checkout_url: nunca retornado aqui — use GET /api/nuvemshop/tabs/checkout-url
  });
}
