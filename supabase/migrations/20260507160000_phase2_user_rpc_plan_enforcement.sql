-- =============================================================================
-- MIGRATION: Fase 2 — Enforcement de max_users nas RPCs de usuário
--
-- O QUE ESTA MIGRATION FAZ:
--   ✓ Atualiza create_company_user_safe: bloqueia INSERT e reativação
--     quando company_users ativos (is_platform_member = false) atingem max_users
--   ✓ Atualiza update_company_user_safe: bloqueia promoção de role
--     quando o usuário alvo tem is_over_plan = true
--   ✓ Reativação via update_company_user_safe (p_is_active = true) também
--     respeita o limite de max_users
--
-- REGRAS CRÍTICAS:
--   - NUNCA bloquear login ou sessão
--   - is_over_plan é informacional; somente criação/reativação e promoção são bloqueadas
--   - O erro retornado é JSON { success: false, error: 'plan_users_limit_exceeded' }
--     para que o backend (invite-user.ts) possa detectar e retornar HTTP 422
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Peso dos roles para verificação de promoção
-- super_admin=6, system_admin=5, partner=4, admin=3, manager=2, seller=1
-- Usado internamente por update_company_user_safe via expressão CASE
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. ATUALIZAR create_company_user_safe
--
-- Adiciona verificação de max_users ANTES do INSERT ou da reativação.
-- Usa o mesmo padrão de retorno JSON da função original.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_company_user_safe(
  p_company_id  uuid,
  p_user_id     uuid,
  p_role        text,
  p_permissions jsonb    DEFAULT NULL,
  p_created_by  uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_result              company_users;
  v_company             companies;
  v_existing_user       company_users;
  v_caller_role         text;
  v_allowed_roles       text[];
  v_max_users           integer;
  v_current_users       bigint;
BEGIN
  RAISE NOTICE 'create_company_user_safe: Creating user % for company % by %', p_user_id, p_company_id, p_created_by;

  SELECT * INTO v_company
  FROM companies
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada: %', p_company_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado no sistema de autenticação: %', p_user_id;
  END IF;

  IF p_role NOT IN ('super_admin', 'system_admin', 'admin', 'partner', 'manager', 'seller') THEN
    RAISE EXCEPTION 'Role inválido: %', p_role;
  END IF;

  IF v_company.company_type = 'client' AND p_role IN ('super_admin', 'system_admin', 'partner') THEN
    RAISE EXCEPTION 'Role % não permitido em empresa do tipo client', p_role;
  END IF;

  IF p_created_by IS NOT NULL THEN
    SELECT cu.role INTO v_caller_role
    FROM company_users cu
    WHERE cu.user_id = p_created_by
      AND cu.is_active = true
      AND (
        cu.company_id = p_company_id
        OR EXISTS (
          SELECT 1 FROM companies c
          WHERE c.id = p_company_id
            AND c.parent_company_id = cu.company_id
        )
      )
    ORDER BY
      CASE WHEN cu.company_id = p_company_id THEN 0 ELSE 1 END
    LIMIT 1;

    v_allowed_roles := CASE v_caller_role
      WHEN 'super_admin'  THEN ARRAY['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller']
      WHEN 'system_admin' THEN ARRAY['partner', 'admin', 'manager', 'seller']
      WHEN 'partner'      THEN ARRAY['admin', 'manager', 'seller']
      WHEN 'admin'        THEN ARRAY['admin', 'manager', 'seller']
      ELSE ARRAY[]::text[]
    END;

    IF v_caller_role IS NULL OR NOT (p_role = ANY(v_allowed_roles)) THEN
      RAISE EXCEPTION 'Usuário % (role: %) não tem permissão para criar role % na empresa %',
        p_created_by, COALESCE(v_caller_role, 'desconhecido'), p_role, p_company_id;
    END IF;
  END IF;

  -- ── VERIFICAÇÃO DE LIMITE DE USUÁRIOS (max_users) ─────────────────────────
  -- Conta usuários ativos que consomem slot do plano (is_platform_member = false)
  -- O check ocorre tanto para novos usuários quanto para reativação de inativos
  SELECT pl.max_users
    INTO v_max_users
    FROM companies c
    LEFT JOIN plans pl ON pl.id = c.plan_id AND pl.is_active = true
   WHERE c.id = p_company_id;

  IF v_max_users IS NOT NULL THEN
    SELECT count(*)
      INTO v_current_users
      FROM company_users
     WHERE company_id        = p_company_id
       AND is_active         = true
       AND is_platform_member = false;

    IF v_current_users >= v_max_users THEN
      RETURN jsonb_build_object(
        'success',    false,
        'error',      'plan_users_limit_exceeded',
        'error_code', 'PLAN_LIMIT_EXCEEDED',
        'current',    v_current_users,
        'limit',      v_max_users
      );
    END IF;
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  SELECT * INTO v_existing_user
  FROM company_users
  WHERE company_id = p_company_id AND user_id = p_user_id;

  IF FOUND THEN
    IF v_existing_user.is_active = true THEN
      RAISE EXCEPTION 'Usuário já existe e está ativo nesta empresa';
    ELSE
      UPDATE company_users
      SET
        role        = p_role,
        permissions = COALESCE(p_permissions, permissions),
        is_active   = true,
        created_by  = COALESCE(p_created_by, created_by),
        updated_at  = NOW()
      WHERE id = v_existing_user.id
      RETURNING * INTO v_result;
    END IF;
  ELSE
    INSERT INTO company_users (
      company_id, user_id, role, permissions,
      is_active, created_by, created_at, updated_at
    ) VALUES (
      p_company_id, p_user_id, p_role,
      COALESCE(p_permissions, '{}'::jsonb),
      true, p_created_by, NOW(), NOW()
    ) RETURNING * INTO v_result;
  END IF;

  RETURN jsonb_build_object(
    'id',           v_result.id,
    'company_id',   v_result.company_id,
    'user_id',      v_result.user_id,
    'role',         v_result.role,
    'permissions',  v_result.permissions,
    'is_active',    v_result.is_active,
    'created_by',   v_result.created_by,
    'created_at',   v_result.created_at,
    'updated_at',   v_result.updated_at,
    'company_name', v_company.name,
    'company_type', v_company.company_type,
    'success',      true,
    'reactivated',  CASE WHEN v_existing_user.id IS NOT NULL THEN true ELSE false END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'create_company_user_safe: Error - %', SQLERRM;
  RETURN jsonb_build_object(
    'success',    false,
    'error',      SQLERRM,
    'error_code', SQLSTATE
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. ATUALIZAR update_company_user_safe
--
-- Adiciona dois blocos de enforcement:
--   a) Bloqueio de promoção de role quando usuário alvo is_over_plan = true
--   b) Bloqueio de reativação (p_is_active = true) quando empresa está no limite
--
-- Role weights (para detectar promoção):
--   seller=1, manager=2, admin=3, partner=4, system_admin=5, super_admin=6
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_company_user_safe(
  p_record_id   uuid,
  p_role        text     DEFAULT NULL,
  p_permissions jsonb    DEFAULT NULL,
  p_is_active   boolean  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_company_id   uuid;
  v_company_type text;
  v_caller_role  text;
  v_target_role  text;
  v_target_active boolean;
  v_target_is_over_plan boolean;
  v_can_edit     boolean;
  v_allowed_roles text[];

  VALID_ROLES     text[]  := ARRAY['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'];
  CLIENT_ROLES    text[]  := ARRAY['admin', 'manager', 'seller'];
  SAAS_ONLY_ROLES text[]  := ARRAY['super_admin', 'system_admin', 'partner'];
  CRITICAL_KEYS   text[]  := ARRAY['companies', 'impersonate'];

  k               text;
  v_new_perms     jsonb;

  -- Limit check (reactivation)
  v_max_users     integer;
  v_current_users bigint;
BEGIN
  SELECT cu.company_id, c.company_type, cu.role, cu.is_active, cu.is_over_plan
  INTO   v_company_id, v_company_type, v_target_role, v_target_active, v_target_is_over_plan
  FROM   public.company_users cu
  JOIN   public.companies     c  ON c.id = cu.company_id
  WHERE  cu.id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registro não encontrado');
  END IF;

  SELECT public.caller_has_permission(v_company_id, 'edit_users')
  INTO   v_can_edit;

  IF NOT v_can_edit THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para editar usuários');
  END IF;

  SELECT cu.role
  INTO   v_caller_role
  FROM   public.company_users cu
  WHERE  cu.user_id    = auth.uid()
    AND  cu.company_id = v_company_id
    AND  cu.is_active  = true;

  IF v_caller_role IS NULL THEN
    SELECT cu.role
    INTO   v_caller_role
    FROM   public.partner_company_assignments pca
    JOIN   public.company_users cu
           ON cu.user_id = auth.uid()
           AND cu.is_active = true
    WHERE  pca.partner_user_id = auth.uid()
      AND  pca.company_id      = v_company_id
      AND  pca.is_active       = true
    LIMIT 1;
  END IF;

  IF p_role IS NOT NULL THEN
    IF NOT (p_role = ANY(VALID_ROLES)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role inválido: %L', p_role)
      );
    END IF;

    IF v_company_type = 'client' AND p_role = ANY(SAAS_ONLY_ROLES) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role %L não é permitido em empresa do tipo client', p_role)
      );
    END IF;

    IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
      v_allowed_roles := CASE v_caller_role
        WHEN 'system_admin' THEN ARRAY['partner', 'admin', 'manager', 'seller']
        WHEN 'partner'      THEN ARRAY['admin', 'manager', 'seller']
        WHEN 'admin'        THEN ARRAY['admin', 'manager', 'seller']
        ELSE ARRAY[]::text[]
      END;

      IF v_caller_role IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error',   'Caller não encontrado na empresa'
        );
      END IF;

      IF NOT (p_role = ANY(v_allowed_roles)) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error',   format(
            'Caller com role %L não pode atribuir role %L',
            v_caller_role, p_role
          )
        );
      END IF;
    END IF;

    -- ── BLOQUEIO DE PROMOÇÃO para usuário is_over_plan ──────────────────────
    -- Se o usuário alvo está marcado como excedente, apenas rebaixamento ou
    -- manutenção de role são permitidos. Promoção de role é bloqueada.
    IF COALESCE(v_target_is_over_plan, false) = true THEN
      DECLARE
        v_current_weight integer;
        v_new_weight     integer;
      BEGIN
        v_current_weight := CASE v_target_role
          WHEN 'seller'       THEN 1
          WHEN 'manager'      THEN 2
          WHEN 'admin'        THEN 3
          WHEN 'partner'      THEN 4
          WHEN 'system_admin' THEN 5
          WHEN 'super_admin'  THEN 6
          ELSE 0
        END;
        v_new_weight := CASE p_role
          WHEN 'seller'       THEN 1
          WHEN 'manager'      THEN 2
          WHEN 'admin'        THEN 3
          WHEN 'partner'      THEN 4
          WHEN 'system_admin' THEN 5
          WHEN 'super_admin'  THEN 6
          ELSE 0
        END;
        IF v_new_weight > v_current_weight THEN
          RETURN jsonb_build_object(
            'success',    false,
            'error',      'plan_users_limit_exceeded',
            'error_code', 'PLAN_LIMIT_EXCEEDED',
            'detail',     'Não é possível promover usuário acima do limite do plano. Faça upgrade ou remova usuários.'
          );
        END IF;
      END;
    END IF;
    -- ────────────────────────────────────────────────────────────────────────
  END IF;

  -- ── BLOQUEIO DE REATIVAÇÃO quando empresa está no limite ─────────────────
  -- Se p_is_active = true e o usuário alvo está inativo, verificar max_users
  IF p_is_active = true AND COALESCE(v_target_active, false) = false THEN
    SELECT pl.max_users
      INTO v_max_users
      FROM companies c
      LEFT JOIN plans pl ON pl.id = c.plan_id AND pl.is_active = true
     WHERE c.id = v_company_id;

    IF v_max_users IS NOT NULL THEN
      SELECT count(*)
        INTO v_current_users
        FROM company_users
       WHERE company_id        = v_company_id
         AND is_active         = true
         AND is_platform_member = false;

      IF v_current_users >= v_max_users THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'plan_users_limit_exceeded',
          'error_code', 'PLAN_LIMIT_EXCEEDED',
          'current',    v_current_users,
          'limit',      v_max_users
        );
      END IF;
    END IF;
  END IF;
  -- ────────────────────────────────────────────────────────────────────────

  v_new_perms := p_permissions;

  IF p_permissions IS NOT NULL AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
    FOREACH k IN ARRAY CRITICAL_KEYS LOOP
      v_new_perms := v_new_perms - k;
    END LOOP;
  END IF;

  UPDATE public.company_users
  SET
    role        = COALESCE(p_role,       role),
    permissions = COALESCE(v_new_perms,  permissions),
    is_active   = COALESCE(p_is_active,  is_active),
    updated_at  = now()
  WHERE id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Atualização não aplicada');
  END IF;

  RETURN jsonb_build_object('success', true, 'record_id', p_record_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
