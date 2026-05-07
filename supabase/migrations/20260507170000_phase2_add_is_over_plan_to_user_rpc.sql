-- =============================================================================
-- MIGRATION: Fase 2 — Adiciona is_over_plan ao retorno de get_company_users_with_details
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_company_users_with_details(uuid);

CREATE OR REPLACE FUNCTION public.get_company_users_with_details(p_company_id uuid)
 RETURNS TABLE(
   id                  uuid,
   company_id          uuid,
   user_id             uuid,
   role                text,
   permissions         jsonb,
   created_by          uuid,
   is_active           boolean,
   created_at          timestamp with time zone,
   updated_at          timestamp with time zone,
   profile_picture_url text,
   companies           jsonb,
   display_name        text,
   email               character varying,
   is_over_plan        boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_has_access boolean;
BEGIN
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
    au.email,
    cu.is_over_plan
  FROM company_users cu
  JOIN companies c ON cu.company_id = c.id
  LEFT JOIN auth.users au ON cu.user_id = au.id
  WHERE cu.company_id         = p_company_id
    AND cu.is_active          = true
    AND cu.is_platform_member = FALSE
  ORDER BY cu.created_at DESC;
END;
$$;
