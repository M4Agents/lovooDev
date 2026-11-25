// =============================================================================
// validateCompanyCaller
//
// Autorização compartilhada de empresa. Não conhece integração Meta e não
// consulta feature flag. A empresa informada pelo cliente é só o escopo a
// verificar. Role, membership e trilha saem do banco.
//
// Ordem:
//   1. Authorization: Bearer
//   2. svc.auth.getUser(token)
//   3. UUID da empresa
//   4. Membership direta ativa
//   5. Role na matriz recebida pela operação
//   6. Partner direto com assignment ativo
//   7. Partner herdado: partner ativo na pai, pai do tipo parent,
//      assignment ativo na filha e a mesma parent_company_id
//   8. super_admin ou system_admin dessa pai, com a filha vinculada
//
// Ausência confirmada de vínculo, sem erro, permite a trilha seguinte.
// Erro, exceção, timeout ou duplicidade de maybeSingle interrompem com 503.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUTHORIZATION_UNAVAILABLE = 'Autorização temporariamente indisponível';

const INFRA = { ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE };

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 * @param {{ roles?: string[] }} [options]
 *   roles é a matriz da operação, não o papel do usuário.
 * @returns {Promise<
 *   | { ok: true, userId: string, companyId: string, role: string, accessPath: 'direct'|'partner'|'parent' }
 *   | { ok: false, status: number, error: string }
 * >}
 */
export async function validateCompanyCaller(req, svc, companyId, options = {}) {
  const roles = Array.isArray(options.roles) ? options.roles : [];

  const authHeader = req.headers?.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }
  const token = authHeader.slice(7);

  let authResult;
  try {
    authResult = await svc.auth.getUser(token);
  } catch {
    return INFRA;
  }
  const user = authResult?.data?.user;
  if (authResult?.error || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  if (!companyId || !UUID_RE.test(companyId)) {
    return { ok: false, status: 400, error: 'company_id inválido' };
  }

  const direct = await readMaybeSingle(() => svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true));
  if (!direct.ok) return INFRA;

  if (direct.data) {
    if (!roles.includes(direct.data.role)) {
      return { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    }

    if (direct.data.role === 'partner') {
      const assignment = await readMaybeSingle(() => svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', companyId)
        .eq('is_active', true));
      if (!assignment.ok) return INFRA;
      if (!assignment.data) {
        return { ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa' };
      }

      return {
        ok: true,
        companyId,
        userId: user.id,
        role: direct.data.role,
        accessPath: 'partner',
      };
    }

    return {
      ok: true,
      companyId,
      userId: user.id,
      role: direct.data.role,
      accessPath: 'direct',
    };
  }

  const childCompany = await readMaybeSingle(() => svc
    .from('companies')
    .select('parent_company_id')
    .eq('id', companyId));
  if (!childCompany.ok) return INFRA;

  const parentCompanyId = childCompany.data?.parent_company_id ?? null;

  if (parentCompanyId && roles.includes('partner')) {
    const partnerMem = await readMaybeSingle(() => svc
      .from('company_users')
      .select('role, company_id, companies!inner(company_type)')
      .eq('user_id', user.id)
      .eq('company_id', parentCompanyId)
      .eq('is_active', true)
      .eq('role', 'partner'));
    if (!partnerMem.ok) return INFRA;

    const inheritedPartner = partnerMem.data?.role === 'partner'
      && partnerMem.data.company_id === parentCompanyId
      && partnerMem.data.companies?.company_type === 'parent';

    if (inheritedPartner) {
      const inheritedAssignment = await readMaybeSingle(() => svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', companyId)
        .eq('is_active', true));
      if (!inheritedAssignment.ok) return INFRA;

      if (inheritedAssignment.data) {
        return {
          ok: true,
          companyId,
          userId: user.id,
          role: 'partner',
          accessPath: 'partner',
        };
      }
    }
  }

  const parentMem = await readMaybeSingle(() => {
    let parentQuery = svc
      .from('company_users')
      .select('role, company_id, companies!inner(company_type)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .in('role', ['super_admin', 'system_admin']);
    if (parentCompanyId) {
      parentQuery = parentQuery.eq('company_id', parentCompanyId);
    }
    return parentQuery;
  });
  if (!parentMem.ok) return INFRA;

  if (!parentMem.data
      || parentMem.data.companies?.company_type !== 'parent'
      || (parentCompanyId && parentMem.data.company_id !== parentCompanyId)) {
    return { ok: false, status: 403, error: 'Acesso negado a esta empresa' };
  }

  const childCheck = await readMaybeSingle(() => svc
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('parent_company_id', parentMem.data.company_id));
  if (!childCheck.ok) return INFRA;
  if (!childCheck.data) {
    return { ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' };
  }

  return {
    ok: true,
    companyId,
    userId: user.id,
    role: parentMem.data.role,
    accessPath: 'parent',
  };
}

async function readMaybeSingle(buildQuery) {
  try {
    const result = await buildQuery().maybeSingle();
    if (!result || typeof result !== 'object' || result.error) {
      return { ok: false };
    }
    return { ok: true, data: result.data ?? null };
  } catch {
    return { ok: false };
  }
}
