-- =====================================================================
-- ESTADO ATUAL: RPCs de Reports ANTES das migrations
-- Capturado via: pg_get_functiondef() em 2026-06-24
--
-- ATENÇÃO: Este arquivo foi CORRIGIDO em 2026-06-24.
-- A versão anterior capturou o estado a partir do texto da migration original
-- (20260409100000_create_analytics_rpcs.sql), NÃO do banco real.
-- O banco real possui diferenças em get_seller_performance e get_cycle_time_metrics:
--
--   get_seller_performance:
--     - Retorna "user_id uuid" (não "owner_user_id")
--     - Usa LEFT JOIN auth.users au (não company_users)
--     - Usa EXTRACT(EPOCH ...)::NUMERIC nos cálculos
--
--   get_cycle_time_metrics:
--     - Retorna "dimension text, group_id uuid, group_name text"
--       (não "breakdown_type, entity_id, entity_name")
--     - Usa PERCENTILE_CONT(...)::NUMERIC (com cast duplo)
--     - Usa LEFT JOIN auth.users au para seller breakdown
--
--   get_funnel_overview:
--     - LANGUAGE sql (não plpgsql)
--     - Sem BEGIN/END, corpo direto como SELECT
--
--   get_stage_time_metrics:
--     - PERCENTILE_CONT(...)::NUMERIC (com cast duplo no resultado)
--
-- RPCs capturadas:
--   get_funnel_overview
--   get_stage_time_metrics
--   get_seller_performance
--   get_cycle_time_metrics
--
-- M6b altera estas RPCs adicionando:
--   1. Função helper resolve_user_funnel_ids_access (nova)
--   2. Guard via v_resolved_ids em cada RPC
-- =====================================================================


-- ══════════════════════════════════════════════════════════════════════
-- 1. get_funnel_overview
-- LANGUAGE: sql (não plpgsql — sem BEGIN/END)
-- VOLATILITY: VOLATILE (padrão — sem STABLE explícito)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_funnel_overview(
  p_company_id   uuid,
  p_funnel_ids   uuid[]      DEFAULT NULL::uuid[],
  p_date_from    timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to      timestamptz DEFAULT now(),
  p_stalled_days integer     DEFAULT 15
)
RETURNS TABLE(
  open_count             bigint,
  won_count              bigint,
  lost_count             bigint,
  conversion_rate        numeric,
  won_value              numeric,
  lost_value             numeric,
  avg_cycle_won_seconds  numeric,
  avg_cycle_lost_seconds numeric,
  stalled_count          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE o.status = 'open')::BIGINT,
    COUNT(*) FILTER (WHERE o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT,
    COUNT(*) FILTER (WHERE o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT,
    ROUND(
      COUNT(*) FILTER (WHERE o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to)::NUMERIC
      / NULLIF(COUNT(*) FILTER (WHERE o.status IN ('won','lost')
        AND o.closed_at BETWEEN p_date_from AND p_date_to), 0)::NUMERIC * 100
    , 1),
    COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to), 0),
    COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to), 0),
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'won' AND o.closed_at BETWEEN p_date_from AND p_date_to)),
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'lost' AND o.closed_at BETWEEN p_date_from AND p_date_to)),
    COUNT(*) FILTER (
      WHERE o.status = 'open'
        AND ofp.entered_stage_at < now() - (p_stalled_days || ' days')::INTERVAL
    )::BIGINT
  FROM opportunities o
  JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
  WHERE o.company_id = p_company_id
    AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids));
$function$;

