-- =====================================================
-- MIGRATION: RPCs Analíticas — Módulo de Relatórios
-- Data: 09/04/2026
-- Objetivo:
--   Criar 4 RPCs SECURITY DEFINER para o módulo de relatórios:
--   1. get_funnel_overview   - KPIs gerais (Visão Geral)
--   2. get_stage_time_metrics - Tempo por etapa (Por Etapa)
--   3. get_seller_performance - Performance por vendedor (Por Vendedor)
--   4. get_cycle_time_metrics - Ciclo de vendas (Tempo de Ciclo)
--
-- Regras críticas de cálculo:
--   - Taxa de conversão: apenas oportunidades com closed_at no período
--   - Tempo de ciclo: closed_at - created_at (não soma de duration_seconds)
--   - Oportunidades paradas: entered_stage_at da posição atual
--   - Tempo por etapa: duration_seconds agrupado por from_stage_id
--
-- Compatibilidade: PostgreSQL 15 (PERCENTILE_CONT sem FILTER)
-- =====================================================

-- =====================================================
-- ÍNDICE ADICIONAL (se não existir)
-- Útil para analytics por oportunidade e por empresa
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ostagehist_company_opp
  ON opportunity_stage_history (company_id, opportunity_id);

-- =====================================================
-- RPC 1: get_funnel_overview
-- KPIs gerais para a aba Visão Geral
-- Retorna: 1 linha com todos os KPIs do período
-- =====================================================
CREATE OR REPLACE FUNCTION get_funnel_overview(
  p_company_id   UUID,
  p_funnel_ids   UUID[]       DEFAULT NULL,
  p_date_from    TIMESTAMPTZ  DEFAULT date_trunc('month', now()),
  p_date_to      TIMESTAMPTZ  DEFAULT now(),
  p_stalled_days INTEGER      DEFAULT 15
)
RETURNS TABLE (
  open_count             BIGINT,
  won_count              BIGINT,
  lost_count             BIGINT,
  conversion_rate        NUMERIC,
  won_value              NUMERIC,
  lost_value             NUMERIC,
  avg_cycle_won_seconds  NUMERIC,
  avg_cycle_lost_seconds NUMERIC,
  stalled_count          BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE o.status = 'open')::BIGINT
      AS open_count,
    COUNT(*) FILTER (WHERE o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT
      AS won_count,
    COUNT(*) FILTER (WHERE o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT
      AS lost_count,
    ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'won' AND o.closed_at BETWEEN p_date_from AND p_date_to
      )::NUMERIC
      / NULLIF(
          COUNT(*) FILTER (
            WHERE o.status IN ('won','lost')
              AND o.closed_at BETWEEN p_date_from AND p_date_to
          ), 0
        )::NUMERIC * 100
    , 1) AS conversion_rate,
    COALESCE(SUM(o.value) FILTER (
      WHERE o.status = 'won' AND o.closed_at BETWEEN p_date_from AND p_date_to
    ), 0) AS won_value,
    COALESCE(SUM(o.value) FILTER (
      WHERE o.status = 'lost' AND o.closed_at BETWEEN p_date_from AND p_date_to
    ), 0) AS lost_value,
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'won' AND o.closed_at BETWEEN p_date_from AND p_date_to
    )) AS avg_cycle_won_seconds,
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'lost' AND o.closed_at BETWEEN p_date_from AND p_date_to
    )) AS avg_cycle_lost_seconds,
    COUNT(*) FILTER (
      WHERE o.status = 'open'
        AND ofp.entered_stage_at < now() - (p_stalled_days || ' days')::INTERVAL
    )::BIGINT AS stalled_count
  FROM opportunities o
  JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
  WHERE o.company_id = p_company_id
    AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids));
$$;

GRANT EXECUTE ON FUNCTION get_funnel_overview(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
  TO authenticated;

-- =====================================================
-- RPC 2: get_stage_time_metrics
-- Tempo médio por etapa para a aba Por Etapa
-- Agrupa por from_stage_id (duration_seconds = tempo em from_stage)
-- =====================================================
CREATE OR REPLACE FUNCTION get_stage_time_metrics(
  p_company_id  UUID,
  p_funnel_ids  UUID[]      DEFAULT NULL,
  p_date_from   TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_date_to     TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  stage_id                  UUID,
  stage_name                TEXT,
  stage_color               TEXT,
  stage_position            INTEGER,
  funnel_id                 UUID,
  funnel_name               TEXT,
  current_open_count        BIGINT,
  historical_movement_count BIGINT,
  avg_duration_seconds      NUMERIC,
  median_duration_seconds   NUMERIC,
  max_duration_seconds      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      osh.from_stage_id                                                                     AS sid,
      COUNT(*)::BIGINT                                                                      AS mv_count,
      ROUND(AVG(osh.duration_seconds::NUMERIC))                                            AS avg_dur,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY osh.duration_seconds::NUMERIC))   AS med_dur,
      MAX(osh.duration_seconds)::NUMERIC                                                   AS max_dur
    FROM opportunity_stage_history osh
    WHERE osh.company_id = p_company_id
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
$$;

