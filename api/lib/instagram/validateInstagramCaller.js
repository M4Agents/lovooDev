// =============================================================================
// validateInstagramCaller
//
// Helper de autenticação e autorização para endpoints Instagram.
//
// Valida:
//   - JWT via Authorization: Bearer <token>
//   - Membership ativa em company_users (is_active = true)
//   - Role dentro da lista permitida para operações Instagram
//   - Partner: exige assignment ativo em partner_company_assignments
//   - Trilha 2 (parent → child): super_admin ou system_admin de empresa pai
//
// Roles permitidos:
//   super_admin, system_admin, partner (+ assignment), admin, manager, seller
//
// Retorna:
//   { ok: true,  userId, role }          — acesso autorizado
//   { ok: false, status, error }         — acesso negado
//
// SEGURANÇA:
//   - Nunca confiar em company_id do frontend: receber company_id já resolvido do banco.
//   - Nunca usar template de permissão como autorização.
//   - Nunca usar companies.user_id ou companies.is_super_admin.
//   - Usuário inativo (is_active = false) é tratado como sem acesso.
// =============================================================================

/** Roles que podem usar qualquer operação Instagram (leitura incluída). */
export const ALLOWED_ROLES = ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'];

/** Roles restritas: conectar/desconectar contas (admin+). */
export const CONNECT_ROLES = ['super_admin', 'system_admin', 'admin', 'partner'];

/**
 * Valida JWT + RBAC para endpoints Instagram.
 *
 * @param {import('http').IncomingMessage} req        - Request (precisa de headers.authorization)
 * @param {import('@supabase/supabase-js').SupabaseClient} svc - Client service_role
 * @param {string} companyId - UUID da empresa dona do recurso (resolvido do banco, nunca do payload)
 * @param {{ roles?: string[] }} [options]
 *   - roles: lista de roles permitidas (padrão: ALLOWED_ROLES; use CONNECT_ROLES para admin+)
 *
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, userId?: string, role?: string }>}
 */
export async function validateInstagramCaller(req, svc, companyId, options = {}) {
  const roles = options.roles ?? ALLOWED_ROLES;
  const authHeader = req.headers?.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);

  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  // ── Trilha 1: membership direta ────────────────────────────────────────────
  const { data: directMem } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (directMem) {
    if (!roles.includes(directMem.role)) {
      return {
        ok:     false,
        status: 403,
        error:  'Permissão insuficiente para esta operação',
      };
    }

    // Partner: exige assignment ativo
    if (directMem.role === 'partner') {
      const { data: assignment } = await svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .maybeSingle();

      if (!assignment) {
        return {
          ok:     false,
          status: 403,
          error:  'Partner sem assignment ativo para esta empresa',
        };
      }
    }

    return { ok: true, userId: user.id, role: directMem.role };
  }

  // ── Trilha 2: super_admin / system_admin de empresa pai (parent → child) ──
  // Acesso via parentesco de empresa; não requer membership direta na filha.
  const { data: parentMem } = await svc
    .from('company_users')
    .select('role, company_id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .maybeSingle();

  if (!parentMem || parentMem.companies?.company_type !== 'parent') {
    return { ok: false, status: 403, error: 'Acesso negado a esta empresa' };
  }

  const { data: childCheck } = await svc
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('parent_company_id', parentMem.company_id)
    .maybeSingle();

  if (!childCheck) {
    return { ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' };
  }

  return { ok: true, userId: user.id, role: parentMem.role };
}
