-- TECH-MEDIA-012.4B.10B
-- Autorização de INSERT em public.lead_media_unified.
-- O predicado é o aprovado em 4B.10A.1. A leitura do vínculo direto usa uma
-- âncora com LEFT JOIN para sempre emitir uma linha. Sem isso, a ausência de
-- membership não entra no CASE e o COALESCE devolve FALSE, sem avaliar herança.

BEGIN;

CREATE FUNCTION public.auth_user_can_insert_company_library(p_company_id uuid)
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
        WHEN direct.role IS NOT NULL AND direct.is_active IS TRUE THEN
          CASE
            WHEN direct.role = 'partner' THEN
              EXISTS (
                SELECT 1
                FROM public.partner_company_assignments AS assignment
                WHERE assignment.partner_user_id = auth.uid()
                  AND assignment.company_id = p_company_id
                  AND assignment.is_active IS TRUE
              )
            WHEN direct.role IN (
              'super_admin', 'system_admin', 'admin', 'manager', 'seller'
            ) THEN TRUE
            ELSE FALSE
          END
        ELSE
          EXISTS (
            SELECT 1
            FROM public.companies AS child
            JOIN public.companies AS parent_company
              ON parent_company.id = child.parent_company_id
            JOIN public.company_users AS parent_membership
              ON parent_membership.company_id = parent_company.id
             AND parent_membership.user_id = auth.uid()
             AND parent_membership.is_active IS TRUE
             AND parent_membership.role = 'partner'
            JOIN public.partner_company_assignments AS assignment
              ON assignment.partner_user_id = parent_membership.user_id
             AND assignment.company_id = child.id
             AND assignment.is_active IS TRUE
            WHERE child.id = p_company_id
              AND parent_company.company_type = 'parent'
          )
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
      END
      FROM (
        SELECT direct_row.role, direct_row.is_active
        FROM (SELECT 1) AS anchor
        LEFT JOIN public.company_users AS direct_row
          ON direct_row.user_id = auth.uid()
         AND direct_row.company_id = p_company_id
      ) AS direct
    ),
    FALSE
  );
$function$;

ALTER FUNCTION public.auth_user_can_insert_company_library(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.auth_user_can_insert_company_library(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.auth_user_can_insert_company_library(uuid)
  TO authenticated;

DROP POLICY biblioteca_insert_authenticated ON public.lead_media_unified;

CREATE POLICY lead_media_unified_insert_company_library
  ON public.lead_media_unified
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_user_can_insert_company_library(company_id)
  );

COMMIT;
