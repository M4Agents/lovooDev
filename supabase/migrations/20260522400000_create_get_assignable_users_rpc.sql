-- =====================================================================
-- Migration: Criar RPC get_assignable_users para atribuição de responsável
-- Data: 2026-05-22
--
-- Problema:
--   get_company_users_with_details exige permissão 'users: true'.
--   manager e seller têm 'users: false' por padrão, portanto a lista
--   de usuários fica vazia no chat quando tentam atribuir responsável.
--
-- Solução:
--   Nova RPC get_assignable_users com autorização mais permissiva:
--   qualquer membro ativo da empresa pode listar usuários para
--   fins de atribuição de responsável em leads.
--   Retorna apenas os campos necessários (sem dados de gestão).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_assignable_users(p_company_id uuid)
RETURNS TABLE(
  id                  uuid,
  user_id             uuid,
  display_name        text,
  email               character varying,
  profile_picture_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_access boolean;
BEGIN
  -- Trilha 1: qualquer membro ativo da empresa
  SELECT public.auth_user_is_company_member(p_company_id) INTO v_has_access;

  -- Trilha 2: super_admin / system_admin da empresa pai
  IF NOT v_has_access THEN
    SELECT public.auth_user_is_parent_admin(p_company_id) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of company %', p_company_id;
  END IF;

  RETURN QUERY
  SELECT
    cu.id,
    cu.user_id,
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1)
    )::text AS display_name,
    au.email,
    cu.profile_picture_url
  FROM company_users cu
  LEFT JOIN auth.users au ON cu.user_id = au.id
  WHERE cu.company_id         = p_company_id
    AND cu.is_active          = true
    AND cu.is_platform_member = FALSE
  ORDER BY display_name ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_assignable_users IS
'Retorna membros ativos da empresa para fins de atribuição de responsável em leads. '
'Acessível a qualquer membro ativo (sem exigir permissão users:true). '
'Criado em 2026-05-22 para resolver lista vazia para manager/seller no chat.';
