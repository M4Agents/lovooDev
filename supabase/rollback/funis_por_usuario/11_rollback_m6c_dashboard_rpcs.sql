-- =====================================================================
-- ROLLBACK: M6c — Restaurar RPCs de Dashboard ao estado pré-M6c
--
-- O que é revertido:
--   M6c adicionou guard IF auth.uid() IS NOT NULL AND NOT auth_user_can_access_funnel(...)
--   nas RPCs:
--     - get_dashboard_funnel_executive
--     - get_dashboard_forecast
--     - aggregate_snapshot_period
--
-- Estado restaurado:
--   get_dashboard_funnel_executive → 20260511140000_fix_dashboard_rpcs_column_refs.sql
--   get_dashboard_forecast         → 20260509200000_dashboard_phase3a_rpcs.sql
--   aggregate_snapshot_period      → 20260609180000_fix_aggregate_snapshot_period_dedup.sql
--
-- Ordem correta do rollback completo: 11 → 10 → 09 → 08 → 07 → 06 → 05
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- 1. get_dashboard_funnel_executive
--    Estado: 20260511140000 (is_hidden = false)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_dashboard_funnel_executive(
  p_company_id UUID,
  p_funnel_id  UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH stages_ordered AS (
    SELECT
      fs.id       AS stage_id,
      fs.name     AS stage_name,
      fs.position AS stage_position,
      fs.color    AS stage_color
    FROM funnel_stages fs
    WHERE fs.funnel_id  = p_funnel_id
      AND fs.is_hidden  = false
    ORDER BY fs.position
  ),

  stage_opps AS (
    SELECT
      ofp.stage_id,
      COUNT(*)::INT                                                     AS opp_count,
      ROUND(COALESCE(SUM(o.value), 0)::NUMERIC, 2)                     AS total_value,
      ROUND(
        COALESCE(SUM(o.value * o.probability / 100.0), 0)::NUMERIC, 2
      )                                                                 AS weighted_value,
      COUNT(*) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < NOW() - INTERVAL '14 days'
      )::INT                                                            AS stalled_count,
      ROUND(
        COALESCE(
          SUM(o.value) FILTER (
            WHERE o.last_interaction_at IS NULL
               OR o.last_interaction_at < NOW() - INTERVAL '14 days'
          ),
          0
        )::NUMERIC, 2
      )                                                                 AS stalled_value
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o ON o.id = ofp.opportunity_id
    JOIN leads l         ON l.id = o.lead_id
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND o.status       = 'open'
      AND l.deleted_at   IS NULL
    GROUP BY ofp.stage_id
  ),

  stage_avg_days AS (
    SELECT
      osh.to_stage_id AS stage_id,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (COALESCE(osh.stage_left_at, NOW()) - osh.stage_entered_at)) / 86400.0
        )::NUMERIC, 1
      )               AS avg_days
    FROM opportunity_stage_history osh
    WHERE osh.funnel_id = p_funnel_id
    GROUP BY osh.to_stage_id
  )

  SELECT json_build_object(
    'funnel_id', p_funnel_id,
    'stages', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'stage_id',       s.stage_id,
            'stage_name',     s.stage_name,
            'stage_color',    s.stage_color,
            'position',       s.stage_position,
            'opp_count',      COALESCE(so.opp_count, 0),
            'total_value',    COALESCE(so.total_value, 0),
            'weighted_value', COALESCE(so.weighted_value, 0),
            'stalled_count',  COALESCE(so.stalled_count, 0),
            'stalled_value',  COALESCE(so.stalled_value, 0),
            'avg_days',       COALESCE(sad.avg_days, 0)
          )
          ORDER BY s.stage_position
        )
        FROM stages_ordered s
        LEFT JOIN stage_opps     so  ON so.stage_id  = s.stage_id
        LEFT JOIN stage_avg_days sad ON sad.stage_id = s.stage_id
      ),
      '[]'::JSON
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_funnel_executive(UUID, UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 2. get_dashboard_forecast
--    Estado: 20260509200000
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_dashboard_forecast(
  p_company_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_funnel_id    UUID    DEFAULT NULL,
  p_user_id      UUID    DEFAULT NULL,
  p_stalled_days INT     DEFAULT 14
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH open_pipeline AS (
    SELECT
      o.id,
      COALESCE(o.value, 0)       AS value,
      COALESCE(o.probability, 0) AS probability,
      o.last_interaction_at
    FROM   opportunities o
    JOIN   leads l ON l.id = o.lead_id
    LEFT JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
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
      ROUND(COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'),  0)::NUMERIC, 2) AS won_value,
      ROUND(COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'), 0)::NUMERIC, 2) AS lost_value,
      COUNT(*) FILTER (WHERE o.status = 'won')::INT  AS won_count,
      COUNT(*) FILTER (WHERE o.status = 'lost')::INT AS lost_count
    FROM  opportunities o
    JOIN  leads l ON l.id = o.lead_id
    WHERE o.company_id   = p_company_id
      AND l.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND o.closed_at    IS NOT NULL
      AND o.closed_at::DATE BETWEEN p_start_date AND p_end_date
      AND (p_funnel_id IS NULL OR EXISTS (
            SELECT 1 FROM opportunity_funnel_positions ofp2
            WHERE  ofp2.opportunity_id = o.id AND ofp2.funnel_id = p_funnel_id
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
                                   pc.won_count::NUMERIC / (pc.won_count + pc.lost_count) * 100, 1
                                 )
                               END
  )
  INTO v_result
  FROM pipeline_metrics pm, stalled_metrics sm, period_closed pc;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_forecast(UUID, DATE, DATE, UUID, UUID, INT) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 3. aggregate_snapshot_period
--    Estado: 20260609180000 (com deduplicação por period_start)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aggregate_snapshot_period(
  p_company_id uuid,
  p_funnel_id  uuid,
  p_start_date date,
  p_end_date   date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_flow  JSON;
  v_state JSON;
  v_meta  JSON;
  v_days  INT;
BEGIN

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
    FROM dashboard_snapshots s
    WHERE s.company_id = p_company_id
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
  FROM dashboard_snapshots s
  WHERE s.company_id = p_company_id
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
    'snapshot_days_found', COALESCE(v_days, 0),
    'has_data',            COALESCE(v_days, 0) > 0
  );

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  v_meta
  );
END;
$$;
