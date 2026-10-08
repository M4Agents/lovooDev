-- Complemento da etapa A. Não recria calendar_basis e não apaga as colunas.
-- Não aplicar até autorização explícita. Uma transação, sem retry.
--
-- Histórico remoto já registrado e não editado por este arquivo:
--   20261008193702 dashboard_company_calendar_dates
--     md5 30162da59af93a0fb404e9022d27eea9, 99 caracteres, só SET LOCAL.
--   20261008193823 dashboard_company_calendar_basis
--     md5 59fa772d6086bae9ed0c6f5e754bda48, 391 caracteres, só as três colunas.
-- 20261008175120 não está no histórico e não pode ser reaplicado.
--
-- O query enviado tem de ser este arquivo inteiro. A conclusão só vale se
-- as assertions finais passarem na mesma transação. Lock não adquirido,
-- preflight divergente ou assertion falha desfazem tudo o que este arquivo cria.
-- lock_timeout 5s. statement_timeout 2min.
-- Não grava snapshot, não altera flag e não altera cron.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
DECLARE
  v_detail text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261008193702'
      AND name = 'dashboard_company_calendar_dates'
      AND md5(statements[1]) = '30162da59af93a0fb404e9022d27eea9'
      AND length(statements[1]) = 99
      AND array_length(statements, 1) = 1
  ) THEN
    v_detail := v_detail || ' historico 20261008193702;';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261008193823'
      AND name = 'dashboard_company_calendar_basis'
      AND md5(statements[1]) = '59fa772d6086bae9ed0c6f5e754bda48'
      AND length(statements[1]) = 391
      AND array_length(statements, 1) = 1
  ) THEN
    v_detail := v_detail || ' historico 20261008193823;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261008175120'
  ) THEN
    v_detail := v_detail || ' versao 20261008175120 presente;';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'dashboard_snapshots',
        'dashboard_seller_snapshots',
        'dashboard_funnel_stage_snapshots'
      )
      AND a.attname = 'calendar_basis'
      AND NOT a.attisdropped
      AND a.attnotnull
      AND pg_catalog.format_type(a.atttypid, a.atttypmod) = 'text'
      AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''utc''::text'
      AND pg_catalog.col_description(a.attrelid, a.attnum) IS NULL
  ) <> 3 THEN
    v_detail := v_detail || ' colunas calendar_basis;';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM (
      SELECT calendar_basis FROM public.dashboard_snapshots
      UNION ALL
      SELECT calendar_basis FROM public.dashboard_seller_snapshots
      UNION ALL
      SELECT calendar_basis FROM public.dashboard_funnel_stage_snapshots
    ) bases
    WHERE calendar_basis IS DISTINCT FROM 'utc'
  ) <> 0 THEN
    v_detail := v_detail || ' linhas fora de utc;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_dashboard_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE NULLS NOT DISTINCT (company_id, funnel_id, period_start)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_seller_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (company_id, user_id, period_start)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_funnel_stage_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (company_id, funnel_id, stage_id, period_start)'
  ) THEN
    v_detail := v_detail || ' chaves unicas;';
  END IF;

  IF to_regclass('public.idx_dash_snap_basis_null_funnel_date') IS NOT NULL
     OR to_regclass('public.idx_dash_seller_snap_basis_user_date') IS NOT NULL
     OR to_regclass('public.idx_dash_stage_snap_basis_date') IS NOT NULL
     OR to_regclass('public.idx_dash_snap_company_date') IS NULL
     OR to_regclass('public.idx_dash_seller_snap_company_date') IS NULL
     OR to_regclass('public.idx_dash_stage_snap_company_funnel_date') IS NULL
  THEN
    v_detail := v_detail || ' indices;';
  END IF;

  IF to_regprocedure('public.get_dashboard_forecast_company(uuid,date,date,uuid,uuid,integer)') IS NOT NULL
     OR to_regprocedure('public.generate_dashboard_company_daily_snapshot(uuid,date)') IS NOT NULL
     OR to_regprocedure('public.aggregate_snapshot_company_period(uuid,uuid,date,date)') IS NOT NULL
  THEN
    v_detail := v_detail || ' funcoes novas;';
  END IF;

  IF to_regclass('public.dashboard_company_snapshot_runs') IS NOT NULL THEN
    v_detail := v_detail || ' tabela de posse;';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_dashboard_forecast(uuid,date,date,uuid,uuid,integer)'::regprocedure
      AND p.prosecdef
      AND md5(p.prosrc) = '8ab312d2f133b6a492d26670332b1121'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.generate_dashboard_daily_snapshot(uuid,date)'::regprocedure
      AND p.prosecdef
      AND md5(p.prosrc) = '713ce002f7df72416e456dedb4579069'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.aggregate_snapshot_period(uuid,uuid,date,date)'::regprocedure
      AND p.prosecdef
      AND md5(p.prosrc) = 'ae52792ca924f06a658d9a89562ade2e'
      AND position('calendar_basis' in p.prosrc) = 0
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_snapshot_health_score(uuid,date)'::regprocedure
      AND p.prosecdef
      AND p.proconfig IS NULL
      AND md5(p.prosrc) = '6b402a8624bbcbbd1e534878243dd3d3'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    v_detail := v_detail || ' funcoes publicadas;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dashboard_snapshot_cron_runs
    WHERE status = 'running'
      AND started_at > now() - interval '30 minutes'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity
    WHERE pid <> pg_catalog.pg_backend_pid()
      AND state <> 'idle'
      AND query ~* 'generate_dashboard_(company_)?daily_snapshot'
  ) THEN
    v_detail := v_detail || ' geracao ativa;';
  END IF;

  IF v_detail <> '' THEN
    RAISE EXCEPTION 'preflight divergente:%', v_detail;
  END IF;
END
$preflight$;

COMMENT ON COLUMN dashboard_snapshots.calendar_basis IS
  'utc = janela de meia-noite UTC. Outro valor = fuso IANA usado na geração. Não agregar bases diferentes.';
COMMENT ON COLUMN dashboard_seller_snapshots.calendar_basis IS
  'utc = janela de meia-noite UTC. Outro valor = fuso IANA usado na geração. Não agregar bases diferentes.';
COMMENT ON COLUMN dashboard_funnel_stage_snapshots.calendar_basis IS
  'utc = janela de meia-noite UTC. Outro valor = fuso IANA usado na geração. Não agregar bases diferentes.';

ALTER TABLE dashboard_snapshots DROP CONSTRAINT uq_dashboard_snapshots;
ALTER TABLE dashboard_snapshots
  ADD CONSTRAINT uq_dashboard_snapshots
  UNIQUE NULLS NOT DISTINCT (company_id, funnel_id, period_start, calendar_basis);

ALTER TABLE dashboard_seller_snapshots DROP CONSTRAINT uq_seller_snapshots;
ALTER TABLE dashboard_seller_snapshots
  ADD CONSTRAINT uq_seller_snapshots
  UNIQUE (company_id, user_id, period_start, calendar_basis);

ALTER TABLE dashboard_funnel_stage_snapshots DROP CONSTRAINT uq_funnel_stage_snapshots;
ALTER TABLE dashboard_funnel_stage_snapshots
  ADD CONSTRAINT uq_funnel_stage_snapshots
  UNIQUE (company_id, funnel_id, stage_id, period_start, calendar_basis);

