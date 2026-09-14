// =============================================================================
// validateMetaCaller
//
// Helper de autenticação e autorização para endpoints Meta WhatsApp Cloud API.
//
// Valida (nesta ordem):
//   1. Authorization: Bearer <token>  — prefixo obrigatório
//   2. svc.auth.getUser(token)        — JWT validado remotamente
//   3. Formato UUID do companyId      — rejeitado se inválido
//   4. Membership ativa em company_users (is_active = true) — Trilha 1
//   5. Role dentro da lista permitida pela ação
//   6. Partner: exige assignment ativo em partner_company_assignments
//   7. Trilha 2 (parent → child): super_admin ou system_admin de empresa pai
//   8. Feature flag companies.meta_whatsapp_enabled — SEMPRE obrigatória
//
// A feature flag não possui bypass público. Todo caller Meta deve operar em
// empresa com meta_whatsapp_enabled = true. Se houver necessidade futura de
// ignorar a flag, ela será analisada e aprovada explicitamente.
//
// Roles disponíveis (exportadas para uso nos endpoints):
//   META_VIEW_ROLES    — leitura de instâncias e configurações
//   META_CONNECT_ROLES — iniciar onboarding, conectar, desconectar, rotacionar token
//
// Retorna em sucesso:
//   { ok: true, userId, companyId, role, accessPath }
//   accessPath: 'direct' | 'partner' | 'parent'
//
// Retorna em falha:
//   { ok: false, status, error }
//
// SEGURANÇA:
//   - Nunca confiar em company_id sem validar membership real.
//   - Nunca usar permission template como fonte de autorização.
//   - Nunca usar companies.user_id ou companies.is_super_admin.
//   - Usuário inativo (is_active = false) é tratado como sem acesso.
//   - Partner role sozinha NÃO é suficiente: exige assignment ativo.
//   - auth_user_is_platform_admin() NÃO utilizado (cross-tenant inseguro).
//   - Nenhum dado sensível (token, key, ciphertext) é lido ou logado.
// =============================================================================

// UUID v4 básico — rejeita inputs obviamente inválidos antes de qualquer query no banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// Matrizes de roles por escopo de ação
// =============================================================================

/**
 * Roles que podem visualizar instâncias conectadas e configurações Meta.
 * Inclui seller — pode listar números configurados para envio.
 */
export const META_VIEW_ROLES = [
  'super_admin',
  'system_admin',
  'partner',
  'admin',
  'manager',
  'seller',
];

/**
 * Roles que podem iniciar onboarding Embedded Signup, conectar,
 * desconectar ou rotacionar token de uma instância.
 *
 * ATENÇÃO PARA PARTNER: presença aqui exige obrigatoriamente assignment ativo
 * em partner_company_assignments. O role sozinho NÃO garante acesso.
 */
export const META_CONNECT_ROLES = [
  'super_admin',
  'system_admin',
  'partner',
  'admin',
];

// =============================================================================
// Função principal
// =============================================================================

/**
 * Valida JWT + RBAC + feature flag para endpoints Meta WhatsApp Cloud API.
 *
 * @param {import('http').IncomingMessage} req
 *   Request Vercel — precisa de headers.authorization.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 *   Client Supabase com service_role. Passar via getSupabaseAdmin().
 *   Nunca instanciar dentro deste helper — injetar para testabilidade.
 *
 * @param {string} companyId
 *   UUID da empresa alvo. Vem do body/state — nunca assumido como confiável.
 *   O helper valida formato e membership antes de confiar no valor.
 *
 * @param {{ roles?: string[] }} [options]
 *   - roles: lista de roles permitidas (padrão: META_VIEW_ROLES).
 *
 * @returns {Promise<
 *   | { ok: true,  userId: string, companyId: string, role: string, accessPath: 'direct'|'partner'|'parent' }
 *   | { ok: false, status: number, error: string }
 * >}
 */
export async function validateMetaCaller(req, svc, companyId, options = {}) {
  const roles = options.roles ?? META_VIEW_ROLES;

  // ── 1. Bearer token ────────────────────────────────────────────────────────
  const authHeader = req.headers?.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }
  const token = authHeader.slice(7);

  // ── 2. Validar JWT e obter usuário ─────────────────────────────────────────
  // Sempre validado antes de qualquer checagem de input — consistente com
  // validateInstagramCaller e validateNuvemshopCaller.
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  // ── 3. Validar formato básico do companyId ─────────────────────────────────
  // Executado após auth para garantir consistência na ordem de erros:
  //   sem auth → 401, UUID inválido → 400, sem acesso → 403.
  if (!companyId || !UUID_RE.test(companyId)) {
    return { ok: false, status: 400, error: 'company_id inválido' };
  }

  // ── 4. Trilha 1: membership direta ────────────────────────────────────────
  const { data: directMem } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (directMem) {
    // Role fora da matriz da ação solicitada → 403
    if (!roles.includes(directMem.role)) {
      return { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    }

    // ── 4a. Partner: assignment obrigatório ──────────────────────────────────
    // role='partner' em company_users NUNCA é suficiente por si só.
    // Exige vínculo ativo em partner_company_assignments.
    if (directMem.role === 'partner') {
      const { data: assignment } = await svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .maybeSingle();

      if (!assignment) {
        return { ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa' };
      }

      return _checkFeatureFlagAndReturn(svc, {
        companyId,
        userId:     user.id,
        role:       directMem.role,
        accessPath: 'partner',
      });
    }

    return _checkFeatureFlagAndReturn(svc, {
      companyId,
      userId:     user.id,
      role:       directMem.role,
      accessPath: 'direct',
    });
  }

  // ── 5. Trilha 2: super_admin / system_admin de empresa pai → filha ─────────
  //
  // Acesso parental restrito a super_admin e system_admin — mesmo padrão de
  // validateInstagramCaller e validateNuvemshopCaller.
  //
  // NÃO usar auth_user_is_platform_admin(): retorna true para qualquer usuário
  // com role elevada em QUALQUER empresa parent, violando isolamento multi-tenant.
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

  // Garantia anti-cross-tenant: a empresa alvo deve ser filha direta desta parent.
  // Um super_admin de Parent A NÃO pode acessar empresas de Parent B.
  const { data: childCheck } = await svc
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('parent_company_id', parentMem.company_id)
    .maybeSingle();

  if (!childCheck) {
    return { ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' };
  }

  return _checkFeatureFlagAndReturn(svc, {
    companyId,
    userId:     user.id,
    role:       parentMem.role,
    accessPath: 'parent',
  });
}

// =============================================================================
// Helper interno — feature flag
// =============================================================================

/**
 * Verifica companies.meta_whatsapp_enabled para a empresa alvo e retorna
 * o resultado final. Chamado somente após autenticação, tenant e RBAC aprovados.
 *
 * A verificação é sempre obrigatória — não existe bypass público.
 * Se meta_whatsapp_enabled for false ou empresa não existir → 403.
 *
 * @private
 */
async function _checkFeatureFlagAndReturn(svc, { companyId, userId, role, accessPath }) {
  const { data: company } = await svc
    .from('companies')
    .select('meta_whatsapp_enabled')
    .eq('id', companyId)
    .maybeSingle();

  if (!company?.meta_whatsapp_enabled) {
    return { ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa' };
  }

  return { ok: true, userId, companyId, role, accessPath };
}
