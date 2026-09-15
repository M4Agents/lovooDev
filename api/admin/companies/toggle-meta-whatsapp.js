// =============================================================================
// POST /api/admin/companies/toggle-meta-whatsapp
//
// Habilita ou desabilita companies.meta_whatsapp_enabled para uma empresa
// cliente, permitindo ou revogando o acesso à integração Meta WhatsApp Cloud API.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//
// AUTORIZAÇÃO — Trilha 2 (parent → client), cadeia completa:
//   1. Usuário autenticado (JWT válido)
//   2. Membership ativa em uma empresa do tipo 'parent'
//   3. Role in ('super_admin', 'system_admin') nessa parent
//   4. target.parent_company_id = empresa administrada pelo caller
//   ──→ Cross-parent é impossível: a verificação exige que a parent do alvo
//       seja exatamente aquela onde o caller tem membership.
//   ──→ Membership direta na empresa CLIENT alvo é insuficiente:
//       company_id = target.parent_company_id ≠ target.id.
//
// Negado explicitamente: partner, admin, manager, seller.
// Partner fora de escopo nesta versão (requer UI específica).
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",   — empresa client a ser alterada
//     "enabled":    true|false  — valor booleano estrito (string/number inválidos)
//   }
//
// RESPOSTA (200):
//   {
//     "success":               true,
//     "company_id":            "<uuid>",
//     "meta_whatsapp_enabled": <boolean>
//   }
//
// ERROS:
//   405 method_not_allowed  — método diferente de POST
//   401 unauthorized        — sem token ou token inválido
//   400 invalid_request     — body inválido, campo ausente, UUID inválido, enabled não-boolean
//   403 forbidden           — role insuficiente, empresa errada, cross-parent
//   404 company_not_found   — empresa alvo não existe
//   422 invalid_target      — empresa alvo é parent, ou foi deletada
//   500 internal_error      — erro interno (sem detalhes expostos)
//
// SEGURANÇA:
//   - service_role nunca decide autorização: usada apenas após validação completa.
//   - Logs não contêm JWT, token, stack trace nem dados de outras empresas.
//   - UPDATE altera EXCLUSIVAMENTE meta_whatsapp_enabled + updated_at.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// ── Configuração ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// UUID v4-compatible format validator (qualquer versão UUID é aceita)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {

  // ── 1. Método ───────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // ── 2. Variáveis de ambiente ────────────────────────────────────────────────
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[toggle-meta-whatsapp] Variáveis de ambiente não configuradas')
    return res.status(500).json({ error: 'internal_error' })
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── 3. Autenticação — Bearer JWT ────────────────────────────────────────────
  const authHeader = req.headers?.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const token = authHeader.slice(7)

  const { data: { user } = {}, error: authError } = await svc.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  // ── 4. Parse e validação do body ────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'invalid_request' })
  }

  const { company_id: companyId, enabled } = body

  if (!companyId || typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return res.status(400).json({ error: 'invalid_request' })
  }

  // Coerção explicitamente rejeitada: "true"/"false"/1/0 → typeof !== 'boolean'
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'invalid_request' })
  }

  // ── 5. RBAC — fast-fail: coletar parents administradas pelo caller ──────────
  //
  // Busca TODOS os company_id de empresas parent onde o caller tem membership
  // ativa com role super_admin ou system_admin.
  //
  // Roles menores (partner, admin, manager, seller) retornam 0 linhas → 403.
  // Membership somente em empresas client retorna 0 linhas → 403.
  //
  // O filtro companies!inner(company_type) + .eq('companies.company_type','parent')
  // segue o mesmo padrão de set-plan.js (consolidado no projeto).
  const { data: parentMemberships, error: pmError } = await svc
    .from('company_users')
    .select('company_id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .in('role', ['super_admin', 'system_admin'])
    .eq('is_active', true)
    .eq('companies.company_type', 'parent')

  if (pmError) {
    console.error('[toggle-meta-whatsapp] Erro ao verificar memberships:', pmError.message)
    return res.status(500).json({ error: 'internal_error' })
  }

  if (!parentMemberships || parentMemberships.length === 0) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // IDs das parent companies autorizadas pelo caller (tipicamente 1, mas suporta múltiplas)
  const authorizedParentIds = parentMemberships.map(m => m.company_id)

  // ── 6. Carregar empresa alvo ────────────────────────────────────────────────
  //
  // Feito APÓS o fast-fail de RBAC: usuários sem role autorizada recebem 403
  // antes de qualquer informação sobre existência da empresa alvo.
  const { data: target, error: targetError } = await svc
    .from('companies')
    .select('id, company_type, deleted_at, parent_company_id')
    .eq('id', companyId)
    .maybeSingle()

  if (targetError) {
    console.error('[toggle-meta-whatsapp] Erro ao buscar empresa alvo:', targetError.message)
    return res.status(500).json({ error: 'internal_error' })
  }

  if (!target) {
    return res.status(404).json({ error: 'company_not_found' })
  }

  if (target.deleted_at !== null && target.deleted_at !== undefined) {
    return res.status(422).json({ error: 'invalid_target' })
  }

  if (target.company_type !== 'client') {
    // Previne alteração em empresa parent, mesmo que o caller administre essa parent
    return res.status(422).json({ error: 'invalid_target' })
  }

  // Integridade de dados: empresa client deve ter parent_company_id
  if (!target.parent_company_id) {
    console.error('[toggle-meta-whatsapp] Inconsistência: empresa client sem parent_company_id:', companyId)
    return res.status(500).json({ error: 'internal_error' })
  }

  // ── 7. Cross-parent guard — relação parent → client ─────────────────────────
  //
  // Verifica que a parent ESPECÍFICA do target está entre as parents administradas
  // pelo caller. Isso torna impossível:
  //   - Caller de parent A acessar client de parent B
  //   - Membership direta somente na empresa client alvo (parent_company_id ≠ client.id)
  //
  // Equivalente seguro a auth_user_is_parent_admin(companyId) executado inline,
  // com a vantagem de reutilizar os dados já carregados no step 5.
  if (!authorizedParentIds.includes(target.parent_company_id)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 8. UPDATE — exclusivamente meta_whatsapp_enabled + updated_at ────────────
  const { error: updateError } = await svc
    .from('companies')
    .update({
      meta_whatsapp_enabled: enabled,
      updated_at:            new Date().toISOString(),
    })
    .eq('id', companyId)

  if (updateError) {
    console.error('[toggle-meta-whatsapp] Erro ao atualizar flag:', updateError.message)
    return res.status(500).json({ error: 'internal_error' })
  }

  console.log('[toggle-meta-whatsapp] Flag atualizada:', {
    companyId,
    enabled,
    actorUserId:     user.id,
    parentCompanyId: target.parent_company_id,
  })

  // ── 9. Resposta ──────────────────────────────────────────────────────────────
  return res.status(200).json({
    success:               true,
    company_id:            companyId,
    meta_whatsapp_enabled: enabled,
  })
}
