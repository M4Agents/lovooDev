-- =====================================================
-- MIGRATION: Branch de partner nas RPCs de autorização
-- Data: 22/04/2026
-- Objetivo:
--   - caller_has_permission: quando caller não tem company_users
--     na empresa consultada, verificar se é um partner com
--     assignment ativo (partner_company_assignments) e usar
--     suas permissões da empresa parent.
--   - get_company_users_with_details: adicionar validação de
--     acesso ao caller (partner só vê empresas atribuídas).
-- =====================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. caller_has_permission — branch partner
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caller_has_permission(
  p_company_id     uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_permissions    jsonb;
  v_caller_id      uuid := auth.uid();
  v_partner_perms  jsonb;
BEGIN
  -- Tentativa 1: caller tem company_users diretamente na empresa consultada
  SELECT cu.permissions
  INTO   v_permissions
  FROM   public.company_users cu
  WHERE  cu.user_id    = v_caller_id
    AND  cu.company_id = p_company_id
    AND  cu.is_active  = true;

  IF FOUND THEN
    RETURN COALESCE((v_permissions ->> p_permission_key)::boolean, false);
  END IF;

  -- Tentativa 2: caller é um partner com assignment ativo para esta empresa
  -- → usa as permissões da empresa parent (onde ele tem company_users)
  SELECT cu.permissions INTO v_partner_perms
  FROM public.company_users cu
  JOIN public.companies c ON c.id = cu.company_id AND c.company_type = 'parent'
  WHERE cu.user_id   = v_caller_id
    AND cu.role      = 'partner'
    AND cu.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.partner_company_assignments pca
      WHERE pca.partner_user_id = v_caller_id
        AND pca.company_id      = p_company_id
        AND pca.is_active       = true
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN COALESCE((v_partner_perms ->> p_permission_key)::boolean, false);
  END IF;

  -- Nenhum registro encontrado → sem acesso
  RETURN false;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_company_users_with_details — validar acesso do caller
-- ─────────────────────────────────────────────────────────────────────────────
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
  WHERE cu.company_id = p_company_id
    AND cu.is_active  = true
  ORDER BY cu.created_at DESC;
END;
$$;

-- get_company_partner_assignments
CREATE OR REPLACE FUNCTION public.get_company_partner_assignments(
  p_company_id uuid
)
RETURNS TABLE (
  partner_user_id uuid,
  email           varchar,
  display_name    text,
  assigned_at     timestamptz,
  assigned_by     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT cu.role INTO v_caller_role
    FROM company_users cu
    JOIN companies c ON c.id = cu.company_id AND c.company_type = 'parent'
   WHERE cu.user_id = v_caller_id
     AND cu.is_active = true
     AND cu.role IN ('super_admin', 'system_admin')
   LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT
      pca.partner_user_id,
      au.email,
      COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'display_name',
        au.raw_user_meta_data->>'full_name',
        split_part(au.email::text, '@', 1)
      )::text AS display_name,
      pca.assigned_at,
      pca.assigned_by
    FROM public.partner_company_assignments pca
    JOIN auth.users au ON au.id = pca.partner_user_id
   WHERE pca.company_id = p_company_id
     AND pca.is_active  = true
   ORDER BY pca.assigned_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_partner_assignments(uuid) TO authenticated;
