-- =====================================================
-- MIGRATION: Adicionar system_admin às RPCs de usuário
-- Data: 22/04/2026
-- Fases: update_company_user_safe, create_company_user_safe
--        Adicionar system_admin como role válido.
--
-- Regras:
--   - system_admin só é criável/promovível por super_admin
--   - system_admin apenas em empresas parent (não client)
--   - system_admin não pode ser promovido para super_admin
--     (promoção para super_admin continua exclusiva de super_admin)
-- =====================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. update_company_user_safe — adicionar system_admin ao VALID_ROLES
--    e bloquear promoção para system_admin por não-super_admin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_company_user_safe(
  p_record_id  uuid,
  p_role       text    DEFAULT NULL,
  p_permissions jsonb  DEFAULT NULL,
  p_is_active  boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id   uuid;
  v_company_type text;
  v_caller_role  text;
  v_can_edit     boolean;

  VALID_ROLES    text[] := ARRAY['super_admin', 'system_admin', 'admin', 'partner', 'manager', 'seller'];
  CLIENT_ROLES   text[] := ARRAY['admin', 'manager', 'seller'];
  SAAS_ONLY_ROLES text[] := ARRAY['super_admin', 'system_admin', 'partner'];
  CRITICAL_KEYS  text[] := ARRAY['companies', 'impersonate'];

  k              text;
  v_new_perms    jsonb;
BEGIN
  SELECT cu.company_id, c.company_type
  INTO   v_company_id, v_company_type
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

  IF p_role IS NOT NULL THEN
    -- Validar role permitido
    IF NOT (p_role = ANY(VALID_ROLES)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role inválido: %L', p_role)
      );
    END IF;

    -- Roles SaaS apenas em empresa parent
    IF v_company_type = 'client' AND p_role = ANY(SAAS_ONLY_ROLES) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role %L não é permitido em empresa do tipo client', p_role)
      );
    END IF;

    -- Promoção para super_admin requer ser super_admin
    IF p_role = 'super_admin' AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Promoção para super_admin requer ser super_admin'
      );
    END IF;

    -- Promoção para system_admin requer ser super_admin
    IF p_role = 'system_admin' AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Promoção para system_admin requer ser super_admin'
      );
    END IF;
  END IF;

  v_new_perms := p_permissions;

  -- Remover chaves críticas se caller não for super_admin
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. create_company_user_safe — atualizar validação de roles permitidos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_company_user_safe(
  p_company_id   uuid,
  p_user_id      uuid,
  p_role         text,
  p_permissions  jsonb DEFAULT NULL,
  p_created_by   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result              company_users;
  v_company             companies;
  v_creator_permissions boolean := false;
  v_existing_user       company_users;
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

  -- Validar role
  IF p_role NOT IN ('super_admin', 'system_admin', 'admin', 'partner', 'manager', 'seller') THEN
    RAISE EXCEPTION 'Role inválido: %', p_role;
  END IF;

  -- Roles SaaS apenas em parent
  IF v_company.company_type = 'client' AND p_role IN ('super_admin', 'system_admin', 'partner') THEN
    RAISE EXCEPTION 'Role % não permitido em empresa do tipo client', p_role;
  END IF;

  IF p_created_by IS NOT NULL THEN
    SELECT true INTO v_creator_permissions
    FROM company_users cu
    JOIN companies c ON cu.company_id = c.id
    WHERE cu.user_id = p_created_by
    AND cu.is_active = true
    AND (
      (cu.role IN ('super_admin', 'system_admin') AND c.company_type = 'parent')
      OR
      (cu.role = 'admin' AND (cu.company_id = p_company_id OR c.parent_company_id = cu.company_id))
    );

    IF NOT v_creator_permissions THEN
      RAISE EXCEPTION 'Usuário % não tem permissão para criar usuários na empresa %', p_created_by, p_company_id;
    END IF;
  END IF;

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
$function$;
