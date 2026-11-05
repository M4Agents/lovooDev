-- Otimiza somente o USING de public.leads_member_or_parent_admin.
-- WITH CHECK, a política leads_support_partner_access, RPCs, índices e o
-- CASE da transferência de leads permanecem como estão.
--
-- Os helpers auth_user_is_company_member, auth_user_is_parent_admin e
-- auth_user_restricted_to_own_leads são SECURITY DEFINER e não obedecem ao
-- RLS de company_users e companies. Um subselect direto na política roda
-- como o usuário da sessão. Em companies, o membro só lê as empresas das
-- políticas de SELECT. is_super_admin/is_system_admin exigem company_type =
-- 'parent'; auth_user_is_parent_admin não exige. O subselect direto pode
-- esconder a empresa filha e estreitar o acesso.
--
-- As funções repetem esse SQL e também são SECURITY DEFINER. O USING consulta
-- cada conjunto uma vez.
--
-- lead_unrestricted_company_ids não lista todas as empresas com a flag
-- desligada. O USING já exige membro ou admin pai antes dessa condição, então
-- o conjunto fica limitado a essas empresas. Chamada direta não revela
-- inquilino fora desse escopo. Sem o limite, a função devolveria todos os
-- ids com restrict_leads_to_owner = false, inclusive com auth.uid() nulo:
-- subselect de política não depende de short-circuit do AND.
--
-- O schema private não está em db.schemas (public, graphql_public). O
-- PostgREST não cria rota RPC para ele. Se o schema for exposto no futuro,
-- o EXECUTE abaixo ainda permitiria chamar as quatro funções. O retorno
-- continua sendo só o escopo do auth.uid() da sessão, vazio quando o uid é
-- nulo. Não há grant herdado: PUBLIC, anon e service_role perdem EXECUTE, e
-- os privilégios padrão de funções novas neste schema também.
--
-- O arquivo inteiro é uma transação. Não há COMMIT. Schema, funções, grants
-- e ALTER POLICY são DDL transacional. A checagem do final aborta o arquivo
-- se a política, o WITH CHECK ou os grants não ficarem como previsto.

CREATE SCHEMA IF NOT EXISTS private;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

COMMENT ON SCHEMA private IS
  'Funções internas da política de leads. Não incluir em db.schemas.';

CREATE OR REPLACE FUNCTION private.lead_member_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cu.company_id
    FROM public.company_users cu
   WHERE auth.uid() IS NOT NULL
     AND cu.user_id = auth.uid()
     AND cu.is_active = true
$$;

CREATE OR REPLACE FUNCTION private.lead_parent_admin_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT child.id
    FROM public.companies child
    JOIN public.company_users cu
      ON cu.company_id = child.parent_company_id
   WHERE auth.uid() IS NOT NULL
     AND child.parent_company_id IS NOT NULL
     AND cu.user_id = auth.uid()
     AND cu.is_active = true
     AND cu.role IN ('super_admin', 'system_admin')
$$;

-- Equivale, dentro do USING, a restrict_leads_to_owner = false.
-- A flag é NOT NULL. O recorte por membro ou admin pai não muda o resultado
-- da política porque o USING já exige essa mesma condição.
CREATE OR REPLACE FUNCTION private.lead_unrestricted_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM public.companies c
   WHERE auth.uid() IS NOT NULL
     AND c.restrict_leads_to_owner = false
     AND (
       EXISTS (
         SELECT 1
           FROM public.company_users cu
          WHERE cu.company_id = c.id
            AND cu.user_id = auth.uid()
            AND cu.is_active = true
       )
       OR EXISTS (
         SELECT 1
           FROM public.company_users cu
          WHERE cu.company_id = c.parent_company_id
            AND c.parent_company_id IS NOT NULL
            AND cu.user_id = auth.uid()
            AND cu.is_active = true
            AND cu.role IN ('super_admin', 'system_admin')
       )
     )
$$;

CREATE OR REPLACE FUNCTION private.lead_view_all_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cu.company_id
    FROM public.company_users cu
   WHERE auth.uid() IS NOT NULL
     AND cu.user_id = auth.uid()
     AND cu.is_active = true
     AND coalesce((cu.permissions ->> 'view_all_leads')::boolean, false)
$$;

