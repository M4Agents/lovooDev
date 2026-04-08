-- =====================================================
-- MIGRATION: create_client_company_safe
-- Data: 22/04/2026
-- Objetivo: RPC transacional para criação de empresa client.
--
-- Regras:
--   - Apenas super_admin, system_admin ou partner podem criar
--   - Cria company + company_users para super_admin da parent (atomicamente)
--   - Se caller é partner: gera assignment automático em partner_company_assignments
--     e registra created_by_partner_id na company
--   - Apenas partner gera auto-assignment (super_admin e system_admin não)
-- =====================================================

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

  -- 6. Criar a empresa client (sem user_id — cliente se torna dono no primeiro login)
  INSERT INTO public.companies (
    name,
    domain,
    plan,
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
    p_parent_company_id,
    'client',
    NULL,
    'active',
    CASE WHEN v_is_partner THEN v_caller_id ELSE NULL END
  )
  RETURNING id INTO v_new_company_id;

  -- 7. Associar super_admin da parent à nova empresa via company_users
  INSERT INTO public.company_users (
    company_id,
    user_id,
    role,
    permissions,
    is_active,
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
    v_caller_id,
    now(),
    now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role        = 'super_admin',
    permissions = v_super_perms,
    is_active   = true,
    updated_at  = now();

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

  RETURN jsonb_build_object(
    'success',     true,
    'company_id',  v_new_company_id,
    'auto_assigned', v_is_partner
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client_company_safe(uuid, text, text, text) TO authenticated;
