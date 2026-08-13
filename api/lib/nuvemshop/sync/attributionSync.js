// =============================================================================
// attributionSync — Consumer de Conversion Signals para Leads Nuvemshop
//
// Responsabilidade: tentar enriquecer o lead com visitor_id e UTMs via
// conversion_signal pendente, após qualquer upsert de lead Nuvemshop.
//
// Fluxo:
//   1. Chamar consume_conversion_signal_for_lead(company_id, phone, email)
//      — Busca signal não-consumido recente (<2h) por email/phone
//      — Usa FOR UPDATE SKIP LOCKED: seguro para chamadas concorrentes
//      — Retorna: persistent_visitor_id, signal_id
//   2. Se signal encontrado: chamar enrich_lead_from_attribution
//      — Atualiza visitor_id apenas se ainda NULL
//      — Preenche UTMs ausentes via COALESCE (first-touch)
//      — Idempotente: sem efeito se lead já tiver visitor_id
//   3. Fail-open total: nenhuma exceção pode propagar para o caller
//
// Regras críticas:
//   — NUNCA sobrescrever visitor_id existente
//   — NUNCA sobrescrever UTMs já preenchidas
//   — NUNCA bloquear ou alterar o fluxo do caller (customerSync/checkoutSync)
//   — company_id obrigatório em todos os lookups
//   — Sem efeito se não existir signal para o lead
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';

/**
 * Tenta consumir um conversion_signal pendente e enriquecer o lead.
 *
 * Deve ser chamado após qualquer upsert de lead Nuvemshop bem-sucedido.
 * É completamente fail-open: se falhar, o upsert original não é afetado.
 *
 * @param {{
 *   companyId: string,
 *   leadId:    number,
 *   email:     string|null,
 *   phone:     string|null,
 *   svc?:      object
 * }} params
 */
export async function tryEnrichLeadAttribution({ companyId, leadId, email, phone, svc: _svc }) {
  // Pré-condições mínimas para tentar a chamada
  if (!companyId || !leadId || (!email && !phone)) return;

  const svc = _svc ?? getSupabaseAdmin();

  try {
    // Passo 1: consumir signal pendente por email/phone
    // Assinatura real: consume_conversion_signal_for_lead(p_company_id, p_phone, p_email)
    // Retorno: { success, error_code, persistent_visitor_id, signal_id }
    const { data: consumeData, error: consumeErr } = await svc.rpc(
      'consume_conversion_signal_for_lead',
      {
        p_company_id: companyId,
        p_phone:      phone  ?? null,
        p_email:      email  ?? null,
      }
    );

    if (consumeErr) {
      console.warn('[attributionSync] consume_signal rpc error', {
        company_id: companyId,
        lead_id:    leadId,
        code:       consumeErr.code,
      });
      return;
    }

    const consumed = Array.isArray(consumeData) ? consumeData[0] : consumeData;

    // SIGNAL_NOT_FOUND é esperado quando não há signal pendente — NO-OP silencioso
    if (!consumed?.success || !consumed.persistent_visitor_id) return;

    // Passo 2: enriquecer lead com visitor_id e UTMs (SECURITY DEFINER via service_role)
    const { error: enrichErr } = await svc.rpc('enrich_lead_from_attribution', {
      p_lead_id:               leadId,
      p_company_id:            companyId,
      p_persistent_visitor_id: consumed.persistent_visitor_id,
      p_signal_id:             consumed.signal_id ?? null,
    });

    if (enrichErr) {
      console.warn('[attributionSync] enrich_lead rpc error', {
        company_id: companyId,
        lead_id:    leadId,
        code:       enrichErr.code,
      });
      return;
    }

    console.log('[attributionSync] lead enriquecido', {
      company_id: companyId,
      lead_id:    leadId,
      signal_id:  consumed.signal_id,
    });

  } catch {
    // fail-open total: nunca propagar para o caller (customerSync/checkoutSync)
  }
}
