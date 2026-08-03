// =============================================================================
// GET /api/nuvemshop/tabs/checkout-url
//
// Retorna o checkout_url de um Lead, com controle de acesso estrito.
//
// O nuvemshop_checkout_url é um dado sensível: contém um link direto que
// pode ser usado para acessar o carrinho abandonado do cliente. Por isso:
//   - Jamais é retornado pelo endpoint genérico de lead tab
//   - Tem acesso restrito a roles com poder de gestão (não 'seller')
//   - Nunca é logado ou exposto desnecessariamente
//   - Só deve ser carregado quando o usuário explicitamente clicar em "Ver link"
//
// Query params:
//   lead_id     string    UUID do lead (obrigatório)
//   company_id  string    UUID da empresa (obrigatório)
//
// Resposta:
//   { checkout_url: string | null }
//
// Segurança:
//   - JWT obrigatório via Authorization: Bearer
//   - company_id validado contra membership real
//   - Roles permitidos: super_admin, system_admin, admin, manager
//     (seller excluído — não pode ver o link direto)
//   - Isolamento multi-tenant: .eq('company_id', companyId) obrigatório
//   - Log de acesso emitido (sem o URL no log — apenas evento de acesso)
// =============================================================================

import { getSupabaseAdmin }                                   from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, SENSITIVE_DATA_ROLES }      from '../../lib/nuvemshop/validateNuvemshopCaller.js';
// SENSITIVE_DATA_ROLES = ['super_admin', 'system_admin', 'admin', 'manager']
// Seller excluído (link direto ao carrinho é dado sensível do cliente).
// Partner excluído (acesso restrito; empresa deve ser administrada diretamente).

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { lead_id: leadId, company_id: companyId } = req.query ?? {};

  if (!leadId)    return res.status(400).json({ error: 'lead_id é obrigatório' });
  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const svc = getSupabaseAdmin();

  // ── RBAC restrito — matriz explícita de roles sensíveis ──────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, {
    roles: SENSITIVE_DATA_ROLES,
  });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Buscar somente o campo sensível, com isolamento multi-tenant ──────────
  const { data: lead, error: leadErr } = await svc
    .from('leads')
    .select('id, nuvemshop_checkout_url, company_id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (leadErr) {
    return res.status(500).json({ error: 'Erro ao buscar dados do lead' });
  }
  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado' });
  }

  // ── Log de auditoria de acesso (sem o URL no log) ─────────────────────────
  console.info(JSON.stringify({
    level:      'info',
    event:      'checkout_url_accessed',
    company_id: companyId,
    lead_id:    leadId,
    user_id:    auth.userId,
    user_role:  auth.userRole,
    has_url:    !!lead.nuvemshop_checkout_url,
    // checkout_url: NUNCA logado — dado sensível
  }));

  return res.status(200).json({
    checkout_url: lead.nuvemshop_checkout_url ?? null,
  });
}
