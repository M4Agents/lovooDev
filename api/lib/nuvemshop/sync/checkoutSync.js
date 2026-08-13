// =============================================================================
// checkoutSync — Sync Service de Carrinhos Abandonados Nuvemshop
//
// Responsabilidade exclusiva: operações de escrita em leads para checkouts.
// Não faz chamadas à API Nuvemshop (responsabilidade do Handler).
//
// ── Deduplicação (ordem obrigatória) ─────────────────────────────────────────
// Cada lookup é sempre scoped por company_id.
//
//   1. nuvemshop_checkout_id   → fonte autoritativa do checkout
//   2. nuvemshop_customer_id   → cliente já sincronizado
//   3. email                   → candidato (se sem vínculo com outro checkout)
//   4. phone_normalized        → candidato (se sem vínculo com outro checkout)
//   5. Nenhum match            → INSERT
//
// Mesma política de proteção anti-colisão do customerSync:
//   Se o lead encontrado por email ou telefone já tem um nuvemshop_checkout_id
//   DIFERENTE do checkout atual, o lead NÃO é atualizado.
//   Um novo lead separado é criado para evitar fusão indevida.
//
// ── Segurança do abandoned_checkout_url ──────────────────────────────────────
// ⚠️  DADO SENSÍVEL. Regras obrigatórias:
//   - NUNCA incluir em logs (nem warn, nem debug, nem info)
//   - NUNCA retornar em APIs de listagem
//   - Persistido apenas no banco (coluna nuvemshop_checkout_url)
//   - Acesso via aba Nuvemshop do lead, para usuários autorizados
//   - Referenciado em automações por checkout_id, nunca pela URL diretamente
//
// ── origin ────────────────────────────────────────────────────────────────────
//   'nuvemshop_abandoned' → apenas para leads criados pela integração de checkout.
//   Leads existentes têm origin preservado.
//
// ── Checkout convertido em pedido ────────────────────────────────────────────
// Quando o visitante conclui a compra após um checkout abandonado, a Nuvemshop
// dispara order/created com o mesmo customer.id do checkout.
// O orderSync.resolveLeadId chama upsertCustomer, que encontra o lead já
// criado por este módulo (via nuvemshop_customer_id ou email) e o reutiliza.
// Nenhum novo lead é criado — apenas a Oportunidade é vinculada ao lead existente.
// O nuvemshop_checkout_id permanece no lead como histórico do ciclo de vida.
//
// ── Gatilho de automação ─────────────────────────────────────────────────────
// O resultado de upsertCheckout inclui os dados mínimos para o engine de
// automações disparar 'checkout_abandoned'. O handler é responsável por usar
// esses dados para enfileirar o gatilho.
// Não implementado nesta fase: fluxo de WhatsApp/IA.
// checkout_url NUNCA trafega entre módulos — acesso exclusivo pelo banco.
// =============================================================================

import { getSupabaseAdmin }           from '../../automation/supabaseAdmin.js';
import { tryEnrichLeadAttribution } from './attributionSync.js';

// ── Sanitização de cart_items ─────────────────────────────────────────────────

/**
 * Extrai snapshot seguro dos itens do carrinho.
 * Remove qualquer dado financeiro sensível. Nunca inclui checkout_url.
 *
 * @param {Array} lineItems  Itens do checkout (line_items da API)
 * @returns {Array}
 */
function sanitizeCartItems(lineItems, currency) {
  if (!Array.isArray(lineItems)) return [];

  return lineItems.map(item => ({
    product_id: item.product_id  ?? null,
    variant_id: item.variant_id  ?? null,
    name:       item.name        || null,
    sku:        item.sku         || null,
    quantity:   Number(item.quantity) || 1,
    price:      Number(item.price)    || 0,
    currency:   currency              || null,  // moeda do checkout (ex: 'BRL')
  }));
}

// ── Deduplicação ──────────────────────────────────────────────────────────────

const LEAD_SELECT_FIELDS =
  'id, company_id, nuvemshop_checkout_id, nuvemshop_customer_id, email, phone';

/**
 * Busca lead existente seguindo a ordem de deduplicação de checkout.
 *
 * @returns {Promise<{ lead: object|null, matchedBy: string|null, blocked: boolean }>}
 *   blocked = true → lead encontrado pertence a outro checkout/customer
 */
