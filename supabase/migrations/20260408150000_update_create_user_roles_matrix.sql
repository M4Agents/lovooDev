-- =====================================================
-- MIGRATION: Alinhar create_company_user_safe com matriz explícita de roles
-- Data: 08/04/2026
--
-- Contexto:
--   O check anterior validava apenas se o creator era admin, system_admin
--   ou super_admin (sem verificar qual role estava sendo criado).
--   A nova regra usa a mesma matriz explícita do frontend e de
--   update_company_user_safe.
--
-- Matriz aprovada:
--   super_admin  → super_admin, system_admin, partner, admin, manager, seller
--   system_admin → partner, admin, manager, seller
--   partner      → admin, manager, seller
--   admin        → admin, manager, seller
--   manager      → (nenhum)
--   seller       → (nenhum)
-- =====================================================

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
  v_existing_user       company_users;
  v_caller_role         text;
  v_allowed_roles       text[];
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

  -- Validar permissão do creator usando matriz explícita
  IF p_created_by IS NOT NULL THEN
    -- Buscar role do creator na empresa (direto ou via parent)
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
      -- Priorizar vínculo direto
      CASE WHEN cu.company_id = p_company_id THEN 0 ELSE 1 END
    LIMIT 1;

    -- Matriz explícita: callerRole → roles que pode criar
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