GRANT EXECUTE ON FUNCTION get_funnel_overview(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 2. get_stage_time_metrics
-- LANGUAGE: plpgsql
-- NOTA: PERCENTILE_CONT usa cast duplo ::NUMERIC no resultado:
--   ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY osh.duration_seconds::NUMERIC)::NUMERIC)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_stage_time_metrics(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  stage_id                  uuid,
  stage_name                text,
  stage_color               text,
  stage_position            integer,
  funnel_id                 uuid,
  funnel_name               text,
  current_open_count        bigint,
  historical_movement_count bigint,
  avg_duration_seconds      numeric,
  median_duration_seconds   numeric,
  max_duration_seconds      numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH current_open AS (
    SELECT ofp.stage_id AS sid, COUNT(DISTINCT ofp.opportunity_id)::BIGINT AS cnt
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o ON o.id = ofp.opportunity_id
    WHERE o.company_id = p_company_id
      AND o.status = 'open'
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    GROUP BY ofp.stage_id
  ),
  stage_hist AS (
    SELECT
      osh.from_stage_id                                                                              AS sid,
      COUNT(*)::BIGINT                                                                               AS mv_count,
      ROUND(AVG(osh.duration_seconds::NUMERIC))                                                     AS avg_dur,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY osh.duration_seconds::NUMERIC)::NUMERIC)   AS med_dur,
      MAX(osh.duration_seconds)::NUMERIC                                                            AS max_dur
    FROM opportunity_stage_history osh
    WHERE osh.company_id    = p_company_id
      AND osh.from_stage_id IS NOT NULL
      AND osh.duration_seconds IS NOT NULL
      AND (p_funnel_ids IS NULL OR osh.funnel_id = ANY(p_funnel_ids))
      AND osh.stage_left_at BETWEEN p_date_from AND p_date_to
    GROUP BY osh.from_stage_id
  )
  SELECT
    fs.id,
    fs.name::TEXT,
    fs.color::TEXT,
    fs.position,
    sf.id,
    sf.name::TEXT,
    COALESCE(co.cnt, 0),
    COALESCE(sh.mv_count, 0),
    sh.avg_dur,
    sh.med_dur,
    sh.max_dur
  FROM funnel_stages fs
  JOIN sales_funnels sf ON sf.id = fs.funnel_id
  LEFT JOIN current_open co ON co.sid = fs.id
  LEFT JOIN stage_hist    sh ON sh.sid = fs.id
  WHERE sf.company_id = p_company_id
    AND (p_funnel_ids IS NULL OR fs.funnel_id = ANY(p_funnel_ids))
    AND (fs.is_hidden IS NULL OR fs.is_hidden = FALSE)
  ORDER BY sf.name, fs.position;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_stage_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 3. get_seller_performance
