-- =====================================================
-- MIGRATION: FIX GET_COMPANY_USERS_WITH_DETAILS - FILTRAR APENAS ATIVOS
-- Data: 22/03/2026
-- Objetivo: Adicionar filtro is_active = true na RPC function
-- =====================================================

-- Atualizar função para retornar apenas usuários ativos
CREATE OR REPLACE FUNCTION public.get_company_users_with_details(p_company_id uuid)
RETURNS TABLE(
  id uuid, 
  company_id uuid, 
  user_id uuid, 
  role text, 
  permissions jsonb, 
  created_by uuid, 
  is_active boolean, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone, 
  profile_picture_url text, 
  companies jsonb, 
  display_name text, 
  email character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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
      'id', c.id,
      'name', c.name,
      'company_type', c.company_type
    ) as companies,
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1)
    )::text as display_name,
    au.email
  FROM company_users cu
  JOIN companies c ON cu.company_id = c.id
  LEFT JOIN auth.users au ON cu.user_id = au.id
  WHERE cu.company_id = p_company_id
    AND cu.is_active = true  -- FILTRAR APENAS USUÁRIOS ATIVOS
  ORDER BY cu.created_at DESC;
END;
$function$;

-- Comentário
COMMENT ON FUNCTION get_company_users_with_details(uuid) IS 
'Retorna usuários ativos de uma empresa com detalhes completos. Usado em Chat, Automações e outras funcionalidades que precisam listar usuários.';
