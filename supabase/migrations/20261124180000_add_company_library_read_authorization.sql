-- =============================================================================
-- META-L1.4C.5.1E.3E.4F.B.1
-- Predicado de leitura da biblioteca comercial.
--
-- Reproduz validateCompanyCaller para a matriz de leitura:
--   super_admin, system_admin, admin, manager, seller e partner.
-- A identidade é auth.uid(). A empresa chega só como parâmetro.
-- Membership direta ativa decide e não cai para outra trilha.
-- Partner direto exige assignment ativo. Role desconhecido nega.
-- Sem membership direta, o partner herdado reutiliza
-- public.auth_user_is_partner_for_company. A trilha da empresa pai
-- aceita somente super_admin ou system_admin ativos, com a filha
-- vinculada e a pai do tipo parent.
--
-- public.auth_user_is_parent_admin não é usado: o corpo instalado não
-- exige company_type = parent, e o guard exige.
-- public.auth_user_is_company_member não decide a autorização: aceita
-- qualquer role e partner sem assignment.
--
-- Não altera policies, helpers, dados nem default privileges.
-- Não autoriza escrita, mídia Meta, conversa de terceiro nem Storage.
-- Nenhuma policy referencia esta função nesta etapa.
-- O resultado é sempre true ou false.
-- =============================================================================

CREATE FUNCTION public.auth_user_can_read_company_library(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN auth.uid() IS NULL OR p_company_id IS NULL THEN FALSE
        WHEN membership.direct_role IS NULL THEN
          public.auth_user_is_partner_for_company(p_company_id)
          OR EXISTS (
            SELECT 1
            FROM public.companies AS child
            JOIN public.companies AS parent_company
              ON parent_company.id = child.parent_company_id
            JOIN public.company_users AS parent_membership
              ON parent_membership.company_id = parent_company.id
             AND parent_membership.user_id = auth.uid()
             AND parent_membership.is_active IS TRUE
             AND parent_membership.role IN ('super_admin', 'system_admin')
            WHERE child.id = p_company_id
              AND parent_company.company_type = 'parent'
          )
        WHEN membership.direct_role = 'partner' THEN
          EXISTS (
            SELECT 1
            FROM public.partner_company_assignments AS assignment
            WHERE assignment.partner_user_id = auth.uid()
              AND assignment.company_id = p_company_id
              AND assignment.is_active IS TRUE
          )
        WHEN membership.direct_role IN (
          'super_admin',
          'system_admin',
          'admin',
          'manager',
          'seller'
        ) THEN TRUE
        ELSE FALSE
      END
      FROM (
        SELECT (
          SELECT company_user.role
          FROM public.company_users AS company_user
          WHERE company_user.user_id = auth.uid()
            AND company_user.company_id = p_company_id
            AND company_user.is_active IS TRUE
        ) AS direct_role
      ) AS membership
    ),
    FALSE
  );
$function$;

ALTER FUNCTION public.auth_user_can_read_company_library(uuid)
  OWNER TO postgres;

COMMENT ON FUNCTION public.auth_user_can_read_company_library(uuid) IS
  'Leitura da biblioteca no nível da empresa para o auth.uid() atual. Não autoriza escrita, mídia Meta nem Storage.';

REVOKE ALL
  ON FUNCTION public.auth_user_can_read_company_library(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE
  ON FUNCTION public.auth_user_can_read_company_library(uuid)
  TO authenticated;