-- LANGUAGE: plpgsql
-- RETORNA: user_id uuid (NÃO owner_user_id — diferença crítica do original)
-- NOMES: usa LEFT JOIN auth.users au (NÃO company_users)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_seller_performance(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  user_id           uuid,
  user_name         text,
  open_count        bigint,
  won_count         bigint,
  lost_count        bigint,
  won_value         numeric,
  conversion_rate   numeric,
  avg_cycle_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH open_by_seller AS (
    SELECT o.owner_user_id AS uid, COUNT(*)::BIGINT AS cnt
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id     = p_company_id
      AND o.status         = 'open'
      AND o.owner_user_id  IS NOT NULL
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    GROUP BY o.owner_user_id
  ),
  closed_by_seller AS (
    SELECT
      o.owner_user_id                                                                  AS uid,
      COUNT(*) FILTER (WHERE o.status = 'won')::BIGINT                                AS won_cnt,
      COUNT(*) FILTER (WHERE o.status = 'lost')::BIGINT                               AS lost_cnt,
      COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0)                       AS w_val,
      ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC)
        FILTER (WHERE o.status = 'won'))                                               AS avg_cycle
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id    = p_company_id
      AND o.closed_at     BETWEEN p_date_from AND p_date_to
      AND o.status        IN ('won', 'lost')
      AND o.owner_user_id IS NOT NULL
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    GROUP BY o.owner_user_id
  )
  SELECT
    COALESCE(cs.uid, os.uid),
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1),
      'Usuário removido'
    )::TEXT,
    COALESCE(os.cnt, 0),
    COALESCE(cs.won_cnt, 0),
    COALESCE(cs.lost_cnt, 0),
    COALESCE(cs.w_val, 0),
    ROUND(
      COALESCE(cs.won_cnt, 0)::NUMERIC
      / NULLIF(COALESCE(cs.won_cnt, 0) + COALESCE(cs.lost_cnt, 0), 0)::NUMERIC
      * 100, 1
    ),
    cs.avg_cycle
  FROM closed_by_seller cs
  FULL OUTER JOIN open_by_seller os ON os.uid = cs.uid
  LEFT JOIN auth.users au ON au.id = COALESCE(cs.uid, os.uid)
  ORDER BY COALESCE(cs.w_val, 0) DESC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_seller_performance(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 4. get_cycle_time_metrics
-- LANGUAGE: plpgsql
-- RETORNA: dimension text, group_id uuid, group_name text
--   (NÃO breakdown_type / entity_id / entity_name — diferença crítica)
-- NOTA: PERCENTILE_CONT usa cast duplo ::NUMERIC no resultado:
--   ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC)
-- NOMES: usa LEFT JOIN auth.users au para seller breakdown
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_cycle_time_metrics(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  dimension           text,
  group_id            uuid,
  group_name          text,
  won_count           bigint,
  lost_count          bigint,
  won_avg_seconds     numeric,
  won_median_seconds  numeric,
  won_max_seconds     numeric,
  won_min_seconds     numeric,
  lost_avg_seconds    numeric,
  lost_median_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Total
  RETURN QUERY WITH
    won_total AS (
      SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    lost_total AS (
      SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    won_agg AS (
      SELECT COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_total
    ),
    lost_agg AS (
      SELECT COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_total
    )
  SELECT 'total'::TEXT, NULL::UUID, 'Total'::TEXT,
    wa.cnt, la.cnt, wa.avg_s, wa.med_s, wa.max_s, wa.min_s, la.avg_s, la.med_s
  FROM won_agg wa, lost_agg la;

  -- By funnel
  RETURN QUERY WITH
    won_f AS (
      SELECT ofp.funnel_id, sf.name AS fn,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      JOIN sales_funnels sf ON sf.id = ofp.funnel_id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    lost_f AS (
      SELECT ofp.funnel_id,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    won_fagg AS (
      SELECT funnel_id, fn, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_f GROUP BY funnel_id, fn
    ),
    lost_fagg AS (
      SELECT funnel_id, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_f GROUP BY funnel_id
    )
  SELECT 'funnel'::TEXT, wf.funnel_id, wf.fn::TEXT,
    wf.cnt, COALESCE(lf.cnt, 0), wf.avg_s, wf.med_s, wf.max_s, wf.min_s, lf.avg_s, lf.med_s
  FROM won_fagg wf LEFT JOIN lost_fagg lf ON lf.funnel_id = wf.funnel_id
  ORDER BY wf.cnt DESC;

  -- By seller
  RETURN QUERY WITH
    won_s AS (
      SELECT o.owner_user_id,
        COALESCE(
          au.raw_user_meta_data->>'name',
          au.raw_user_meta_data->>'display_name',
          au.raw_user_meta_data->>'full_name',
          split_part(au.email::text, '@', 1),
          'Usuário removido'
        ) AS uname,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      LEFT JOIN auth.users au ON au.id = o.owner_user_id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.owner_user_id IS NOT NULL
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    lost_s AS (
      SELECT o.owner_user_id,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.owner_user_id IS NOT NULL
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    ),
    won_sagg AS (
      SELECT owner_user_id, uname, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_s GROUP BY owner_user_id, uname
    ),
    lost_sagg AS (
      SELECT owner_user_id, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_s GROUP BY owner_user_id
    )
  SELECT 'seller'::TEXT, ws.owner_user_id, ws.uname::TEXT,
    ws.cnt, COALESCE(ls.cnt, 0), ws.avg_s, ws.med_s, ws.max_s, ws.min_s, ls.avg_s, ls.med_s
  FROM won_sagg ws LEFT JOIN lost_sagg ls ON ls.owner_user_id = ws.owner_user_id
  ORDER BY ws.cnt DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_cycle_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;
