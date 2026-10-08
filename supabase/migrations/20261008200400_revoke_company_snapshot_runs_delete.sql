-- Revoga somente DELETE de service_role em dashboard_company_snapshot_runs.
-- Os callers fazem SELECT, INSERT e UPDATE. Nenhum apaga linhas desta tabela.
-- Não altera os demais privilégios.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
BEGIN
  IF to_regclass('public.dashboard_company_snapshot_runs') IS NULL THEN
    RAISE EXCEPTION 'preflight divergente: tabela ausente';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'DELETE')
  THEN
    RAISE EXCEPTION 'preflight divergente: privilegios de service_role';
  END IF;
  IF has_table_privilege('anon', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.dashboard_company_snapshot_runs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.dashboard_company_snapshot_runs', 'DELETE')
  THEN
    RAISE EXCEPTION 'preflight divergente: privilegios de anon ou authenticated';
  END IF;
END
$preflight$;

REVOKE DELETE ON TABLE public.dashboard_company_snapshot_runs FROM service_role;

DO $assert$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'UPDATE')
     OR has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'DELETE')
     OR has_table_privilege('anon', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.dashboard_company_snapshot_runs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.dashboard_company_snapshot_runs', 'DELETE')
  THEN
    RAISE EXCEPTION 'assertion falhou: privilegios da tabela de posse';
  END IF;
END
$assert$;
