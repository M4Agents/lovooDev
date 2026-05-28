-- =====================================================================
-- Migration: RPC resolve_responsible_users_by_email
-- Data: 2026-05-28
--
-- Objetivo:
--   Resolver emails do CSV de importação para user_id de membros ativos
--   da empresa. Usada exclusivamente pelo endpoint backend
--   POST /api/leads/import-file (via service_role) para atribuir
--   responsible_user_id a leads importados.
--
-- Segurança:
--   - SECURITY DEFINER permite o JOIN em auth.users (schema privado).
--   - Não usa auth.uid(): o endpoint já valida o caller antes de chamar.
--   - Restrita a membros ATIVOS da empresa (company_users.is_active = true).
--   - Compara emails normalizados (lower + trim) para evitar case mismatch.
--   - Retorna apenas pares (email, user_id) dentro do p_company_id.
--     Nunca vaza dados de outras empresas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_responsible_users_by_email(
  p_company_id uuid,
  p_emails     text[]
)
RETURNS TABLE(email text, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    lower(trim(au.email))::text AS email,
    cu.user_id
  FROM company_users cu
  JOIN auth.users au ON au.id = cu.user_id
  WHERE cu.company_id = p_company_id
    AND cu.is_active  = true
    AND lower(trim(au.email::text)) = ANY(
      SELECT lower(trim(e)) FROM unnest(p_emails) AS t(e)
    );
END;
$function$;

COMMENT ON FUNCTION public.resolve_responsible_users_by_email IS
'Resolve emails de responsáveis para user_id em importações de leads. '
'Chamada pelo backend (service_role) — não valida caller internamente. '
'Retorna apenas membros ativos da empresa informada. '
'Criada em 2026-05-28 para suporte à coluna optional responsible_user_email no import.';
