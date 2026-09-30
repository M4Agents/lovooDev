-- VERIFY — somente leitura. Fora da sequência automática de migrations.
-- PREFLIGHT (antes do apply) e POSTFLIGHT (depois do apply).
-- Obrigatório: SET app.verify_mode = 'preflight' | 'postflight' na sessão.
--   preflight: aborta se existir QUALQUER assinatura *_assignee
--   postflight: exige exatamente uma assinatura esperada por nome
-- Não altera dados. Não usa service_role como prova de RBAC.
-- PUBLIC: auditar com proacl + aclexplode (grantee = 0). Não usar
-- has_function_privilege('public'|'PUBLIC', ...).

BEGIN;

CREATE TEMP TABLE funnel_assignee_old_baseline (
  k text PRIMARY KEY,
  def_md5 text NOT NULL,
  identity_args text NOT NULL,
  result_type text NOT NULL,
  proacl text NOT NULL
) ON COMMIT DROP;

INSERT INTO funnel_assignee_old_baseline (k, def_md5, identity_args, result_type, proacl) VALUES
  ('get_funnel_stage_counts|5',
   'f21f9c6aef73eb366d19d8421d0d47ec',
   'p_funnel_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('get_funnel_stage_counts|7',
   '8db0e910d0dc77b638e27f879bb43dfb',
   'p_funnel_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer, p_tag_ids uuid[], p_tag_mode text',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('get_funnel_stage_counts|12',
   'b2e0e4610ae1bcf08540489826382bf1',
   'p_funnel_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer, p_tag_ids uuid[], p_tag_mode text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_owner_user_id uuid, p_contact_attempts_state text, p_date_field text',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('get_stage_positions_paged|8',
   '09cf8fe178a9c0013abc19339c48d5dc',
   'p_funnel_id uuid, p_stage_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer, p_limit integer, p_offset integer',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('get_stage_positions_paged|10',
   'e62e5c46450354bbdb4f2c3a72e8e272',
   'p_funnel_id uuid, p_stage_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer, p_limit integer, p_offset integer, p_tag_ids uuid[], p_tag_mode text',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('get_stage_positions_paged|16',
   'db8ea35e7e4a3e2ff6c56ba58381c28a',
   'p_funnel_id uuid, p_stage_id uuid, p_company_id uuid, p_search text, p_origin text, p_period_days integer, p_limit integer, p_offset integer, p_tag_ids uuid[], p_tag_mode text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_sort_by text, p_owner_user_id uuid, p_contact_attempts_state text, p_date_field text',
   'jsonb',
   '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}');

DO $old_intact$
DECLARE
  rec record;
  exp record;
  key text;
  old_count int;
BEGIN
  SELECT count(*) INTO old_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_stage_positions_paged', 'get_funnel_stage_counts');

  IF old_count <> 6 THEN
    RAISE EXCEPTION 'VERIFY: expected 6 old overloads, found % — stop for review', old_count;
  END IF;

  FOR rec IN
    SELECT
      p.proname,
      p.pronargs,
      md5(pg_get_functiondef(p.oid)) AS def_md5,
      pg_get_function_identity_arguments(p.oid) AS identity_args,
      pg_get_function_result(p.oid) AS result_type,
      p.proacl::text AS proacl,
      (
        p.proacl IS NULL
        OR EXISTS (
          SELECT 1
          FROM aclexplode(p.proacl) a
          WHERE a.grantee = 0
            AND a.privilege_type = 'EXECUTE'
        )
      ) AS public_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_stage_positions_paged', 'get_funnel_stage_counts')
    ORDER BY 1, 2
  LOOP
    key := rec.proname || '|' || rec.pronargs::text;
    SELECT * INTO exp FROM funnel_assignee_old_baseline b WHERE b.k = key;
    IF NOT FOUND
       OR rec.def_md5 IS DISTINCT FROM exp.def_md5
       OR rec.identity_args IS DISTINCT FROM exp.identity_args
       OR rec.result_type IS DISTINCT FROM exp.result_type
       OR rec.proacl IS DISTINCT FROM exp.proacl
       OR rec.public_execute IS NOT TRUE
       OR rec.anon_execute IS NOT TRUE
       OR rec.authenticated_execute IS NOT TRUE
       OR rec.service_role_execute IS NOT TRUE THEN
      RAISE EXCEPTION 'VERIFY: old function % diverges from baseline — stop for review', key;
    END IF;
  END LOOP;

  RAISE NOTICE 'VERIFY: 6 old functions intact (md5 + identity_args + result_type + proacl + aclexplode PUBLIC + role EXECUTE)';
END
$old_intact$;

SELECT p.proname,
       p.pronargs,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       md5(pg_get_functiondef(p.oid)) AS def_md5,
       p.proacl::text AS proacl,
       (
         p.proacl IS NULL
         OR EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) a
           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         )
       ) AS public_execute_aclexplode,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_stage_positions_paged', 'get_funnel_stage_counts')
ORDER BY p.proname, p.pronargs;

-- Explosão de ACL das seis antigas (PUBLIC = grantee 0)
SELECT p.proname,
       p.pronargs,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type,
       a.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND p.proname IN ('get_stage_positions_paged', 'get_funnel_stage_counts')
ORDER BY p.proname, p.pronargs, a.grantee, a.privilege_type;

SELECT p.proname,
       p.pronargs,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       p.prosecdef AS security_definer,
       p.proacl::text AS proacl,
       (
         p.proacl IS NULL
         OR EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) a
           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         )
       ) AS public_execute_aclexplode,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee',
    'get_funnel_stage_counts_assignee'
  )
