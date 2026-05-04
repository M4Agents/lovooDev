-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Corrigir visibilidade e contagem de usuários de plataforma
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problemas corrigidos:
--   1. system_admin não via empresas filhas em Governância Lovoo → nova RLS policy
--   2. super_admin aparecia na lista de usuários de empresas filhas → filtro na RPC
--   3. super_admin era contabilizado nos limites de plano das filhas → is_platform_member
--
-- Estratégia:
--   - Adicionar is_platform_member BOOLEAN à company_users
--   - Marcar rows técnicas (super_admin/system_admin em empresas client) como TRUE
--   - A row NÃO é removida — acesso interno via caller_has_permission permanece íntegro
--   - get_company_users_with_details filtra is_platform_member = FALSE
--   - Backend (5 pontos) adiciona .eq('is_platform_member', false) — deploy APÓS esta migration
--
-- Auditoria prévia: 0 rows de partner em company_users de empresas client
--   → partner não precisa ser marcado
--
-- Não edita nenhuma migration antiga. Tudo via CREATE OR REPLACE nesta migration.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. NOVA COLUNA is_platform_member ────────────────────────────────────────

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS is_platform_member BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.company_users.is_platform_member IS
  'TRUE para memberships técnicas de plataforma (super_admin/system_admin inseridos '
  'automaticamente em empresas client). Excluídos da lista de usuários e da contagem '
  'de plano (max_users). A row é mantida para que caller_has_permission e outras '
  'RPCs internas continuem funcionando.';


-- ── 2. MARCAR ROWS EXISTENTES ────────────────────────────────────────────────
-- Apenas super_admin e system_admin em empresas client.
-- Partner: auditoria confirmou 0 rows → não incluído.

UPDATE public.company_users cu
SET    is_platform_member = TRUE
FROM   public.companies c
WHERE  cu.company_id = c.id
  AND  c.company_type = 'client'
  AND  cu.role IN ('super_admin', 'system_admin');


-- ── 3. ATUALIZAR create_client_company_safe ──────────────────────────────────
-- Adiciona is_platform_member = TRUE no INSERT do super_admin da parent (step 7).
-- Corpo completo — assinatura idêntica à versão em 20260503100001.

