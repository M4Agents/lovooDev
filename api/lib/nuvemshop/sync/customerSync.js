// =============================================================================
// customerSync — Sync Service de Clientes/Leads Nuvemshop
//
// Responsabilidade exclusiva: operações de escrita em leads.
// Não faz chamadas à API Nuvemshop (responsabilidade do Handler).
//
// ── Deduplicação (Plano v5.1 — ordem obrigatória) ────────────────────────────
// Cada lookup é sempre scoped por company_id.
//
//   1. nuvemshop_customer_id → fonte autoritativa
//   2. email                 → candidato (se sem vínculo com outro customer_id)
//   3. phone_normalized      → candidato (se sem vínculo com outro customer_id)
//   4. Nenhum match          → INSERT
//
// Regra de proteção anti-colisão:
//   Se o lead encontrado por email ou telefone já tem um nuvemshop_customer_id
//   DIFERENTE do cliente atual, o lead NÃO é atualizado.
//   Um novo lead separado é criado para evitar que dois clientes Nuvemshop
//   distintos sejam fundidos no mesmo lead do CRM.
//
// ── Política de merge ─────────────────────────────────────────────────────────
// Ao vincular um lead existente ao cliente Nuvemshop:
//   - Campos Nuvemshop (customer_id, store_id, sync_status): SEMPRE sobrescritos
//   - origin: NUNCA sobrescrito — preservar a origem original do lead
//   - Dados de contato (name, phone, email): preenchidos apenas se null/genérico
//   - document, marketing_opt_in: preenchidos apenas se ainda null
//   - Endereço: NÃO persistido nos campos company_* (semanticamente incorretos)
//
// ── LGPD ─────────────────────────────────────────────────────────────────────
// - document (CPF/CNPJ): nunca logar o valor
// - marketing_opt_in: nunca inferir; persistir apenas quando retornado explicitamente
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';

const GENERIC_NAMES = new Set(['lead', 'lead sem nome', 'lead sem nome', 'unknown', 'usuário']);

function isGenericName(name) {
  return !name || GENERIC_NAMES.has(name.toLowerCase().trim());
}

// ── Normalização ───────────────────────────────────────────────────────────────

function extractPhone(customer) {
  const raw = customer.phone || customer.mobile || null;
  return raw?.trim() || null;
}

// ── Deduplicação ──────────────────────────────────────────────────────────────

const LEAD_SELECT_FIELDS = 'id, company_id, name, email, phone, document, marketing_opt_in, nuvemshop_customer_id';

/**
 * Busca lead existente pela ordem de deduplicação do Plano v5.1.
 *
 * Regra de proteção: se o lead encontrado por email ou telefone já possui
 * um nuvemshop_customer_id DIFERENTE, ele é descartado como candidato.
 * Isso impede que dois clientes Nuvemshop sejam fundidos no mesmo lead CRM.
 *
 * @returns {Promise<{ lead: object|null, matchedBy: string|null, blocked: boolean }>}
 *   blocked = true indica que o lead encontrado pertence a outro customer_id
 */