ORDER BY p.proname;

SELECT p.proname,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type,
       a.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee',
    'get_funnel_stage_counts_assignee'
  )
ORDER BY p.proname, a.grantee, a.privilege_type;

DO $new_acl$
DECLARE
  v_mode text;
  n_pos int;
  n_cnt int;
  pos oid;
  cnt oid;
  pos_acl aclitem[];
  cnt_acl aclitem[];
BEGIN
  v_mode := current_setting('app.verify_mode', true);
  IF v_mode IS NULL OR v_mode NOT IN ('preflight', 'postflight') THEN
    RAISE EXCEPTION 'VERIFY: SET app.verify_mode TO preflight|postflight before running';
  END IF;

  SELECT count(*) INTO n_pos
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_stage_positions_paged_assignee';
  SELECT count(*) INTO n_cnt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_funnel_stage_counts_assignee';

  IF v_mode = 'preflight' THEN
    IF n_pos > 0 OR n_cnt > 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: *_assignee already exists (any signature; pos=% cnt=%)', n_pos, n_cnt;
    END IF;
    RAISE NOTICE 'VERIFY: new function names absent (preflight OK)';
    RETURN;
  END IF;

  -- postflight: ausência das duas não pode passar (nem via RETURN)
  IF n_pos = 0 AND n_cnt = 0 THEN
    RAISE EXCEPTION 'POSTFLIGHT: both *_assignee functions are absent';
  END IF;

  IF n_pos <> 1 OR n_cnt <> 1 THEN
    RAISE EXCEPTION 'POSTFLIGHT: expected exactly one signature per *_assignee name (pos=% cnt=%)', n_pos, n_cnt;
  END IF;

  pos := to_regprocedure(
    'public.get_stage_positions_paged_assignee(uuid,uuid,uuid,text,text,integer,integer,integer,uuid[],text,timestamptz,timestamptz,text,uuid,text,text,boolean)'
  );
  cnt := to_regprocedure(
    'public.get_funnel_stage_counts_assignee(uuid,uuid,text,text,integer,uuid[],text,timestamptz,timestamptz,uuid,text,text,boolean)'
  );
  IF pos IS NULL OR cnt IS NULL THEN
    RAISE EXCEPTION 'VERIFY: *_assignee signature does not match the expected one';
  END IF;

  SELECT p.proacl INTO pos_acl FROM pg_proc p WHERE p.oid = pos;
  SELECT p.proacl INTO cnt_acl FROM pg_proc p WHERE p.oid = cnt;

  IF pos_acl IS NULL OR cnt_acl IS NULL THEN
    RAISE EXCEPTION 'VERIFY: NULL proacl on new function implies PUBLIC EXECUTE';
  END IF;

  IF EXISTS (
       SELECT 1 FROM aclexplode(pos_acl) a
       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1 FROM aclexplode(cnt_acl) a
       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', pos, 'EXECUTE')
     OR has_function_privilege('service_role', pos, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', pos, 'EXECUTE')
     OR has_function_privilege('anon', cnt, 'EXECUTE')
     OR has_function_privilege('service_role', cnt, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', cnt, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: new function ACL is not authenticated-only';
  END IF;

  RAISE NOTICE 'VERIFY: new functions present with authenticated-only EXECUTE (PUBLIC via aclexplode)';
END
$new_acl$;

COMMIT;