CREATE OR REPLACE FUNCTION public.create_client_company_safe(
  p_parent_company_id uuid,
  p_name              text,
  p_domain            text DEFAULT NULL,
  p_plan              text DEFAULT 'basic'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_caller_role      text;
  v_parent_super_id  uuid;
  v_parent_type      text;
  v_new_company_id   uuid;
  v_is_partner       boolean := false;
  v_growth_plan_id   uuid;
  v_trial_start      timestamptz := now();
  v_trial_end        timestamptz := now() + interval '14 days';
  v_super_perms      jsonb := jsonb_build_object(
    'chat',          true,
    'leads',         true,
    'users',         true,
    'settings',      true,
    'analytics',     true,
    'dashboard',     true,
    'financial',     true,
    'companies',     true,
    'edit_users',    true,
    'create_users',  true,
    'delete_users',  true,
    'impersonate',   true,
    'edit_all_leads',   true,
    'edit_financial',   true,
    'view_all_leads',   true,
    'view_financial',   true
  );
BEGIN
  -- 1. Caller deve estar autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- 2. Empresa parent deve existir e ser do tipo 'parent'
  SELECT company_type INTO v_parent_type
    FROM companies
   WHERE id = p_parent_company_id;

  IF v_parent_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'parent company not found');
  END IF;

  IF v_parent_type <> 'parent' THEN
    RETURN jsonb_build_object('success', false, 'error', 'target is not a parent company');
  END IF;

  -- 3. Validar role do caller na parent company
  SELECT cu.role INTO v_caller_role
    FROM company_users cu
   WHERE cu.user_id = v_caller_id
     AND cu.company_id = p_parent_company_id
     AND cu.is_active = true
   LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'system_admin', 'partner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: only super_admin, system_admin or partner can create client companies');
  END IF;

  -- 4. Identificar o super_admin da parent (para associar à nova empresa)
  SELECT cu.user_id INTO v_parent_super_id
    FROM company_users cu
   WHERE cu.company_id = p_parent_company_id
     AND cu.role = 'super_admin'
     AND cu.is_active = true
   ORDER BY cu.created_at
   LIMIT 1;

  IF v_parent_super_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no active super_admin found in parent company');
  END IF;

  -- 5. Verificar se caller é partner
  v_is_partner := (v_caller_role = 'partner');

  -- ── TRIAL: resolver plano Growth ────────────────────────────────────────────
  SELECT id INTO v_growth_plan_id
    FROM public.plans
   WHERE slug = 'growth'
     AND is_active = true
   LIMIT 1;

  IF v_growth_plan_id IS NULL THEN
    RAISE WARNING 'create_client_company_safe: plano Growth (slug=growth) não encontrado ou inativo. '
                  'Empresa será criada sem trial e sem plan_id. Verificar seed de planos.';
  END IF;
  -- ────────────────────────────────────────────────────────────────────────────

  -- 6. Criar a empresa client
  INSERT INTO public.companies (
    name,
    domain,
    plan,
    plan_id,
    parent_company_id,
    company_type,
    user_id,
    status,
    created_by_partner_id
  )
  VALUES (
    p_name,
    p_domain,
    p_plan,
    v_growth_plan_id,
    p_parent_company_id,
    'client',
    NULL,
    'active',
    CASE WHEN v_is_partner THEN v_caller_id ELSE NULL END
  )
  RETURNING id INTO v_new_company_id;

  -- 7. Associar super_admin da parent à nova empresa via company_users
  --    is_platform_member = TRUE: membership técnica — não conta no plano nem aparece na lista
  INSERT INTO public.company_users (
    company_id,
    user_id,
    role,
    permissions,
    is_active,
    is_platform_member,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    v_new_company_id,
    v_parent_super_id,
    'super_admin',
    v_super_perms,
    true,
    TRUE,
    v_caller_id,
    now(),
    now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role               = 'super_admin',
    permissions        = v_super_perms,
    is_active          = true,
    is_platform_member = TRUE,
    updated_at         = now();

  -- 8. Se caller for partner: criar auto-assignment
  IF v_is_partner THEN
    INSERT INTO public.partner_company_assignments (
      partner_user_id,
      company_id,
      assigned_by,
      is_active
    )
    VALUES (
      v_caller_id,
      v_new_company_id,
      v_caller_id,
      true
    )
    ON CONFLICT (partner_user_id, company_id) DO UPDATE SET
      is_active   = true,
      assigned_at = now();
  END IF;

  -- ── TRIAL: criar registro de subscription ───────────────────────────────────
  IF v_growth_plan_id IS NOT NULL THEN
    INSERT INTO public.company_subscriptions (
      company_id,
      plan_id,
      status,
      trial_start,
      trial_end,
      trial_extended,
      stripe_subscription_id,
      stripe_price_id,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      billing_cycle
    )
    VALUES (
      v_new_company_id,
      v_growth_plan_id,
      'trialing',
      v_trial_start,
      v_trial_end,
      false,
      NULL,
      NULL,
      NULL,
      NULL,
      false,
      'monthly'
    )
    ON CONFLICT (company_id) DO NOTHING;
  END IF;
  -- ────────────────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'success',       true,
    'company_id',    v_new_company_id,
    'auto_assigned', v_is_partner,
    'trial_started', v_growth_plan_id IS NOT NULL,
    'trial_end',     CASE WHEN v_growth_plan_id IS NOT NULL
                       THEN v_trial_end::text
                       ELSE NULL
                     END
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client_company_safe(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_client_company_safe IS
  'Cria empresa client de forma transacional e atômica. '
  'Define plan_id=Growth e cria company_subscriptions com status=trialing e trial_end=NOW()+14d. '
  'Apenas super_admin, system_admin ou partner podem chamar. '
  'O super_admin da parent é associado com is_platform_member=TRUE — '
  'não conta no plano nem aparece na lista de usuários da filha.';


-- ── 4. ATUALIZAR get_company_users_with_details ──────────────────────────────
-- Adiciona filtro AND cu.is_platform_member = FALSE no WHERE.
-- Exclui membros técnicos da lista visível de usuários.

CREATE OR REPLACE FUNCTION public.get_company_users_with_details(
  p_company_id uuid
)
RETURNS TABLE(
  id                  uuid,
  company_id          uuid,
  user_id             uuid,
  role                text,
  permissions         jsonb,
  created_by          uuid,
  is_active           boolean,
  created_at          timestamptz,
  updated_at          timestamptz,
  profile_picture_url text,
  companies           jsonb,
  display_name        text,
  email               varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_has_access  boolean;
BEGIN
  -- Validar acesso: caller deve ter company_users direto OU ser partner atribuído
  SELECT public.caller_has_permission(p_company_id, 'users') INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'forbidden: caller has no access to company_users for company %', p_company_id;
  END IF;

  RETURN QUERY
  SELECT
    cu.id,
    cu.company_id,
    cu.user_id,
    cu.role,
    cu.permissions,
    cu.created_by,
    cu.is_active,
    cu.created_at,
    cu.updated_at,
    cu.profile_picture_url,
    jsonb_build_object(
      'id',           c.id,
      'name',         c.name,
      'company_type', c.company_type
    ) AS companies,
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1)
    )::text AS display_name,
    au.email
  FROM company_users cu
  JOIN companies c ON cu.company_id = c.id
  LEFT JOIN auth.users au ON cu.user_id = au.id
  WHERE cu.company_id         = p_company_id
    AND cu.is_active          = true
    AND cu.is_platform_member = FALSE
  ORDER BY cu.created_at DESC;
END;
$$;


-- ── 5. HELPER is_system_admin() ──────────────────────────────────────────────
-- Padrão idêntico ao is_super_admin() existente.
-- Retorna TRUE se o caller for system_admin ativo em empresa parent.

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.company_users cu
    JOIN   public.companies c ON c.id = cu.company_id
    WHERE  cu.user_id     = auth.uid()
      AND  cu.role        = 'system_admin'
      AND  cu.is_active   = true
      AND  c.company_type = 'parent'
  );
$$;


-- ── 6. RLS POLICY: system_admin ver todas as empresas ────────────────────────
-- Equivalente à companies_super_admin_see_all, mas para system_admin.
-- Sem sobreposição: is_super_admin() usa role='super_admin';
--                   is_system_admin() usa role='system_admin'.

CREATE POLICY "companies_system_admin_see_all"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (is_system_admin());