-- Os índices únicos acima substituem uq_dashboard_snapshots,
-- uq_seller_snapshots e uq_funnel_stage_snapshots.
-- Os índices não únicos existentes permanecem e não incluem calendar_basis.
-- Estes três cobrem o filtro novo sem misturar a leitura da base UTC.
CREATE INDEX IF NOT EXISTS idx_dash_snap_basis_null_funnel_date
  ON dashboard_snapshots (company_id, calendar_basis, period_start DESC)
  WHERE funnel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_dash_seller_snap_basis_user_date
  ON dashboard_seller_snapshots (company_id, calendar_basis, user_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_dash_stage_snap_basis_date
  ON dashboard_funnel_stage_snapshots (company_id, funnel_id, calendar_basis, period_start DESC);

CREATE OR REPLACE FUNCTION get_dashboard_forecast_company(
  p_company_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_funnel_id    UUID    DEFAULT NULL,
  p_user_id      UUID    DEFAULT NULL,
  p_stalled_days INT     DEFAULT 14
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSON;
  v_timezone TEXT;
BEGIN
  -- ── Guard: acesso ao funil ───────────────────────────────────────────────────────
  -- Apenas quando chamado por usuário autenticado E com funnel explícito.
  -- p_funnel_id IS NULL (todos os funis): sem guard nesta fase (Fase 2).
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT public.auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  SELECT CASE
           WHEN EXISTS (
             SELECT 1
             FROM pg_catalog.pg_timezone_names
             WHERE name = NULLIF(btrim(c.timezone), '')
           ) THEN btrim(c.timezone)
           ELSE 'America/Sao_Paulo'
         END
    INTO v_timezone
    FROM public.companies c
   WHERE c.id = p_company_id;

  IF v_timezone IS NULL THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;

  -- Fórmulas comerciais preservadas. Só a data civil de closed_at muda.
  WITH open_pipeline AS (
    SELECT
      o.id,
      COALESCE(o.value, 0)       AS value,
      COALESCE(o.probability, 0) AS probability,
      o.last_interaction_at
    FROM   public.opportunities o
    JOIN   public.leads l ON l.id = o.lead_id
    LEFT JOIN public.opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE  o.company_id   = p_company_id
      AND  o.status       = 'open'
      AND  l.company_id   = p_company_id
      AND  l.deleted_at   IS NULL
      AND  (p_funnel_id IS NULL OR ofp.funnel_id = p_funnel_id)
      AND  (p_user_id   IS NULL OR l.responsible_user_id = p_user_id)
  ),

  pipeline_metrics AS (
    SELECT
      ROUND(COALESCE(SUM(value), 0)::NUMERIC, 2)                    AS pipeline_total,
      ROUND(COALESCE(SUM(value * probability / 100.0), 0)::NUMERIC, 2) AS pipeline_weighted,
      COUNT(*)::INT                                                  AS open_count
    FROM open_pipeline
  ),

  stalled AS (
    SELECT id, value, probability
    FROM   open_pipeline
    WHERE  last_interaction_at IS NULL
        OR last_interaction_at < NOW() - make_interval(days => p_stalled_days)
  ),

  stalled_metrics AS (
    SELECT
      COUNT(*)::INT                                                        AS stalled_count,
      ROUND(COALESCE(SUM(value), 0)::NUMERIC, 2)                          AS stalled_value,
      ROUND(COALESCE(SUM(value * probability / 100.0), 0)::NUMERIC, 2)    AS stalled_weighted_value
    FROM stalled
  ),

  period_closed AS (
    SELECT
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'),  0)::NUMERIC, 2
      ) AS won_value,
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'), 0)::NUMERIC, 2
      ) AS lost_value,
      COUNT(*) FILTER (WHERE o.status = 'won')::INT  AS won_count,
      COUNT(*) FILTER (WHERE o.status = 'lost')::INT AS lost_count
    FROM  public.opportunities o
    JOIN  public.leads l ON l.id = o.lead_id
    WHERE o.company_id   = p_company_id
      AND l.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND o.closed_at    IS NOT NULL
      AND (o.closed_at AT TIME ZONE v_timezone)::date BETWEEN p_start_date AND p_end_date
      AND (p_funnel_id IS NULL OR EXISTS (
            SELECT 1 FROM public.opportunity_funnel_positions ofp2
            WHERE  ofp2.opportunity_id = o.id
              AND  ofp2.funnel_id      = p_funnel_id
          ))
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  )

  SELECT json_build_object(
    'pipeline_total',          pm.pipeline_total,
    'pipeline_weighted',       pm.pipeline_weighted,
    'pipeline_risk',           sm.stalled_weighted_value,
    'pipeline_safe',           GREATEST(pm.pipeline_weighted - sm.stalled_weighted_value, 0),
    'open_count',              pm.open_count,
    'stalled_count',           sm.stalled_count,
    'stalled_value',           sm.stalled_value,
    'stalled_weighted_value',  sm.stalled_weighted_value,
    'won_value',               pc.won_value,
    'won_count',               pc.won_count,
    'lost_value',              pc.lost_value,
    'lost_count',              pc.lost_count,
    'conversion_rate',         CASE
                                 WHEN (pc.won_count + pc.lost_count) = 0 THEN 0
                                 ELSE ROUND(
                                   pc.won_count::NUMERIC / (pc.won_count + pc.lost_count) * 100,
                                   1
                                 )
                               END
  )
  INTO v_result
  FROM pipeline_metrics pm, stalled_metrics sm, period_closed pc;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION generate_dashboard_company_daily_snapshot(
  p_company_id UUID,
  p_date       DATE
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_start    DATE        := p_date;
  v_period_end      DATE        := p_date;
  v_timezone        TEXT;
  v_day_start       TIMESTAMPTZ;
  v_day_end         TIMESTAMPTZ;
  v_stalled_days    INT         := 14;
  v_funnel          RECORD;
  v_upserted_stages INT         := 0;
  v_upserted_sellers INT        := 0;
  v_default_funnel_id UUID;

  -- Métricas company-wide
  v_leads_created          INT;
  v_convs_started          INT;
  v_convs_attended         INT;
  v_sla_breached           INT;
  v_avg_response_min       NUMERIC;
  v_won_count              INT;
  v_won_value              NUMERIC;
  v_lost_count             INT;
  v_lost_value             NUMERIC;

  -- Métricas de pipeline (STATE — snapshot do fim do dia)
  v_pipeline_total         NUMERIC;
  v_pipeline_weighted      NUMERIC;
  v_pipeline_risk          NUMERIC;
  v_open_count             INT;
  v_stalled_count          INT;
  v_hot_count              INT;
  v_conversion_rate        NUMERIC;
  v_prob_0_20              NUMERIC;
  v_prob_21_40             NUMERIC;
  v_prob_41_60             NUMERIC;
  v_prob_61_80             NUMERIC;
  v_prob_81_100            NUMERIC;
  v_funnel_stages_cache    JSONB;

  v_result JSON;
BEGIN

  SELECT CASE
           WHEN EXISTS (
             SELECT 1
             FROM pg_catalog.pg_timezone_names
             WHERE name = NULLIF(btrim(c.timezone), '')
           ) THEN btrim(c.timezone)
           ELSE 'America/Sao_Paulo'
         END
    INTO v_timezone
    FROM public.companies c
   WHERE c.id = p_company_id;

  IF v_timezone IS NULL THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;

  v_day_start := (p_date::timestamp AT TIME ZONE v_timezone);
  v_day_end   := ((p_date + 1)::timestamp AT TIME ZONE v_timezone);

  -- Não grava o dia civil ainda aberto. Um cron antigo, em UTC, pode
  -- pedir esse dia entre 21h e meia-noite no fuso da empresa.
  IF p_date >= (now() AT TIME ZONE v_timezone)::date THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'dia civil ainda não encerrado',
      'calendar_basis', v_timezone,
      'date', p_date
    );
  END IF;

  -- Serializa duas gerações do mesmo dia. O lock dura a transação:
  -- uma falha desfaz etapas, vendedores e a prova juntos.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || p_date::text || ':' || v_timezone, 0)
  );

  -- ── 1. FLOW METRICS: public.leads criados no dia ──────────────────────────────────────
  SELECT COUNT(*)::INT
  INTO   v_leads_created
  FROM   public.leads
  WHERE  company_id = p_company_id
    AND  deleted_at IS NULL
    AND  created_at >= v_day_start
    AND  created_at <  v_day_end;

  -- ── 2. FLOW METRICS: conversas iniciadas no dia ────────────────────────
  SELECT COUNT(*)::INT
  INTO   v_convs_started
  FROM   public.chat_conversations
  WHERE  company_id = p_company_id
    AND  created_at >= v_day_start
    AND  created_at <  v_day_end;

  -- ── 3. FLOW METRICS: conversas atendidas (primeira resposta humana) ────
  -- Conta conversas com primeiro inbound no dia E que tiveram resposta humana
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   public.chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  )
  SELECT COUNT(DISTINCT fi.conversation_id)::INT
  INTO   v_convs_attended
  FROM   first_inbound_day fi
  WHERE EXISTS (
    SELECT 1
    FROM   public.chat_messages cm2
    WHERE  cm2.conversation_id  = fi.conversation_id
      AND  cm2.company_id       = p_company_id
      AND  cm2.direction        = 'outbound'
      AND  cm2.is_ai_generated  = false
      AND  cm2.created_at       > fi.first_in_at
  );

  -- ── 4. FLOW METRICS: SLA breached no dia ──────────────────────────────
  -- Conversas cujo PRIMEIRO inbound foi no dia e NÃO tiveram resposta humana
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   public.chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  )
  SELECT COUNT(DISTINCT fi.conversation_id)::INT
  INTO   v_sla_breached
  FROM   first_inbound_day fi
  WHERE NOT EXISTS (
    SELECT 1
    FROM   public.chat_messages cm2
    WHERE  cm2.conversation_id  = fi.conversation_id
      AND  cm2.company_id       = p_company_id
      AND  cm2.direction        = 'outbound'
      AND  cm2.is_ai_generated  = false
      AND  cm2.created_at       > fi.first_in_at
  );

  -- ── 5. FLOW METRICS: média de resposta do dia ──────────────────────────
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   public.chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  first_human_resp AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS resp_min
    FROM   first_inbound_day fi
    JOIN   public.chat_messages cm
      ON   cm.conversation_id = fi.conversation_id
      AND  cm.company_id      = p_company_id
      AND  cm.direction       = 'outbound'
      AND  cm.is_ai_generated = false
      AND  cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  )
  SELECT ROUND(COALESCE(AVG(resp_min), 0)::NUMERIC, 1)
  INTO   v_avg_response_min
  FROM   first_human_resp;

  -- ── 6. FLOW METRICS: ganhos e perdas fechados no dia ──────────────────
  SELECT
    COALESCE(SUM(CASE WHEN o.status = 'won'  THEN 1 ELSE 0 END), 0)::INT,
    COALESCE(SUM(CASE WHEN o.status = 'won'  THEN COALESCE(o.value, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END), 0)::INT,
    COALESCE(SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.value, 0) ELSE 0 END), 0)
  INTO v_won_count, v_won_value, v_lost_count, v_lost_value
  FROM  public.opportunities o
  JOIN  public.leads l ON l.id = o.lead_id
  WHERE o.company_id  = p_company_id
    AND l.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND o.closed_at  >= v_day_start
    AND o.closed_at  <  v_day_end;

  -- ── 7. STATE METRICS: pipeline aberto ao final do dia ─────────────────
  -- "Ao final do dia" = fim exclusivo do dia civil de v_timezone
  -- Usamos o estado ATUAL das oportunidades se p_date = hoje,
  -- ou o estado histórico para datas passadas (sem time-travel nativo).
  -- Para simplificar (sem event sourcing): usamos o estado atual
  -- filtrado por oportunidades abertas criadas até o fim do dia.
  SELECT
    COALESCE(SUM(COALESCE(o.value, 0)), 0),
    COALESCE(SUM(COALESCE(o.value, 0) * COALESCE(o.probability, 0) / 100.0), 0),
    COUNT(*)::INT,
    COUNT(*) FILTER (
      WHERE o.last_interaction_at IS NULL
         OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
    )::INT,
    COUNT(*) FILTER (WHERE COALESCE(o.probability, 0) >= 70)::INT,
    -- Buckets de probabilidade
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN  0 AND  20), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 21 AND  40), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 41 AND  60), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 61 AND  80), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 81 AND 100), 0)
  INTO
    v_pipeline_total, v_pipeline_weighted, v_open_count,
    v_stalled_count,  v_hot_count,
    v_prob_0_20, v_prob_21_40, v_prob_41_60, v_prob_61_80, v_prob_81_100
  FROM public.opportunities o
  JOIN public.leads l ON l.id = o.lead_id
  WHERE o.company_id  = p_company_id
    AND l.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND o.status      = 'open'
    AND o.created_at  < v_day_end;

  -- pipeline_risk = valor ponderado das oportunidades paradas
  SELECT COALESCE(SUM(COALESCE(o.value, 0) * COALESCE(o.probability, 0) / 100.0), 0)
  INTO   v_pipeline_risk
  FROM   public.opportunities o
  JOIN   public.leads l ON l.id = o.lead_id
  WHERE  o.company_id  = p_company_id
    AND  l.company_id  = p_company_id
    AND  l.deleted_at  IS NULL
    AND  o.status      = 'open'
    AND  o.created_at  < v_day_end
    AND (o.last_interaction_at IS NULL
         OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days));

  -- conversion_rate no dia
  v_conversion_rate := CASE
    WHEN (v_won_count + v_lost_count) = 0 THEN 0
    ELSE ROUND(v_won_count::NUMERIC / (v_won_count + v_lost_count) * 100, 1)
  END;

  -- ── 8. STATE METRICS: funil padrão — etapas e cache JSONB ─────────────
  SELECT sf.id
  INTO   v_default_funnel_id
  FROM   public.sales_funnels sf
  WHERE  sf.company_id = p_company_id
    AND  sf.is_active  = true
  ORDER BY sf.is_default DESC, sf.created_at ASC
  LIMIT 1;

  -- A prova de cobertura (funnel_id nulo) só é gravada depois das etapas e dos vendedores.

  -- ── 9. Snapshots por funil (etapas + JSONB cache) ─────────────────────
  FOR v_funnel IN
    SELECT sf.id AS funnel_id
    FROM   public.sales_funnels sf
    WHERE  sf.company_id = p_company_id
      AND  sf.is_active  = true
  LOOP
    -- Coletar dados de etapas
    WITH stage_opps AS (
      SELECT
        ofp.stage_id,
        COUNT(*)::INT                                                   AS opp_count,
        ROUND(COALESCE(SUM(o.value), 0)::NUMERIC, 2)                   AS total_value,
        ROUND(COALESCE(SUM(o.value * o.probability / 100.0), 0)::NUMERIC, 2) AS weighted_value,
        COUNT(*) FILTER (
          WHERE o.last_interaction_at IS NULL
             OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
        )::INT AS stalled_count
      FROM public.opportunity_funnel_positions ofp
      JOIN public.opportunities o ON o.id   = ofp.opportunity_id
      JOIN public.leads l         ON l.id   = o.lead_id
      WHERE ofp.funnel_id  = v_funnel.funnel_id
        AND o.company_id   = p_company_id
        AND o.status       = 'open'
        AND l.deleted_at   IS NULL
        AND o.created_at   < v_day_end
      GROUP BY ofp.stage_id
    ),
    stage_avg AS (
      SELECT
        osh.to_stage_id AS stage_id,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (COALESCE(osh.stage_left_at, now()) - osh.stage_entered_at)) / 86400.0
        )::NUMERIC, 1) AS avg_days
      FROM public.opportunity_stage_history osh
      WHERE osh.funnel_id   = v_funnel.funnel_id
        AND osh.company_id  = p_company_id
      GROUP BY osh.to_stage_id
    )
    INSERT INTO public.dashboard_funnel_stage_snapshots (
      company_id, funnel_id, stage_id, period_start, calendar_basis,
      opp_count, total_value, weighted_value, stalled_count, avg_days,
      snapshot_taken_at
    )
    SELECT
      p_company_id, v_funnel.funnel_id, fs.id, v_period_start, v_timezone,
      COALESCE(so.opp_count,      0),
      COALESCE(so.total_value,    0),
      COALESCE(so.weighted_value, 0),
      COALESCE(so.stalled_count,  0),
      COALESCE(sa.avg_days,       0),
      now()
    FROM   public.funnel_stages fs
    LEFT JOIN stage_opps so ON so.stage_id = fs.id
    LEFT JOIN stage_avg  sa ON sa.stage_id = fs.id
    WHERE  fs.funnel_id  = v_funnel.funnel_id
      AND  fs.is_hidden  = false
    ON CONFLICT ON CONSTRAINT uq_funnel_stage_snapshots
    DO UPDATE SET
      opp_count      = EXCLUDED.opp_count,
      total_value    = EXCLUDED.total_value,
      weighted_value = EXCLUDED.weighted_value,
      stalled_count  = EXCLUDED.stalled_count,
      avg_days       = EXCLUDED.avg_days,
      snapshot_taken_at = now();

    GET DIAGNOSTICS v_upserted_stages = ROW_COUNT;

    -- Construir JSONB cache do funil para o snapshot principal
    SELECT json_agg(json_build_object(
      'stage_id',       dfs.stage_id,
      'stage_name',     fs.name,
      'position',       fs.position,
      'color',          fs.color,
      'opp_count',      dfs.opp_count,
      'total_value',    dfs.total_value,
      'weighted_value', dfs.weighted_value,
      'stalled_count',  dfs.stalled_count,
      'avg_days',       dfs.avg_days
    ) ORDER BY fs.position)::JSONB
    INTO v_funnel_stages_cache
    FROM public.dashboard_funnel_stage_snapshots dfs
    JOIN public.funnel_stages fs ON fs.id = dfs.stage_id
    WHERE dfs.company_id  = p_company_id
      AND dfs.funnel_id   = v_funnel.funnel_id
      AND dfs.period_start = v_period_start
      AND dfs.calendar_basis = v_timezone;

    -- UPSERT snapshot por funil (com pipeline específico desse funil)
    INSERT INTO public.dashboard_snapshots (
      company_id, funnel_id, period_start, period_end, calendar_basis,
      -- FLOW (mesmo da empresa — não filtramos por funil no flow)
      leads_created, conversations_started, conversations_attended,
      won_count, won_value, lost_count, lost_value, sla_breached_count,
      -- STATE (pipeline deste funil)
      pipeline_total, pipeline_weighted, pipeline_risk,
      open_count, stalled_count, hot_count,
      avg_response_minutes, conversion_rate,
      prob_0_20_value, prob_21_40_value, prob_41_60_value,
      prob_61_80_value, prob_81_100_value,
      funnel_stages_cache, snapshot_taken_at
    )
    SELECT
      p_company_id, v_funnel.funnel_id, v_period_start, v_period_end, v_timezone,
      v_leads_created, v_convs_started, v_convs_attended,
      -- Won/lost filtrado pelo funil
      COALESCE(SUM(CASE WHEN o.status = 'won'  THEN 1 ELSE 0 END), 0)::INT,
      COALESCE(SUM(CASE WHEN o.status = 'won'  THEN COALESCE(o.value,0) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END), 0)::INT,
      COALESCE(SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.value,0) ELSE 0 END), 0),
      v_sla_breached,
      -- Pipeline deste funil
      COALESCE(SUM(COALESCE(o.value,0)), 0),
      COALESCE(SUM(COALESCE(o.value,0) * COALESCE(o.probability,0) / 100.0), 0),
      COALESCE(SUM(COALESCE(o.value,0) * COALESCE(o.probability,0) / 100.0) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
      ), 0),
      COUNT(*)::INT,
      COUNT(*) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
      )::INT,
      COUNT(*) FILTER (WHERE COALESCE(o.probability,0) >= 70)::INT,
      v_avg_response_min, v_conversion_rate,
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN  0 AND  20), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 21 AND  40), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 41 AND  60), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 61 AND  80), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 81 AND 100), 0),
      v_funnel_stages_cache,
      now()
    FROM public.opportunities o
    JOIN public.leads l ON l.id = o.lead_id
    LEFT JOIN public.opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id  = p_company_id
      AND l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
      AND (o.status = 'open' OR (
        o.status IN ('won','lost')
        AND o.closed_at >= v_day_start
        AND o.closed_at <  v_day_end
      ))
      AND (ofp.funnel_id = v_funnel.funnel_id OR ofp.funnel_id IS NULL)
    ON CONFLICT ON CONSTRAINT uq_dashboard_snapshots
    DO UPDATE SET
      leads_created          = EXCLUDED.leads_created,
      conversations_started  = EXCLUDED.conversations_started,
      conversations_attended = EXCLUDED.conversations_attended,
      won_count              = EXCLUDED.won_count,
      won_value              = EXCLUDED.won_value,
      lost_count             = EXCLUDED.lost_count,
      lost_value             = EXCLUDED.lost_value,
      sla_breached_count     = EXCLUDED.sla_breached_count,
      pipeline_total         = EXCLUDED.pipeline_total,
      pipeline_weighted      = EXCLUDED.pipeline_weighted,
      pipeline_risk          = EXCLUDED.pipeline_risk,
      open_count             = EXCLUDED.open_count,
      stalled_count          = EXCLUDED.stalled_count,
      hot_count              = EXCLUDED.hot_count,
      avg_response_minutes   = EXCLUDED.avg_response_minutes,
      conversion_rate        = EXCLUDED.conversion_rate,
      prob_0_20_value        = EXCLUDED.prob_0_20_value,
      prob_21_40_value       = EXCLUDED.prob_21_40_value,
      prob_41_60_value       = EXCLUDED.prob_41_60_value,
      prob_61_80_value       = EXCLUDED.prob_61_80_value,
      prob_81_100_value      = EXCLUDED.prob_81_100_value,
      funnel_stages_cache    = EXCLUDED.funnel_stages_cache,
      snapshot_taken_at      = now();

  END LOOP;

  -- ── 10. Seller snapshots ───────────────────────────────────────────
  INSERT INTO public.dashboard_seller_snapshots (
    company_id, user_id, period_start, period_end, calendar_basis,
    leads_received, leads_attended, opps_generated, opps_won, won_value,
    sla_missed_count, attendance_rate, avg_response_min, conversion_rate,
    snapshot_taken_at
  )
  WITH active_sellers AS (
    SELECT cu.user_id
    FROM   public.company_users cu
    WHERE  cu.company_id = p_company_id
      AND  cu.is_active  = true
      AND  cu.role IN ('seller', 'manager', 'admin')
  ),
  seller_leads AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT l.id)::INT AS leads_received
    FROM public.leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
      AND l.created_at >= v_day_start
      AND l.created_at <  v_day_end
    GROUP BY 1
  ),
  seller_opps AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= v_day_start AND o.created_at < v_day_end)::INT AS opps_generated,
      COUNT(DISTINCT o.id) FILTER (WHERE o.closed_at  >= v_day_start AND o.closed_at  < v_day_end AND o.status = 'won')::INT  AS opps_won,
      COUNT(DISTINCT o.id) FILTER (WHERE o.closed_at  >= v_day_start AND o.closed_at  < v_day_end AND o.status IN ('won','lost'))::INT AS opps_closed,
      COALESCE(SUM(o.value) FILTER (WHERE o.closed_at >= v_day_start AND o.closed_at < v_day_end AND o.status = 'won'), 0) AS won_value
    FROM public.leads l
    JOIN public.opportunities o ON o.lead_id = l.id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
    GROUP BY 1
  ),
  first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id, cm.created_at AS first_in_at
    FROM public.chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction  = 'inbound'
      AND cm.created_at >= v_day_start
      AND cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  first_human AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS resp_min
    FROM first_inbound_day fi
    JOIN public.chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),
  seller_attendance AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT fh.conversation_id)::INT AS leads_attended,
      ROUND(AVG(fh.resp_min)::NUMERIC, 1)    AS avg_response_min
    FROM first_human fh
    JOIN public.chat_conversations cc ON cc.id = fh.conversation_id
    JOIN public.leads l               ON l.id  = cc.lead_id
    WHERE l.company_id = p_company_id AND l.deleted_at IS NULL
    GROUP BY 1
  ),
  seller_sla_missed AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT fi.conversation_id)::INT AS sla_missed_count
    FROM first_inbound_day fi
    JOIN public.chat_conversations cc ON cc.id = fi.conversation_id
    JOIN public.leads l               ON l.id  = cc.lead_id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_messages cm2
        WHERE cm2.conversation_id = fi.conversation_id
          AND cm2.direction       = 'outbound'
          AND cm2.is_ai_generated = false
          AND cm2.created_at      > fi.first_in_at
      )
    GROUP BY 1
  )
  SELECT
    p_company_id, s.user_id, v_period_start, v_period_end, v_timezone,
    COALESCE(sl.leads_received,    0),
    COALESCE(sa.leads_attended,    0),
    COALESCE(so.opps_generated,    0),
    COALESCE(so.opps_won,          0),
    COALESCE(so.won_value,         0),
    COALESCE(sm.sla_missed_count,  0),
    ROUND(COALESCE(sa.leads_attended::NUMERIC / NULLIF(sl.leads_received, 0), 0), 3),
    COALESCE(sa.avg_response_min,  0),
    ROUND(COALESCE(so.opps_won::NUMERIC / NULLIF(so.opps_closed, 0), 0), 3),
    now()
  FROM  active_sellers s
  LEFT JOIN seller_leads      sl ON sl.user_id = s.user_id
  LEFT JOIN seller_opps       so ON so.user_id = s.user_id
  LEFT JOIN seller_attendance sa ON sa.user_id = s.user_id
  LEFT JOIN seller_sla_missed sm ON sm.user_id = s.user_id
  WHERE COALESCE(sl.leads_received, 0) > 0
  ON CONFLICT ON CONSTRAINT uq_seller_snapshots
  DO UPDATE SET
    leads_received   = EXCLUDED.leads_received,
    leads_attended   = EXCLUDED.leads_attended,
    opps_generated   = EXCLUDED.opps_generated,
    opps_won         = EXCLUDED.opps_won,
    won_value        = EXCLUDED.won_value,
    sla_missed_count = EXCLUDED.sla_missed_count,
    attendance_rate  = EXCLUDED.attendance_rate,
    avg_response_min = EXCLUDED.avg_response_min,
    conversion_rate  = EXCLUDED.conversion_rate,
    snapshot_taken_at = now();

  GET DIAGNOSTICS v_upserted_sellers = ROW_COUNT;

  -- Prova de cobertura. Só chega aqui se etapas e vendedores terminaram.
  -- Uma exceção anterior desfaz este INSERT junto com o restante da função.
  INSERT INTO public.dashboard_snapshots (
    company_id, funnel_id,
    period_start, period_end, calendar_basis,
    -- FLOW
    leads_created, conversations_started, conversations_attended,
    won_count, won_value, lost_count, lost_value, sla_breached_count,
    -- STATE
    pipeline_total, pipeline_weighted, pipeline_risk,
    open_count, stalled_count, hot_count,
    avg_response_minutes, conversion_rate,
    -- FORECAST BUCKETS
    prob_0_20_value, prob_21_40_value, prob_41_60_value,
    prob_61_80_value, prob_81_100_value,
    -- CACHE
    funnel_stages_cache,
    snapshot_taken_at
  ) VALUES (
    p_company_id, NULL,
    v_period_start, v_period_end, v_timezone,
    v_leads_created, v_convs_started, v_convs_attended,
    v_won_count, v_won_value, v_lost_count, v_lost_value, v_sla_breached,
    v_pipeline_total, v_pipeline_weighted, v_pipeline_risk,
    v_open_count, v_stalled_count, v_hot_count,
    v_avg_response_min, v_conversion_rate,
    v_prob_0_20, v_prob_21_40, v_prob_41_60, v_prob_61_80, v_prob_81_100,
    NULL, -- funnel_stages_cache: preenchido abaixo se houver funil
    now()
  )
  ON CONFLICT ON CONSTRAINT uq_dashboard_snapshots
  DO UPDATE SET
    leads_created         = EXCLUDED.leads_created,
    conversations_started = EXCLUDED.conversations_started,
    conversations_attended= EXCLUDED.conversations_attended,
    won_count             = EXCLUDED.won_count,
    won_value             = EXCLUDED.won_value,
    lost_count            = EXCLUDED.lost_count,
    lost_value            = EXCLUDED.lost_value,
    sla_breached_count    = EXCLUDED.sla_breached_count,
    pipeline_total        = EXCLUDED.pipeline_total,
    pipeline_weighted     = EXCLUDED.pipeline_weighted,
    pipeline_risk         = EXCLUDED.pipeline_risk,
    open_count            = EXCLUDED.open_count,
    stalled_count         = EXCLUDED.stalled_count,
    hot_count             = EXCLUDED.hot_count,
    avg_response_minutes  = EXCLUDED.avg_response_minutes,
    conversion_rate       = EXCLUDED.conversion_rate,
    prob_0_20_value       = EXCLUDED.prob_0_20_value,
    prob_21_40_value      = EXCLUDED.prob_21_40_value,
    prob_41_60_value      = EXCLUDED.prob_41_60_value,
    prob_61_80_value      = EXCLUDED.prob_61_80_value,
    prob_81_100_value     = EXCLUDED.prob_81_100_value,
    snapshot_taken_at     = now();

  -- ── Resultado ───────────────────────────────────────────────────
  v_result := json_build_object(
    'ok',               true,
    'company_id',       p_company_id,
    'date',             p_date,
    'calendar_basis',   v_timezone,
    'funnel_id',        v_default_funnel_id,
    'upserted_stages',  v_upserted_stages,
    'upserted_sellers', v_upserted_sellers,
    'leads_created',    v_leads_created,
    'pipeline_total',   v_pipeline_total,
    'won_count',        v_won_count
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'ok',         false,
    'company_id', p_company_id,
    'date',       p_date,
    'error',      SQLERRM
  );
