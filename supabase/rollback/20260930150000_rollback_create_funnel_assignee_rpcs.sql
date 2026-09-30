-- ROLLBACK MANUAL — fora da sequência automática. NÃO aplicar agora.
-- Estado real em 2026-09-30 (auditoria somente leitura):
--   * 20260930150000 NÃO foi registrada.
--   * Funções novas existem (criadas por execute_sql, não pelos registros MCP).
--   * Registros MCP reais (NÃO apagar sem revisar o contents):
--       20260930173216  create_funnel_assignee_rpcs
--         statements = TEMP + INSERT baseline + DO preflight (sem CREATE FUNCTION)
--       20260930173335  create_funnel_assignee_rpc_functions
--         statements = TEMP + INSERT baseline (sem CREATE FUNCTION)
-- Reconciliar histórico é passo separado (ver
-- supabase/rollback/20260930150000_HISTORY_RECONCILE.md).
--
-- Ordem operacional, só após autorização:
--   1) Reverter o frontend LovooDev para as RPCs antigas
--   2) Confirmar zero consumidores das funções *_assignee
--   3) DROP das duas funções (sem CASCADE)
--   4) NÃO DELETE em schema_migrations neste arquivo
-- Sem alterar funções antigas nem default privileges.

BEGIN;

DROP FUNCTION IF EXISTS public.get_stage_positions_paged_assignee(
  uuid, uuid, uuid, text, text, integer, integer, integer,
  uuid[], text, timestamptz, timestamptz, text, uuid, text, text, boolean
);

DROP FUNCTION IF EXISTS public.get_funnel_stage_counts_assignee(
  uuid, uuid, text, text, integer, uuid[], text,
  timestamptz, timestamptz, uuid, text, text, boolean
);

DO $check$
DECLARE
  pos oid;
  cnt oid;
BEGIN
  pos := to_regprocedure(
    'public.get_stage_positions_paged_assignee(uuid,uuid,uuid,text,text,integer,integer,integer,uuid[],text,timestamptz,timestamptz,text,uuid,text,text,boolean)'
  );
  cnt := to_regprocedure(
    'public.get_funnel_stage_counts_assignee(uuid,uuid,text,text,integer,uuid[],text,timestamptz,timestamptz,uuid,text,text,boolean)'
  );
  IF pos IS NOT NULL OR cnt IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK: funções novas ainda existem';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