ALTER FUNCTION private.lead_member_company_ids() OWNER TO postgres;
ALTER FUNCTION private.lead_parent_admin_company_ids() OWNER TO postgres;
ALTER FUNCTION private.lead_unrestricted_company_ids() OWNER TO postgres;
ALTER FUNCTION private.lead_view_all_company_ids() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.lead_member_company_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lead_parent_admin_company_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lead_unrestricted_company_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lead_view_all_company_ids() FROM PUBLIC, anon, authenticated, service_role;

-- anon precisa executar a expressão da política se conseguir ler leads.
-- Com uid nulo as quatro funções devolvem zero linhas.
-- service_role tem BYPASSRLS e a tabela não força RLS, então não avalia a
-- política e não recebe EXECUTE.
GRANT EXECUTE ON FUNCTION private.lead_member_company_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lead_parent_admin_company_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lead_unrestricted_company_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lead_view_all_company_ids() TO anon, authenticated;

COMMENT ON FUNCTION private.lead_member_company_ids() IS
  'Membresias ativas do auth.uid(). Vazio se o uid for nulo.';
COMMENT ON FUNCTION private.lead_parent_admin_company_ids() IS
  'Filhas em que o auth.uid() é super_admin ou system_admin ativo na pai. Vazio se o uid for nulo.';
COMMENT ON FUNCTION private.lead_unrestricted_company_ids() IS
  'Empresas do próprio membro ou admin pai com restrict_leads_to_owner = false. Não lista outros inquilinos.';
COMMENT ON FUNCTION private.lead_view_all_company_ids() IS
  'Membresia ativa do auth.uid() com view_all_leads verdadeiro. Vazio se o uid for nulo.';

ALTER POLICY leads_member_or_parent_admin
  ON public.leads
  USING (
    (current_setting('role'::text) = 'service_role'::text)
    OR (
      (auth.uid() IS NOT NULL)
      AND (
        company_id IN (SELECT private.lead_member_company_ids())
        OR company_id IN (SELECT private.lead_parent_admin_company_ids())
      )
      AND (
        company_id IN (SELECT private.lead_unrestricted_company_ids())
        OR company_id IN (SELECT private.lead_view_all_company_ids())
        OR (responsible_user_id = auth.uid())
        OR (
          CASE
            WHEN coalesce(current_setting('lovoo.seller_reassign_visible_lead_id', true), '') = ''
              THEN false
            ELSE public.seller_lead_reassign_visible(company_id, id, responsible_user_id)
          END
        )
      )
    )
  );