async function findExistingLeadForCheckout({
  svc, companyId, nuvemshopCheckoutId, nuvemshopCustomerId, email, phone,
}) {
  // 1. Por nuvemshop_checkout_id (fonte autoritativa — mesmo checkout reprocessado)
  if (nuvemshopCheckoutId) {
    const { data } = await svc
      .from('leads')
      .select(LEAD_SELECT_FIELDS)
      .eq('company_id', companyId)
      .eq('nuvemshop_checkout_id', nuvemshopCheckoutId)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return { lead: data, matchedBy: 'nuvemshop_checkout_id', blocked: false };
  }

  // 2. Por nuvemshop_customer_id (cliente já sincronizado)
  if (nuvemshopCustomerId) {
    const { data } = await svc
      .from('leads')
      .select(LEAD_SELECT_FIELDS)
      .eq('company_id', companyId)
      .eq('nuvemshop_customer_id', nuvemshopCustomerId)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return { lead: data, matchedBy: 'nuvemshop_customer_id', blocked: false };
  }

  // 3. Por email
  if (email) {
    const { data } = await svc
      .from('leads')
      .select(LEAD_SELECT_FIELDS)
      .eq('company_id', companyId)
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (data) {
      // Proteção: lead já vinculado a checkout ou customer diferente
      const hasOtherCheckout  = data.nuvemshop_checkout_id
        && data.nuvemshop_checkout_id !== nuvemshopCheckoutId;
      const hasOtherCustomer  = nuvemshopCustomerId
        && data.nuvemshop_customer_id
        && data.nuvemshop_customer_id !== nuvemshopCustomerId;

      if (hasOtherCheckout || hasOtherCustomer) {
        return { lead: null, matchedBy: 'email_blocked', blocked: true };
      }
      return { lead: data, matchedBy: 'email', blocked: false };
    }
  }

  // 4. Por phone_normalized
  if (phone) {
    const phoneNorm = phone.replace(/\D/g, '');
    if (phoneNorm.length >= 8) {
      const { data } = await svc
        .from('leads')
        .select(LEAD_SELECT_FIELDS)
        .eq('company_id', companyId)
        .eq('phone_normalized', phoneNorm)
        .is('deleted_at', null)
        .maybeSingle();

      if (data) {
        const hasOtherCheckout = data.nuvemshop_checkout_id
          && data.nuvemshop_checkout_id !== nuvemshopCheckoutId;
        const hasOtherCustomer = nuvemshopCustomerId
          && data.nuvemshop_customer_id
          && data.nuvemshop_customer_id !== nuvemshopCustomerId;

        if (hasOtherCheckout || hasOtherCustomer) {
          return { lead: null, matchedBy: 'phone_blocked', blocked: true };
        }
        return { lead: data, matchedBy: 'phone_normalized', blocked: false };
      }
    }
  }

  return { lead: null, matchedBy: null, blocked: false };
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildCheckoutFields({ storeId, checkoutData, nuvemshopCustomerId, cartItems }) {
  return {
    nuvemshop_store_id:    storeId,
    nuvemshop_checkout_id: String(checkoutData.id),
    nuvemshop_checkout_url: checkoutData.abandoned_checkout_url ?? null,  // SENSÍVEL — não logar
    // API usa `total` (inclui frete), não `total_price`
    cart_total:            checkoutData.total != null
      ? parseFloat(checkoutData.total) || null
      : null,
    cart_items:            cartItems.length > 0 ? cartItems : null,
    nuvemshop_sync_status: 'synced',
    ...(nuvemshopCustomerId ? { nuvemshop_customer_id: nuvemshopCustomerId } : {}),
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza um lead a partir de um checkout abandonado Nuvemshop.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   checkoutData: object,   Dados do checkout (GET /checkouts/{id} ou webhook payload)
 *   svc?:         object
 * }} params
 * @returns {Promise<{
 *   ok:         boolean,
 *   leadId:     number,
 *   action:     'created'|'updated'|'created_collision_blocked',
 *   matchedBy:  string|null,
 *   checkoutId: string,
 *   cartTotal:  number|null
 * }>}
 */
export async function upsertCheckout({ companyId, storeId, checkoutData, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();
  const now = new Date().toISOString();

  const nuvemshopCheckoutId  = String(checkoutData.id);
  const nuvemshopCustomerId  = checkoutData.customer?.id
    ? String(checkoutData.customer.id)
    : null;

  // Dados de contato — a API de checkouts usa contact_* no root do objeto.
  // customer.* só é populado quando o visitante tem conta e está logado.
  const email = (checkoutData.contact_email ?? checkoutData.customer?.email ?? '').trim() || null;
  const phone = (checkoutData.contact_phone ?? checkoutData.customer?.phone ?? '').trim() || null;
  const name  = (checkoutData.contact_name  ?? checkoutData.customer?.name  ?? '').trim() || null;
  const currency  = checkoutData.currency ?? null;
  // A API retorna itens em `products`, não em `line_items`
  const cartItems = sanitizeCartItems(checkoutData.products ?? checkoutData.line_items, currency);
  const checkoutFields = buildCheckoutFields({
    storeId, checkoutData, nuvemshopCustomerId, cartItems,
  });

  // ── Deduplicação ─────────────────────────────────────────────────────────
  const { lead: existing, matchedBy, blocked } = await findExistingLeadForCheckout({
    svc, companyId,
    nuvemshopCheckoutId,
    nuvemshopCustomerId,
    email,
    phone,
  });

  // ── Colisão detectada: criar lead novo separado ───────────────────────────
  if (blocked) {
    console.warn(JSON.stringify({
      level:                   'warn',
      event:                   'checkout_dedup_collision_blocked',
      company_id:              companyId,
      nuvemshop_checkout_id:   nuvemshopCheckoutId,
      nuvemshop_customer_id:   nuvemshopCustomerId,
      matched_by:              matchedBy,
      resolution:              'creating_separate_lead',
      // Nunca logar: abandoned_checkout_url
    }));

    const newRow = {
      company_id:   companyId,
      name:         name || 'Lead',
      email,
      phone,
      origin:       'nuvemshop_abandoned',
      status:       'novo',
      ...checkoutFields,
      created_at:   now,
      updated_at:   now,
    };
    const { data: ins, error } = await svc.from('leads').insert(newRow).select('id').single();
    if (error) throw new Error(`[checkoutSync] collision_insert_failed: ${error.message}`);
    await tryEnrichLeadAttribution({ companyId, leadId: ins.id, email, phone, svc }).catch(() => {});
    return {
      ok: true, leadId: ins.id, action: 'created_collision_blocked', matchedBy,
      checkoutId: nuvemshopCheckoutId, cartTotal: checkoutFields.cart_total,
    };
  }

  // ── UPDATE lead existente ─────────────────────────────────────────────────
  if (existing) {
    if (existing.company_id !== companyId) {
      throw new Error(`[checkoutSync] company_mismatch: lead ${existing.id} não pertence à empresa ${companyId}`);
    }

    const updateRow = {
      ...checkoutFields,
      // Preservar origin original — não sobrescrever com 'nuvemshop_abandoned'
      // Atualizar apenas dados de contato se null no CRM
      ...(!existing.email && email ? { email } : {}),
      ...(!existing.phone && phone ? { phone } : {}),
      updated_at: now,
    };

    const { data: updated, error } = await svc
      .from('leads')
      .update(updateRow)
      .eq('id', existing.id)
      .eq('company_id', companyId)
      .select('id')
      .single();

    if (error) throw new Error(`[checkoutSync] update_failed: ${error.message}`);
    await tryEnrichLeadAttribution({ companyId, leadId: updated.id, email, phone, svc }).catch(() => {});
    return {
      ok: true, leadId: updated.id, action: 'updated', matchedBy,
      checkoutId: nuvemshopCheckoutId, cartTotal: checkoutFields.cart_total,
    };
  }

  // ── INSERT novo lead ──────────────────────────────────────────────────────
  const newRow = {
    company_id:   companyId,
    name:         name || 'Lead',
    email,
    phone,
    origin:       'nuvemshop_abandoned',   // Apenas para leads criados pelo checkout
    status:       'novo',
    ...checkoutFields,
    created_at:   now,
    updated_at:   now,
  };
  const { data: inserted, error: insertErr } = await svc
    .from('leads')
    .insert(newRow)
    .select('id')
    .single();

  if (insertErr) throw new Error(`[checkoutSync] insert_failed: ${insertErr.message}`);
  await tryEnrichLeadAttribution({ companyId, leadId: inserted.id, email, phone, svc }).catch(() => {});
  return {
    ok: true, leadId: inserted.id, action: 'created', matchedBy: null,
    checkoutId: nuvemshopCheckoutId, cartTotal: checkoutFields.cart_total,
  };
}
