// =============================================================================
// api/lib/credits/authContext.js
//
// Helper de autenticação e resolução multi-tenant para endpoints de créditos.
//
// RESPONSABILIDADE:
//   1. Validar JWT do header Authorization: Bearer <token>
//   2. Verificar membership ativa em company_users
//   3. Determinar effectiveCompanyId com base no tipo de empresa:
//        - Empresa filha (client): usa company_id da própria sessão.
//          Query param ignorada intencionalmente.
//        - Empresa pai (parent): deve fornecer ?company_id= no query param.
//          Valida que a empresa solicitada é filha direta (parent_company_id).
//
// RETORNO:
//   Erro   → { ok: false, status: 4xx, error: string }
//   Sucesso → { ok: true, svc, effectiveCompanyId, isParentUser }
//
// SEGURANÇA:
//   - NUNCA confia em company_id vindo do frontend sem validação
//   - Empresa pai não pode acessar dados de outra empresa pai nem de filhas alheias
//   - Usuário inativo (is_active = false) é tratado como sem acesso
// =============================================================================

import { createClient } from '@supabase/supabase-js'

export function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Resolve o contexto de autenticação e multi-tenant para endpoints de créditos.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string | null} queryCompanyId - company_id da query string (pode ser null)
 * @returns {Promise<{ ok: false, status: number, error: string } |
 *                   { ok: true, svc: any, effectiveCompanyId: string, isParentUser: boolean }>}
 */
export async function resolveCreditsContext(req, queryCompanyId) {
  // ── 1. Validar Bearer token ──────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Token não fornecido' }
  }
  const token = authHeader.slice(7)

  const svc = getServiceSupabase()
  if (!svc) {
    return { ok: false, status: 500, error: 'Configuração de servidor incompleta' }
  }

  // ── 2. Validar JWT e obter usuário ───────────────────────────────────────
  const { data: { user }, error: authError } = await svc.auth.getUser(token)
  if (authError || !user) {
    return { ok: false, status: 401, error: 'Token inválido ou expirado' }
  }

  // ── 3. Buscar memberships ativas ─────────────────────────────────────────
  const { data: memberships, error: membershipError } = await svc
    .from('company_users')
    .select('company_id, role, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (membershipError || !memberships?.length) {
    return { ok: false, status: 403, error: 'Sem acesso ao sistema de créditos' }
  }

  // ── 4. Determinar tipo de empresa ────────────────────────────────────────
  const isParentUser = memberships.some(m => m.companies?.company_type === 'parent')

  let effectiveCompanyId

  if (isParentUser) {
    // ── Empresa pai: query param obrigatório + validação de vínculo ─────────
    if (!queryCompanyId) {
      return { ok: false, status: 400, error: 'company_id obrigatório para empresa pai' }
    }

    // Impede cross-tenant: valida que queryCompanyId é filha direta desta pai.
    const parentCompanyId = memberships.find(m => m.companies?.company_type === 'parent')?.company_id ?? ''

    const { data: childCheck, error: childCheckError } = await svc
      .from('companies')
      .select('id')
      .eq('id', queryCompanyId)
      .eq('parent_company_id', parentCompanyId)
      .eq('company_type', 'client')
      .maybeSingle()

    if (childCheckError || !childCheck) {
      return { ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' }
    }

    effectiveCompanyId = queryCompanyId
  } else {
    // ── Empresa filha: forçar company_id da sessão — query ignorada ─────────
    const clientMembership = memberships.find(m => m.companies?.company_type !== 'parent')
    if (!clientMembership) {
      return { ok: false, status: 403, error: 'Sem acesso ao sistema de créditos' }
    }
    effectiveCompanyId = clientMembership.company_id
  }

  return { ok: true, svc, effectiveCompanyId, isParentUser }
}
