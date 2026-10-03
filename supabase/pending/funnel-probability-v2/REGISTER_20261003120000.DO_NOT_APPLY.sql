-- NÃO EXECUTAR nesta etapa.
-- Registro MANUAL da versão do arquivo no histórico do CLI.
-- Só depois de autorização explícita. Sem DDL. Sem db push.
-- Destino: etzdsywunlpbgxkphuil.
-- Mantém o record MCP 20261003111146.

BEGIN;

DO $reg$
DECLARE
  pos oid;
  cnt oid;
  has_name boolean;
  has_statements boolean;
  mcp_exists boolean;
  already boolean;
BEGIN
  pos := to_regprocedure(
    'public.get_stage_positions_paged_assignee_v2(uuid,uuid,uuid,text,text,integer,integer,integer,uuid[],text,timestamptz,timestamptz,text,uuid,text,text,boolean,integer,integer)'
  );
  cnt := to_regprocedure(
    'public.get_funnel_stage_counts_assignee_v2(uuid,uuid,text,text,integer,uuid[],text,timestamptz,timestamptz,uuid,text,text,boolean,integer,integer)'
  );
  IF pos IS NULL OR cnt IS NULL THEN
    RAISE EXCEPTION 'REGISTER: v2 ausentes — apply ainda não confirmado';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'REGISTER: supabase_migrations.schema_migrations ausente';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261003111146'
      AND name = 'create_funnel_assignee_probability_range_v2'
  ) INTO mcp_exists;
  IF NOT mcp_exists THEN
    RAISE EXCEPTION 'REGISTER: record MCP 20261003111146 ausente';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261003120000'
  ) INTO already;
  IF already THEN
    RAISE EXCEPTION 'REGISTER: conflito — 20261003120000 já existe';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
      AND column_name = 'name'
  ) INTO has_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
      AND column_name = 'statements'
  ) INTO has_statements;

  IF has_name AND has_statements THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES (
      '20261003120000',
      'create_funnel_assignee_probability_range_v2',
      ARRAY['-- already applied as MCP 20261003111146; register only, no DDL']
    );
  ELSIF has_name THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20261003120000', 'create_funnel_assignee_probability_range_v2');
  ELSE
    INSERT INTO supabase_migrations.schema_migrations (version)
    VALUES ('20261003120000');
  END IF;

  RAISE NOTICE 'REGISTER: 20261003120000 gravada. MCP 20261003111146 preservado.';
END
$reg$;

COMMIT;