END;
$$;

COMMENT ON FUNCTION get_dashboard_forecast_company IS
  'Forecast do dashboard. Fechamentos usam o dia civil de public.companies.timezone, com fallback America/Sao_Paulo. Fórmulas de valor e probabilidade inalteradas.';

COMMENT ON FUNCTION generate_dashboard_company_daily_snapshot IS
  'Gera o snapshot de um dia civil da empresa na calendar_basis desse fuso. O upsert não altera a linha utc do mesmo period_start. Fórmulas comerciais inalteradas.';

CREATE OR REPLACE FUNCTION public.aggregate_snapshot_company_period(
  p_company_id uuid,
  p_funnel_id  uuid,
  p_start_date date,
  p_end_date   date
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_flow        JSON;
  v_state       JSON;
  v_meta        JSON;
  v_days        INT;
  v_expected    INT;
  v_timezone    TEXT;
  v_compatible  BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT public.auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  SELECT NULLIF(btrim(c.timezone), '')
    INTO v_timezone
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone
  ) THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;

  v_expected := (p_end_date - p_start_date + 1);

  WITH deduped AS (
    SELECT DISTINCT ON (s.period_start)
      s.period_start,
      s.leads_created,
      s.conversations_attended,
      s.won_count,
      s.won_value,
      s.lost_count,
      s.lost_value,
      s.sla_breached_count
    FROM public.dashboard_snapshots s
    WHERE s.company_id = p_company_id
      AND s.calendar_basis = v_timezone
      AND (
            (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
         OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
          )
      AND s.period_start BETWEEN p_start_date AND p_end_date
    ORDER BY s.period_start, s.snapshot_taken_at DESC
  )
  SELECT
    json_build_object(
      'leads_created',          COALESCE(SUM(d.leads_created),          0),
      'conversations_attended', COALESCE(SUM(d.conversations_attended), 0),
      'won_count',              COALESCE(SUM(d.won_count),              0),
      'won_value',              COALESCE(SUM(d.won_value),              0),
      'lost_count',             COALESCE(SUM(d.lost_count),             0),
      'lost_value',             COALESCE(SUM(d.lost_value),             0),
      'sla_breached_count',     COALESCE(SUM(d.sla_breached_count),     0)
    ),
    COUNT(*)::INT
  INTO v_flow, v_days
  FROM deduped d;

  SELECT json_build_object(
    'pipeline_total',       s.pipeline_total,
    'pipeline_weighted',    s.pipeline_weighted,
    'pipeline_risk',        s.pipeline_risk,
    'open_count',           s.open_count,
    'stalled_count',        s.stalled_count,
    'hot_count',            s.hot_count,
    'avg_response_minutes', s.avg_response_minutes,
    'conversion_rate',      s.conversion_rate,
    'prob_0_20_value',      s.prob_0_20_value,
    'prob_21_40_value',     s.prob_21_40_value,
    'prob_41_60_value',     s.prob_41_60_value,
    'prob_61_80_value',     s.prob_61_80_value,
    'prob_81_100_value',    s.prob_81_100_value,
    'funnel_stages_cache',  s.funnel_stages_cache,
    'snapshot_date',        s.period_start
  )
  INTO v_state
  FROM public.dashboard_snapshots s
  WHERE s.company_id = p_company_id
    AND s.calendar_basis = v_timezone
    AND (
          (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
       OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
        )
    AND s.period_start BETWEEN p_start_date AND p_end_date
  ORDER BY s.period_start DESC, s.snapshot_taken_at DESC
  LIMIT 1;

  v_compatible := COALESCE(v_days, 0) = v_expected AND v_expected > 0;
  IF NOT v_compatible THEN
    v_flow := '{}'::JSON;
    v_state := '{}'::JSON;
  END IF;

  v_meta := json_build_object(
    'from_date',           p_start_date,
    'to_date',             p_end_date,
    'funnel_id',           p_funnel_id,
    'calendar_basis',      v_timezone,
    'expected_days',       v_expected,
    'snapshot_days_found', COALESCE(v_days, 0),
    'has_data',            v_compatible,
    'compatible',          v_compatible
  );

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  v_meta
  );
END;
$$;

COMMENT ON FUNCTION aggregate_snapshot_company_period IS
  'Agrega snapshots somente na calendar_basis do fuso atual da empresa. Janela incompleta não devolve soma. Fórmulas de soma e último estado inalteradas.';


CREATE OR REPLACE FUNCTION public.aggregate_snapshot_period(
  p_company_id uuid,
  p_funnel_id  uuid,
  p_start_date date,
  p_end_date   date
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_flow  JSON;
  v_state JSON;
  v_meta  JSON;
  v_days  INT;
BEGIN
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT public.auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  WITH deduped AS (
    SELECT DISTINCT ON (s.period_start)
      s.period_start,
      s.leads_created,
      s.conversations_attended,
      s.won_count,
      s.won_value,
      s.lost_count,
      s.lost_value,
      s.sla_breached_count
    FROM public.dashboard_snapshots s
    WHERE s.company_id = p_company_id
      AND s.calendar_basis = 'utc'
      AND (
            (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
         OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
          )
      AND s.period_start BETWEEN p_start_date AND p_end_date
    ORDER BY s.period_start, s.snapshot_taken_at DESC
  )
  SELECT
    json_build_object(
      'leads_created',          COALESCE(SUM(d.leads_created),          0),
      'conversations_attended', COALESCE(SUM(d.conversations_attended), 0),
      'won_count',              COALESCE(SUM(d.won_count),              0),
      'won_value',              COALESCE(SUM(d.won_value),              0),
      'lost_count',             COALESCE(SUM(d.lost_count),             0),
      'lost_value',             COALESCE(SUM(d.lost_value),             0),
      'sla_breached_count',     COALESCE(SUM(d.sla_breached_count),     0)
    ),
    COUNT(*)::INT
  INTO v_flow, v_days
  FROM deduped d;

  SELECT json_build_object(
    'pipeline_total',       s.pipeline_total,
    'pipeline_weighted',    s.pipeline_weighted,
    'pipeline_risk',        s.pipeline_risk,
    'open_count',           s.open_count,
    'stalled_count',        s.stalled_count,
    'hot_count',            s.hot_count,
    'avg_response_minutes', s.avg_response_minutes,
    'conversion_rate',      s.conversion_rate,
    'prob_0_20_value',      s.prob_0_20_value,
    'prob_21_40_value',     s.prob_21_40_value,
    'prob_41_60_value',     s.prob_41_60_value,
    'prob_61_80_value',     s.prob_61_80_value,
    'prob_81_100_value',    s.prob_81_100_value,
    'funnel_stages_cache',  s.funnel_stages_cache,
    'snapshot_date',        s.period_start
  )
  INTO v_state
  FROM public.dashboard_snapshots s
  WHERE s.company_id = p_company_id
    AND s.calendar_basis = 'utc'
    AND (
          (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
       OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
        )
    AND s.period_start <= p_end_date
  ORDER BY s.period_start DESC, s.snapshot_taken_at DESC
  LIMIT 1;

  v_meta := json_build_object(
    'from_date',           p_start_date,
    'to_date',             p_end_date,
    'funnel_id',           p_funnel_id,
    'calendar_basis',      'utc',
    'snapshot_days_found', COALESCE(v_days, 0),
    'has_data',            (COALESCE(v_days, 0) > 0)
  );

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  v_meta
  );
END;
$$;

COMMENT ON FUNCTION public.aggregate_snapshot_period IS
  'Agrega somente calendar_basis utc. Preserva o resultado do código publicado e não soma a base da empresa.';

-- Health score: mesmas fórmulas e pesos. classification, maturidade e ready
-- continuam na base utc, para o LovooCRM publicado não mudar de prontidão.
-- comparison_coverage conta só a base do fuso atual.
-- STABLE e search_path public. SECURITY INVOKER: o único caller previsto é service_role.
-- O REVOKE de anon e authenticated está no final deste arquivo e faz parte do apply.
CREATE OR REPLACE FUNCTION get_snapshot_health_score(
  p_company_id     UUID,
  p_reference_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_freshness_score  NUMERIC := 0.0;
  v_drift_score      NUMERIC := 0.8;
  v_coverage_score   NUMERIC := 0.0;
  v_cron_score       NUMERIC := 0.8;
  v_health_score     NUMERIC;
  v_severity         TEXT;
  v_classification   TEXT;
  v_freshness_status TEXT    := 'missing';
  v_latest_date      DATE;
  v_days_since       INT;
  v_drift_max        NUMERIC;
  v_drift_status     TEXT    := 'no_data';
  v_days_covered     INT     := 0;
  v_total_days       INT     := 30;
  v_coverage_raw     NUMERIC := 0.0;
  v_jobs_total       INT     := 0;
  v_jobs_ok          INT     := 0;
  v_cron_rate        NUMERIC := 0.0;
  v_days_of_history  INT     := 0;
  v_maturity_status  TEXT    := 'new';
  v_maturity_days    CONSTANT INT := 30;
  v_blocker          TEXT;
  v_timezone         TEXT;
  v_yesterday        DATE;
  v_wow_cur_from     DATE;
  v_wow_prev_from    DATE;
  v_wow_prev_to      DATE;
  v_mom_cur_from     DATE;
  v_mom_prev_from    DATE;
  v_mom_prev_to      DATE;
  v_wow_cur_days     INT := 0;
  v_wow_prev_days    INT := 0;
  v_mom_cur_days     INT := 0;
  v_mom_prev_days    INT := 0;
  v_wow_complete     BOOLEAN := false;
  v_mom_complete     BOOLEAN := false;
BEGIN
  SELECT NULLIF(btrim(c.timezone), '')
    INTO v_timezone
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone
  ) THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;

  SELECT MAX(period_start) INTO v_latest_date
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL
    AND calendar_basis = 'utc';

  IF v_latest_date IS NULL THEN
    v_freshness_score  := 0.0;
    v_freshness_status := 'missing';
    v_days_since       := NULL;
  ELSE
    v_days_since := (p_reference_date - v_latest_date);
    IF v_days_since <= 1 THEN
      v_freshness_score  := 1.0;
      v_freshness_status := 'fresh';
    ELSIF v_days_since <= 2 THEN
      v_freshness_score  := 0.7;
      v_freshness_status := 'delayed';
    ELSIF v_days_since <= 3 THEN
      v_freshness_score  := 0.3;
      v_freshness_status := 'stale';
    ELSE
      v_freshness_score  := 0.0;
      v_freshness_status := 'missing';
    END IF;
  END IF;

  SELECT max_drift_pct, status
    INTO v_drift_max, v_drift_status
  FROM public.dashboard_snapshot_drift_logs
  WHERE company_id = p_company_id
  ORDER BY checked_at DESC
  LIMIT 1;

  IF v_drift_max IS NULL THEN
    v_drift_score  := 0.8;
    v_drift_status := 'no_data';
  ELSIF v_drift_max < 2.0 THEN
    v_drift_score := 1.0;
  ELSIF v_drift_max < 5.0 THEN
    v_drift_score := 0.7;
  ELSIF v_drift_max < 10.0 THEN
    v_drift_score := 0.3;
  ELSE
    v_drift_score := 0.0;
  END IF;

  SELECT COUNT(DISTINCT period_start)
    INTO v_days_covered
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL
    AND calendar_basis = 'utc'
    AND period_start >= (p_reference_date - INTERVAL '30 days')
    AND period_start <  p_reference_date;

  v_coverage_raw := COALESCE(v_days_covered, 0)::NUMERIC / v_total_days::NUMERIC;

  IF v_coverage_raw >= 0.95 THEN
    v_coverage_score := 1.0;
  ELSIF v_coverage_raw >= 0.85 THEN
    v_coverage_score := 0.7;
  ELSIF v_coverage_raw >= 0.70 THEN
    v_coverage_score := 0.3;
  ELSE
    v_coverage_score := 0.0;
  END IF;

  SELECT
    COUNT(*)                                     AS total,
    COUNT(*) FILTER (WHERE status = 'completed') AS ok_count
  INTO v_jobs_total, v_jobs_ok
  FROM public.dashboard_snapshot_cron_runs
  WHERE run_date >= (p_reference_date - INTERVAL '7 days')
    AND run_date <  p_reference_date;

  IF v_jobs_total = 0 THEN
    v_cron_score := 0.8;
    v_cron_rate  := NULL;
  ELSE
    v_cron_rate := v_jobs_ok::NUMERIC / v_jobs_total::NUMERIC;
    IF v_cron_rate >= 0.98 THEN
      v_cron_score := 1.0;
    ELSIF v_cron_rate >= 0.90 THEN
      v_cron_score := 0.7;
    ELSIF v_cron_rate >= 0.80 THEN
      v_cron_score := 0.3;
    ELSE
      v_cron_score := 0.0;
    END IF;
  END IF;

  v_health_score := ROUND(
    (v_freshness_score * 0.35 +
     v_drift_score     * 0.30 +
     v_coverage_score  * 0.20 +
     v_cron_score      * 0.15) * 100.0,
  1);

  IF    v_health_score >= 85 THEN v_severity := 'healthy';
  ELSIF v_health_score >= 65 THEN v_severity := 'degraded';
  ELSIF v_health_score >= 40 THEN v_severity := 'warning';
  ELSE                             v_severity := 'critical';
  END IF;

  SELECT COUNT(DISTINCT period_start)
    INTO v_days_of_history
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL
    AND calendar_basis = 'utc'
    AND period_start < p_reference_date;

  v_maturity_status := CASE
    WHEN v_days_of_history >= v_maturity_days THEN 'mature'
    ELSE 'new'
  END;

  IF v_maturity_status = 'new' THEN
    v_classification := 'insufficient_history';
  ELSIF v_health_score >= 85 THEN
    v_classification := 'healthy';
  ELSIF v_health_score >= 65 THEN
    v_classification := 'degraded';
  ELSE
    v_classification := 'critical';
  END IF;

  v_yesterday     := p_reference_date - 1;
  v_wow_cur_from  := v_yesterday - 6;
  v_wow_prev_to   := v_yesterday - 7;
  v_wow_prev_from := v_yesterday - 13;
  v_mom_cur_from  := v_yesterday - 29;
  v_mom_prev_to   := v_yesterday - 30;
  v_mom_prev_from := v_yesterday - 59;

  SELECT COUNT(DISTINCT period_start) INTO v_wow_cur_days
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id AND funnel_id IS NULL
    AND calendar_basis = v_timezone
    AND period_start BETWEEN v_wow_cur_from AND v_yesterday;

  SELECT COUNT(DISTINCT period_start) INTO v_wow_prev_days
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id AND funnel_id IS NULL
    AND calendar_basis = v_timezone
    AND period_start BETWEEN v_wow_prev_from AND v_wow_prev_to;

  SELECT COUNT(DISTINCT period_start) INTO v_mom_cur_days
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id AND funnel_id IS NULL
    AND calendar_basis = v_timezone
    AND period_start BETWEEN v_mom_cur_from AND v_yesterday;

  SELECT COUNT(DISTINCT period_start) INTO v_mom_prev_days
  FROM public.dashboard_snapshots
  WHERE company_id = p_company_id AND funnel_id IS NULL
    AND calendar_basis = v_timezone
    AND period_start BETWEEN v_mom_prev_from AND v_mom_prev_to;

  v_wow_complete := v_wow_cur_days = (v_yesterday - v_wow_cur_from + 1)
                AND v_wow_prev_days = (v_wow_prev_to - v_wow_prev_from + 1);
  v_mom_complete := v_mom_cur_days = (v_yesterday - v_mom_cur_from + 1)
                AND v_mom_prev_days = (v_mom_prev_to - v_mom_prev_from + 1);

  IF NOT v_wow_complete THEN
    v_blocker := 'insufficient_history';
  ELSIF v_classification = 'insufficient_history' THEN
    v_blocker := 'insufficient_history';
  ELSIF v_classification = 'healthy' THEN
    v_blocker := NULL;
  ELSE
    IF    v_freshness_score < 0.7 THEN v_blocker := 'freshness';
    ELSIF v_drift_score     < 0.7 THEN v_blocker := 'drift';
    ELSIF v_coverage_score  < 0.7 THEN v_blocker := 'coverage';
    ELSIF v_cron_score      < 0.7 THEN v_blocker := 'cron_reliability';
    ELSE                                v_blocker := 'composite_score';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'company_id',      p_company_id,
    'reference_date',  p_reference_date,
    'calendar_basis',  v_timezone,
    'health_score',    v_health_score,
    'severity',        v_severity,
    'classification',  v_classification,
    'maturity', jsonb_build_object(
      'status',          v_maturity_status,
      'days_of_history', v_days_of_history,
      'threshold_days',  v_maturity_days
    ),
    'comparison_coverage', jsonb_build_object(
      'calendar_basis', v_timezone,
      'wow', jsonb_build_object(
        'current_from', v_wow_cur_from,
        'current_to', v_yesterday,
        'previous_from', v_wow_prev_from,
        'previous_to', v_wow_prev_to,
        'required_days', (v_yesterday - v_wow_cur_from + 1) + (v_wow_prev_to - v_wow_prev_from + 1),
        'present_days', v_wow_cur_days + v_wow_prev_days,
        'complete', v_wow_complete
      ),
      'mom', jsonb_build_object(
        'current_from', v_mom_cur_from,
        'current_to', v_yesterday,
        'previous_from', v_mom_prev_from,
        'previous_to', v_mom_prev_to,
        'required_days', (v_yesterday - v_mom_cur_from + 1) + (v_mom_prev_to - v_mom_prev_from + 1),
        'present_days', v_mom_cur_days + v_mom_prev_days,
        'complete', v_mom_complete
      )
    ),
    'components', jsonb_build_object(
      'freshness', jsonb_build_object(
        'score',        v_freshness_score,
        'status',       v_freshness_status,
        'latest_date',  v_latest_date,
        'days_since',   v_days_since
      ),
      'drift', jsonb_build_object(
        'score',         v_drift_score,
        'status',        v_drift_status,
        'max_drift_pct', v_drift_max
      ),
      'coverage', jsonb_build_object(
        'score',        v_coverage_score,
        'days_covered', v_days_covered,
        'total_days',   v_total_days,
        'coverage_pct', ROUND(v_coverage_raw * 100, 1)
      ),
      'cron', jsonb_build_object(
        'score',       v_cron_score,
        'jobs_ok',     v_jobs_ok,
        'jobs_total',  v_jobs_total,
        'success_rate', CASE
          WHEN v_jobs_total > 0 THEN ROUND(v_cron_rate * 100, 1)
          ELSE NULL
        END
      )
    ),
    'readiness_4_2', jsonb_build_object(
      'ready',     (v_classification = 'healthy' AND v_wow_complete),
      'ready_wow', v_wow_complete,
      'ready_mom', v_mom_complete,
      'blocker',   v_blocker
    )
  );
END;
$$;

COMMENT ON FUNCTION get_snapshot_health_score IS
  'Health score com os mesmos pesos. classification e ready contam a base utc. comparison_coverage conta o fuso da empresa.';

-- Posse da geração no calendário da empresa.
-- O cron publicado não grava nesta tabela. Ela não altera o índice diário de dashboard_snapshot_cron_runs.
CREATE TABLE public.dashboard_company_snapshot_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date    date NOT NULL,
  status      text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT dashboard_company_snapshot_runs_status_check
    CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  CONSTRAINT dashboard_company_snapshot_runs_run_date_key UNIQUE (run_date)
);

ALTER TABLE public.dashboard_company_snapshot_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dashboard_company_snapshot_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.dashboard_company_snapshot_runs FROM anon;
REVOKE ALL ON TABLE public.dashboard_company_snapshot_runs FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dashboard_company_snapshot_runs TO service_role;

-- Aprovação explícita deste apply. Não altera a ACL das funções já publicadas.
-- Callers conferidos em origin/main 77588a55 e production/main cf65948:
-- get_snapshot_health_score só é chamada por /api/dashboard/snapshot-health,
-- depois de assertMembership, com service_role.
ALTER FUNCTION public.get_dashboard_forecast_company(uuid, date, date, uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.generate_dashboard_company_daily_snapshot(uuid, date) OWNER TO postgres;
ALTER FUNCTION public.aggregate_snapshot_company_period(uuid, uuid, date, date) OWNER TO postgres;
ALTER FUNCTION public.get_snapshot_health_score(uuid, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_dashboard_forecast_company(uuid, date, date, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_forecast_company(uuid, date, date, uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_dashboard_forecast_company(uuid, date, date, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_forecast_company(uuid, date, date, uuid, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.generate_dashboard_company_daily_snapshot(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_dashboard_company_daily_snapshot(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.generate_dashboard_company_daily_snapshot(uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_dashboard_company_daily_snapshot(uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.aggregate_snapshot_company_period(uuid, uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aggregate_snapshot_company_period(uuid, uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.aggregate_snapshot_company_period(uuid, uuid, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_snapshot_company_period(uuid, uuid, date, date) TO service_role;

REVOKE ALL ON FUNCTION public.get_snapshot_health_score(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_snapshot_health_score(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.get_snapshot_health_score(uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_snapshot_health_score(uuid, date) TO service_role;

DO $assert$
DECLARE
  v_detail text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_dashboard_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE NULLS NOT DISTINCT (company_id, funnel_id, period_start, calendar_basis)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_seller_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (company_id, user_id, period_start, calendar_basis)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'uq_funnel_stage_snapshots'
      AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (company_id, funnel_id, stage_id, period_start, calendar_basis)'
  ) THEN
    v_detail := v_detail || ' chaves;';
  END IF;

  IF to_regclass('public.idx_dash_snap_basis_null_funnel_date') IS NULL
     OR to_regclass('public.idx_dash_seller_snap_basis_user_date') IS NULL
     OR to_regclass('public.idx_dash_stage_snap_basis_date') IS NULL
     OR to_regclass('public.idx_dash_snap_company_date') IS NULL
     OR to_regclass('public.idx_dash_seller_snap_company_date') IS NULL
     OR to_regclass('public.idx_dash_stage_snap_company_funnel_date') IS NULL
  THEN
    v_detail := v_detail || ' indices;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_dashboard_forecast_company(uuid,date,date,uuid,uuid,integer)'::regprocedure
      AND NOT p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.generate_dashboard_company_daily_snapshot(uuid,date)'::regprocedure
      AND NOT p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.aggregate_snapshot_company_period(uuid,uuid,date,date)'::regprocedure
      AND NOT p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_snapshot_health_score(uuid,date)'::regprocedure
      AND NOT p.prosecdef
      AND p.proconfig IS NOT NULL
      AND position('search_path' in pg_catalog.array_to_string(p.proconfig, ',')) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    v_detail := v_detail || ' funcoes novas ou health;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.aggregate_snapshot_period(uuid,uuid,date,date)'::regprocedure
      AND p.prosecdef
      AND position('calendar_basis = ''utc''' in p.prosrc) > 0
      AND position('v_timezone' in p.prosrc) = 0
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.get_dashboard_forecast(uuid,date,date,uuid,uuid,integer)'::regprocedure
      AND md5(p.prosrc) = '8ab312d2f133b6a492d26670332b1121'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.generate_dashboard_daily_snapshot(uuid,date)'::regprocedure
      AND md5(p.prosrc) = '713ce002f7df72416e456dedb4579069'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    v_detail := v_detail || ' funcoes publicadas;';
  END IF;

  IF to_regclass('public.dashboard_company_snapshot_runs') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class
       WHERE oid = 'public.dashboard_company_snapshot_runs'::regclass
         AND relrowsecurity
     )
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.dashboard_company_snapshot_runs', 'UPDATE')
     OR has_table_privilege('anon', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dashboard_company_snapshot_runs', 'SELECT')
     OR EXISTS (SELECT 1 FROM public.dashboard_company_snapshot_runs)
  THEN
    v_detail := v_detail || ' tabela de posse;';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM (
      SELECT calendar_basis FROM public.dashboard_snapshots
      UNION ALL
      SELECT calendar_basis FROM public.dashboard_seller_snapshots
      UNION ALL
      SELECT calendar_basis FROM public.dashboard_funnel_stage_snapshots
    ) bases
    WHERE calendar_basis IS DISTINCT FROM 'utc'
  ) <> 0 THEN
    v_detail := v_detail || ' base nova gravada;';
  END IF;

  IF v_detail <> '' THEN
    RAISE EXCEPTION 'assertion falhou:%', v_detail;
  END IF;
END
$assert$;