GRANT EXECUTE ON FUNCTION get_stage_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

-- =====================================================
-- RPC 3: get_seller_performance
-- Performance por vendedor para a aba Por Vendedor
-- Conversão: apenas oportunidades fechadas no período
-- Ciclo: AVG(closed_at - created_at) para ganhas no período
-- =====================================================
CREATE OR REPLACE FUNCTION get_seller_performance(
  p_company_id  UUID,
  p_funnel_ids  UUID[]      DEFAULT NULL,
  p_date_from   TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_date_to     TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  owner_user_id     UUID,
  user_name         TEXT,
  open_count        BIGINT,
  won_count         BIGINT,
  lost_count        BIGINT,
  won_value         NUMERIC,
  conversion_rate   NUMERIC,
  avg_cycle_seconds NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH open_by_seller AS (
    SELECT o.owner_user_id AS uid, COUNT(*)::BIGINT AS cnt
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.status = 'open'
      AND o.owner_user_id IS NOT NULL
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    GROUP BY o.owner_user_id
  ),
  closed_by_seller AS (
    SELECT
      o.owner_user_id                                                        AS uid,
      COUNT(*) FILTER (WHERE o.status = 'won')::BIGINT                      AS won_cnt,
      COUNT(*) FILTER (WHERE o.status = 'lost')::BIGINT                     AS lost_cnt,
      COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0)             AS w_val,
      ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at)))
        FILTER (WHERE o.status = 'won'))                                    AS avg_cycle
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND o.status IN ('won', 'lost')
      AND o.owner_user_id IS NOT NULL
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
    GROUP BY o.owner_user_id
  )
  SELECT
    COALESCE(cs.uid, os.uid)                                                AS owner_user_id,
    COALESCE(cu.display_name, cu.email, 'Usuário removido')::TEXT           AS user_name,
    COALESCE(os.cnt, 0)                                                     AS open_count,
    COALESCE(cs.won_cnt, 0)                                                 AS won_count,
    COALESCE(cs.lost_cnt, 0)                                                AS lost_count,
    COALESCE(cs.w_val, 0)                                                   AS won_value,
    ROUND(
      COALESCE(cs.won_cnt, 0)::NUMERIC
      / NULLIF(COALESCE(cs.won_cnt, 0) + COALESCE(cs.lost_cnt, 0), 0)::NUMERIC
      * 100, 1
    )                                                                       AS conversion_rate,
    cs.avg_cycle                                                            AS avg_cycle_seconds
  FROM closed_by_seller cs
  FULL OUTER JOIN open_by_seller os ON os.uid = cs.uid
  LEFT JOIN company_users cu
    ON cu.user_id = COALESCE(cs.uid, os.uid)
   AND cu.company_id = p_company_id
  ORDER BY COALESCE(cs.w_val, 0) DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_seller_performance(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

-- =====================================================
-- RPC 4: get_cycle_time_metrics
-- Ciclo de vendas para a aba Tempo de Ciclo
-- Retorna linhas com breakdown_type: 'total' | 'funnel' | 'seller'
-- Compatível com PG15: usa CTEs pré-filtradas para PERCENTILE_CONT
-- (evita FILTER em ordered-set aggregates, não suportado em PG15)
-- =====================================================
CREATE OR REPLACE FUNCTION get_cycle_time_metrics(
  p_company_id  UUID,
  p_funnel_ids  UUID[]      DEFAULT NULL,
  p_date_from   TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_date_to     TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  breakdown_type      TEXT,
  entity_id           UUID,
  entity_name         TEXT,
  won_count           BIGINT,
  lost_count          BIGINT,
  won_avg_seconds     NUMERIC,
  won_median_seconds  NUMERIC,
  won_max_seconds     NUMERIC,
  won_min_seconds     NUMERIC,
  lost_avg_seconds    NUMERIC,
  lost_median_seconds NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Row: total (pré-filtrar em CTEs separadas para compatibilidade com PG15)
  RETURN QUERY
  WITH won_total AS (
    SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  lost_total AS (
    SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  won_agg AS (
    SELECT
      COUNT(*)::BIGINT                                                    AS cnt,
      ROUND(AVG(secs))                                                    AS avg_s,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))           AS med_s,
      ROUND(MAX(secs))                                                    AS max_s,
      ROUND(MIN(secs))                                                    AS min_s
    FROM won_total
  ),
  lost_agg AS (
    SELECT
      COUNT(*)::BIGINT                                                    AS cnt,
      ROUND(AVG(secs))                                                    AS avg_s,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))           AS med_s
    FROM lost_total
  )
  SELECT 'total'::TEXT, NULL::UUID, 'Total'::TEXT,
    wa.cnt, la.cnt, wa.avg_s, wa.med_s, wa.max_s, wa.min_s, la.avg_s, la.med_s
  FROM won_agg wa, lost_agg la;

  -- Rows: por funil
  RETURN QUERY
  WITH won_f AS (
    SELECT ofp.funnel_id, sf.name AS fn,
           EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    JOIN sales_funnels sf ON sf.id = ofp.funnel_id
    WHERE o.company_id = p_company_id
      AND o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  lost_f AS (
    SELECT ofp.funnel_id,
           EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  won_fagg AS (
    SELECT funnel_id, fn,
           COUNT(*)::BIGINT                                                 AS cnt,
           ROUND(AVG(secs))                                                 AS avg_s,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))        AS med_s,
           ROUND(MAX(secs))                                                 AS max_s,
           ROUND(MIN(secs))                                                 AS min_s
    FROM won_f GROUP BY funnel_id, fn
  ),
  lost_fagg AS (
    SELECT funnel_id,
           COUNT(*)::BIGINT                                                 AS cnt,
           ROUND(AVG(secs))                                                 AS avg_s,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))        AS med_s
    FROM lost_f GROUP BY funnel_id
  )
  SELECT 'funnel'::TEXT, wf.funnel_id, wf.fn::TEXT,
    wf.cnt, COALESCE(lf.cnt, 0),
    wf.avg_s, wf.med_s, wf.max_s, wf.min_s,
    lf.avg_s, lf.med_s
  FROM won_fagg wf
  LEFT JOIN lost_fagg lf ON lf.funnel_id = wf.funnel_id
  ORDER BY wf.cnt DESC;

  -- Rows: por vendedor
  RETURN QUERY
  WITH won_s AS (
    SELECT o.owner_user_id,
           COALESCE(cu.display_name, cu.email, 'Usuário removido') AS uname,
           EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    LEFT JOIN company_users cu
      ON cu.user_id = o.owner_user_id AND cu.company_id = p_company_id
    WHERE o.company_id = p_company_id
      AND o.status = 'won'
      AND o.owner_user_id IS NOT NULL
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  lost_s AS (
    SELECT o.owner_user_id,
           EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) AS secs
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id = p_company_id
      AND o.status = 'lost'
      AND o.owner_user_id IS NOT NULL
      AND o.closed_at BETWEEN p_date_from AND p_date_to
      AND (p_funnel_ids IS NULL OR ofp.funnel_id = ANY(p_funnel_ids))
  ),
  won_sagg AS (
    SELECT owner_user_id, uname,
           COUNT(*)::BIGINT                                                 AS cnt,
           ROUND(AVG(secs))                                                 AS avg_s,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))        AS med_s,
           ROUND(MAX(secs))                                                 AS max_s,
           ROUND(MIN(secs))                                                 AS min_s
    FROM won_s GROUP BY owner_user_id, uname
  ),
  lost_sagg AS (
    SELECT owner_user_id,
           COUNT(*)::BIGINT                                                 AS cnt,
           ROUND(AVG(secs))                                                 AS avg_s,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))        AS med_s
    FROM lost_s GROUP BY owner_user_id
  )
  SELECT 'seller'::TEXT, ws.owner_user_id, ws.uname::TEXT,
    ws.cnt, COALESCE(ls.cnt, 0),
    ws.avg_s, ws.med_s, ws.max_s, ws.min_s,
    ls.avg_s, ls.med_s
  FROM won_sagg ws
  LEFT JOIN lost_sagg ls ON ls.owner_user_id = ws.owner_user_id
  ORDER BY ws.cnt DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_cycle_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;