DO $$
DECLARE
  v_name text;
  v_using text;
  v_check text;
  v_partner text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'lead_member_company_ids',
    'lead_parent_admin_company_ids',
    'lead_unrestricted_company_ids',
    'lead_view_all_company_ids'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'private'
         AND p.proname = v_name
         AND pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proacl IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
    ) THEN
      RAISE EXCEPTION 'funcao private.% fora do previsto', v_name;
    END IF;

    IF NOT has_function_privilege('anon', format('private.%I()', v_name), 'EXECUTE')
       OR NOT has_function_privilege('authenticated', format('private.%I()', v_name), 'EXECUTE')
       OR has_function_privilege('service_role', format('private.%I()', v_name), 'EXECUTE')
    THEN
      RAISE EXCEPTION 'grants de private.% fora do previsto', v_name;
    END IF;
  END LOOP;

  IF NOT has_schema_privilege('anon', 'private', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE')
  THEN
    RAISE EXCEPTION 'USAGE do schema private fora do previsto';
  END IF;

  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
    FROM pg_policy
   WHERE polrelid = 'public.leads'::regclass
     AND polname = 'leads_member_or_parent_admin';

  IF v_using IS NULL
     OR v_using NOT LIKE '%lead_member_company_ids%'
     OR v_using NOT LIKE '%lead_parent_admin_company_ids%'
     OR v_using NOT LIKE '%lead_unrestricted_company_ids%'
     OR v_using NOT LIKE '%lead_view_all_company_ids%'
     OR v_using NOT LIKE '%seller_lead_reassign_visible%'
     OR v_check IS NULL
     OR v_check NOT LIKE '%auth_user_is_company_member%'
     OR v_check LIKE '%lead_member_company_ids%'
     OR v_check LIKE '%lead_parent_admin_company_ids%'
     OR v_check LIKE '%lead_unrestricted_company_ids%'
     OR v_check LIKE '%lead_view_all_company_ids%'
  THEN
    RAISE EXCEPTION 'USING ou WITH CHECK de leads_member_or_parent_admin divergiu';
  END IF;

  SELECT pg_get_expr(polqual, polrelid)
    INTO v_partner
    FROM pg_policy
   WHERE polrelid = 'public.leads'::regclass
     AND polname = 'leads_support_partner_access';

  IF v_partner IS NULL
     OR v_partner LIKE '%lead_member_company_ids%'
     OR v_partner LIKE '%lead_parent_admin_company_ids%'
     OR v_partner LIKE '%lead_unrestricted_company_ids%'
     OR v_partner LIKE '%lead_view_all_company_ids%'
  THEN
    RAISE EXCEPTION 'leads_support_partner_access foi alterada';
  END IF;
END $$;

-- Recuperação em duas transações. Não faz parte da aplicação.
-- A primeira só restaura o USING. A confirmação fica fora dela.
-- A segunda, e só depois da confirmação, revoga EXECUTE.
-- Não há DROP nem renomeação. O ALTER não informa WITH CHECK.
--
-- -- 1. Transação curta. Sem SELECT em leads, companies ou company_users.
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- SET LOCAL statement_timeout = '5s';
-- ALTER POLICY leads_member_or_parent_admin
--   ON public.leads
--   USING (
--     (current_setting('role'::text) = 'service_role'::text)
--     OR (
--       (auth.uid() IS NOT NULL)
--       AND (auth_user_is_company_member(company_id) OR auth_user_is_parent_admin(company_id))
--       AND (
--         (NOT auth_user_restricted_to_own_leads(company_id))
--         OR (responsible_user_id = auth.uid())
--         OR (
--           CASE
--             WHEN coalesce(current_setting('lovoo.seller_reassign_visible_lead_id', true), '') = ''
--               THEN false
--             ELSE public.seller_lead_reassign_visible(company_id, id, responsible_user_id)
--           END
--         )
--       )
--     )
--   );
-- COMMIT;
--
-- -- 2. Confirmação, fora da transação acima. Só catálogo.
-- -- Esperado: USING com auth_user_is_company_member e seller_lead_reassign_visible,
-- -- sem lead_member_company_ids. WITH CHECK com auth_user_is_company_member
-- -- e sem as quatro funções private.
-- -- SELECT pg_get_expr(polqual, polrelid) AS using_expr,
-- --        pg_get_expr(polwithcheck, polrelid) AS check_expr
-- --   FROM pg_policy
-- --  WHERE polrelid = 'public.leads'::regclass
-- --    AND polname = 'leads_member_or_parent_admin';
--
-- -- 3. Outra transação, somente depois da confirmação.
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- SET LOCAL statement_timeout = '5s';
-- DO $$
-- DECLARE
--   v_oid oid;
--   v_name text;
-- BEGIN
--   FOREACH v_name IN ARRAY ARRAY[
--     'lead_member_company_ids',
--     'lead_parent_admin_company_ids',
--     'lead_unrestricted_company_ids',
--     'lead_view_all_company_ids'
--   ]
--   LOOP
--     SELECT p.oid INTO v_oid
--       FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'private' AND p.proname = v_name;
--
--     IF v_oid IS NULL THEN
--       CONTINUE;
--     END IF;
--
--     IF EXISTS (
--       SELECT 1
--         FROM pg_depend d
--        WHERE d.refobjid = v_oid
--          AND d.classid IN (
--            'pg_policy'::regclass,
--            'pg_proc'::regclass,
--            'pg_rewrite'::regclass,
--            'pg_class'::regclass,
--            'pg_trigger'::regclass
--          )
--     ) THEN
--       RAISE NOTICE 'EXECUTE mantido em private.%: ainda ha dependencia', v_name;
--       CONTINUE;
--     END IF;
--
--     EXECUTE format(
--       'REVOKE ALL ON FUNCTION private.%I() FROM PUBLIC, anon, authenticated, service_role',
--       v_name
--     );
--   END LOOP;
-- END $$;
-- COMMIT;