async function findExistingLead({ svc, companyId, nuvemshopCustomerId, email, phone }) {
  // 1. Por nuvemshop_customer_id (fonte autoritativa — sem verificação de colisão)
  {
    const { data } = await svc
      .from('leads')
      .select(LEAD_SELECT_FIELDS)
      .eq('company_id', companyId)
      .eq('nuvemshop_customer_id', nuvemshopCustomerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (data) return { lead: data, matchedBy: 'nuvemshop_customer_id', blocked: false };
  }

  // 2. Por email
  if (email) {
    const { data } = await svc
      .from('leads')
      .select(LEAD_SELECT_FIELDS)
      .eq('company_id', companyId)
      .eq('email', email)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (data) {
      // Proteção: lead já vinculado a outro customer_id → bloquear fusão
      if (data.nuvemshop_customer_id && data.nuvemshop_customer_id !== nuvemshopCustomerId) {
        return { lead: null, matchedBy: 'email_blocked', blocked: true };
      }
      return { lead: data, matchedBy: 'email', blocked: false };
    }
  }

  // 3. Por phone_normalized (coluna gerada: REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
  if (phone) {
    const phoneNorm = phone.replace(/\D/g, '');
    if (phoneNorm.length >= 8) {
      const { data } = await svc
        .from('leads')
        .select(LEAD_SELECT_FIELDS)
        .eq('company_id', companyId)
        .eq('phone_normalized', phoneNorm)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (data) {
        // Proteção: lead já vinculado a outro customer_id → bloquear fusão
        if (data.nuvemshop_customer_id && data.nuvemshop_customer_id !== nuvemshopCustomerId) {
          return { lead: null, matchedBy: 'phone_blocked', blocked: true };
        }
        return { lead: data, matchedBy: 'phone_normalized', blocked: false };
      }
    }
  }

  return { lead: null, matchedBy: null, blocked: false };
}

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Campos novos → INSERT.
 * origin = 'nuvemshop' somente aqui (lead criado pela integração).
 */
function buildNewLeadRow({ companyId, storeId, nuvemshopCustomerId, customer, now }) {
  return {
    company_id:  companyId,
    name:        customer.name?.trim() || 'Lead',
    email:       customer.email?.trim() || null,
    phone:       extractPhone(customer),
    origin:      'nuvemshop',      // Apenas para leads criados pela integração
    status:      'novo',
    document:    customer.identification?.trim() || null,

    marketing_opt_in: typeof customer.accepts_marketing === 'boolean'
      ? customer.accepts_marketing
      : null,

    // Endereço: não persistido em campos company_* (semanticamente incorretos para
    // endereço pessoal de cliente Nuvemshop). Campo reservado para dados da empresa do lead.

    nuvemshop_customer_id: nuvemshopCustomerId,
    nuvemshop_store_id:    storeId,
    nuvemshop_sync_status: 'synced',
    created_at:            now,
    updated_at:            now,
  };
}

/**
 * Campos de atualização → UPDATE de lead existente.
 * origin: NUNCA sobrescrito.
 * Dados de contato: preenchidos apenas se null ou genérico no CRM.
 */
function buildMergeUpdateRow({ existingLead, storeId, nuvemshopCustomerId, customer }) {
  const now   = new Date().toISOString();
  const phone = extractPhone(customer);

  const row = {
    nuvemshop_customer_id: nuvemshopCustomerId,
    nuvemshop_store_id:    storeId,
    nuvemshop_sync_status: 'synced',
    updated_at:            now,
    // origin NÃO incluído → preservado como está no CRM
  };

  // Name: atualiza se genérico no CRM
  const nsName = customer.name?.trim();
  if (nsName && isGenericName(existingLead.name)) row.name = nsName;

  // Email: preenche se null no CRM
  const nsEmail = customer.email?.trim() || null;
  if (nsEmail && !existingLead.email) row.email = nsEmail;

  // Telefone: preenche se null no CRM
  if (phone && !existingLead.phone) row.phone = phone;

  // document: preenche apenas se null (LGPD)
  if (!existingLead.document && customer.identification?.trim()) {
    row.document = customer.identification.trim();
  }

  // marketing_opt_in: preenche apenas se null
  if ((existingLead.marketing_opt_in === null || existingLead.marketing_opt_in === undefined)
      && typeof customer.accepts_marketing === 'boolean') {
    row.marketing_opt_in = customer.accepts_marketing;
  }

  // Endereço: não persistido em company_* (ver nota em buildNewLeadRow)

  return row;
}

// ── upsertCustomer ────────────────────────────────────────────────────────────

/**
 * Cria ou vincula um lead a um cliente Nuvemshop.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   customerData: object,
 *   svc?:         object
 * }} params
 * @returns {Promise<{
 *   ok:        boolean,
 *   leadId:    number,
 *   action:    'created'|'updated'|'created_collision_blocked',
 *   matchedBy: string|null
 * }>}
 */
export async function upsertCustomer({ companyId, storeId, customerData, svc: _svc }) {
  const svc                = _svc ?? getSupabaseAdmin();
  const nuvemshopCustomerId = String(customerData.id);
  const now                = new Date().toISOString();
  const email              = customerData.email?.trim() || null;
  const phone              = extractPhone(customerData);

  // ── Deduplicação ──────────────────────────────────────────────────────────
  const { lead: existing, matchedBy, blocked } = await findExistingLead({
    svc, companyId, nuvemshopCustomerId, email, phone,
  });

  // ── Colisão detectada: criar lead novo separado ───────────────────────────
  // Leads com nuvemshop_customer_id diferente não são fundidos.
  if (blocked) {
    console.warn(JSON.stringify({
      level:                'warn',
      event:                'customer_dedup_collision_blocked',
      company_id:           companyId,
      nuvemshop_customer_id: nuvemshopCustomerId,
      matched_by:           matchedBy,
      resolution:           'creating_separate_lead',
    }));

    const newRow = buildNewLeadRow({ companyId, storeId, nuvemshopCustomerId, customer: customerData, now });
    const { data: ins, error: insErr } = await svc.from('leads').insert(newRow).select('id').single();
    if (insErr) throw new Error(`[customerSync] collision_insert_failed: ${insErr.message}`);
    return { ok: true, leadId: ins.id, action: 'created_collision_blocked', matchedBy };
  }

  // ── UPDATE lead existente ─────────────────────────────────────────────────
  if (existing) {
    if (existing.company_id !== companyId) {
      throw new Error(`[customerSync] company_mismatch: lead ${existing.id} não pertence à empresa ${companyId}`);
    }

    const updateRow = buildMergeUpdateRow({ existingLead: existing, storeId, nuvemshopCustomerId, customer: customerData });

    const { data: updated, error } = await svc
      .from('leads')
      .update(updateRow)
      .eq('id', existing.id)
      .eq('company_id', companyId)
      .select('id')
      .single();

    if (error) throw new Error(`[customerSync] update_failed: ${error.message}`);
    return { ok: true, leadId: updated.id, action: 'updated', matchedBy };
  }

  // ── INSERT novo lead ──────────────────────────────────────────────────────
  const newRow = buildNewLeadRow({ companyId, storeId, nuvemshopCustomerId, customer: customerData, now });
  const { data: inserted, error: insertErr } = await svc.from('leads').insert(newRow).select('id').single();
  if (insertErr) throw new Error(`[customerSync] insert_failed: ${insertErr.message}`);
  return { ok: true, leadId: inserted.id, action: 'created', matchedBy: null };
}
