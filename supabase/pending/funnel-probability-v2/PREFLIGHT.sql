-- SOMENTE LEITURA. Não aplica DDL.
-- Abortar APPLY se qualquer checagem falhar.

-- 1) Contratos atuais intactos
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_result(p.oid) AS result,
       p.prosecdef AS security_definer,
       p.proconfig AS config,
       p.proowner::regrole::text AS owner,
       p.proacl::text AS acl,
       md5(p.prosrc) AS src_md5,
       encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS src_sha256
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee',
    'get_funnel_stage_counts_assignee'
  )
ORDER BY 1;

-- Esperado:
-- positions sha256 3105bed88016b8f0e977906a98118663ef5832af687572f8722fb38f2342b868
-- counts    sha256 23cb0e74edc0c520c1446aec4f72fc502309b976235f4857ffa01ba0608128a7
-- owner postgres, search_path=public, acl só postgres+authenticated

-- 2) v2 ainda não existe
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee_v2',
    'get_funnel_stage_counts_assignee_v2'
  );
-- Esperado: 0 linhas. Se existir, parar e comparar antes de CREATE OR REPLACE.

-- 3) EXECUTE efetivo das atuais
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee',
    'get_funnel_stage_counts_assignee'
  );
-- Esperado: anon false, authenticated true, service_role false
