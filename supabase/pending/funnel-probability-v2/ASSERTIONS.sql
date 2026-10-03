-- Rodar DEPOIS do APPLY autorizado. Sem DML em dados de cliente.
-- Se alguma linha "ok" for false, investigar antes de ligar a flag.

-- A) Atuais inalteradas
SELECT p.proname,
       encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS src_sha256,
       encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') IN (
         '3105bed88016b8f0e977906a98118663ef5832af687572f8722fb38f2342b868',
         '23cb0e74edc0c520c1446aec4f72fc502309b976235f4857ffa01ba0608128a7'
       ) AS hash_matches_pre_apply,
       p.proowner::regrole::text = 'postgres' AS owner_ok,
       p.proconfig = ARRAY['search_path=public'] AS search_path_ok,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
       NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_denied,
       NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_denied
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee',
    'get_funnel_stage_counts_assignee'
  );

-- B) v2 criadas com grants corretos
SELECT p.proname,
       p.prosecdef AS security_definer,
       p.proowner::regrole::text = 'postgres' AS owner_ok,
       p.proconfig = ARRAY['search_path=public'] AS search_path_ok,
       pg_get_function_result(p.oid) = 'jsonb' AS returns_jsonb,
       pg_get_function_identity_arguments(p.oid) ILIKE '%p_probability_min integer%' AS has_min,
       pg_get_function_identity_arguments(p.oid) ILIKE '%p_probability_max integer%' AS has_max,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
       NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_denied,
       NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_denied
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_positions_paged_assignee_v2',
    'get_funnel_stage_counts_assignee_v2'
  );

-- C) Plano de testes funcionais (com sessão authenticated real, não service_role)
-- 1. Sem faixa: v2 deve devolver o mesmo conjunto/contagem que as atuais
--    no mesmo funnel_id/stage_id/company_id e mesmos filtros.
-- 2. 0–100: mesma contagem da atual (todos os valores válidos).
-- 3. 50–60, só min, só max, bordas inclusivas.
-- 4. min=60 max=50: SQLSTATE 22023, sem alterar dados.
-- 5. min=-1 ou 101: SQLSTATE 22023.
-- 6. Sem auth.uid(): 42501.
-- 7. company/funnel sem membership: 42501.
-- 8. seller restrito: só leads próprios (auth_user_restricted_to_own_leads).
-- 9. Combinar owner_user_id + faixa; unassigned + faixa.
-- 10. Paginação: limit 20 offset 0 e offset 20; sem overlap; count bate com soma.
-- 11. Contadores e carga usam os mesmos limites.
-- 12. NULL: se não houver linha, usar FIXTURE_NULL_ROLLBACK.sql.

-- Preferir leitura dos dados existentes (há 0, 100 e faixas 50–60 / 1–39 / 70–100).
-- Não criar índice sem EXPLAIN desses mesmos parâmetros após o apply.
