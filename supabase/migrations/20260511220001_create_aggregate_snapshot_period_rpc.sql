-- =====================================================
-- FASE 4.0 — Snapshot Executivo Histórico
-- Migration 2/3: aggregate_snapshot_period — helper centralizado
--
-- OBJETIVO ANTI-DRIFT:
--   Toda query de comparação, tendência e forecast histórico
--   DEVE chamar esta função — nunca agregar dashboard_snapshots
--   diretamente em endpoints.
--
-- Regras aplicadas:
--   FLOW metrics  → SUM das linhas no período
--   STATE metrics → valor do snapshot mais recente do período (LAST_VALUE)
--
-- Retorno: JSON com { flow: {...}, state: {...}, meta: {...} }
-- =====================================================

CREATE OR REPLACE FUNCTION aggregate_snapshot_period(
  p_company_id UUID,
  p_funnel_id  UUID,      -- NULL para company-wide
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow   JSON;
  v_state  JSON;
  v_meta   JSON;
  v_days   INT;
BEGIN
  -- ── FLOW: SUM de todas as linhas no intervalo ─────────────────────────────
  SELECT json_build_object(
    'leads_created',          COALESCE(SUM(s.leads_created),          0),
    'conversations_attended', COALESCE(SUM(s.conversations_attended), 0),
    'won_count',              COALESCE(SUM(s.won_count),              0),
    'won_value',              COALESCE(SUM(s.won_value),              0),
    'lost_count',             COALESCE(SUM(s.lost_count),             0),
    'lost_value',             COALESCE(SUM(s.lost_value),             0),
    'sla_breached_count',     COALESCE(SUM(s.sla_breached_count),     0)
  ),
  COUNT(*)::INT
  INTO v_flow, v_days
  FROM dashboard_snapshots s
  WHERE s.company_id   = p_company_id
    AND (
          (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
       OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
        )
    AND s.period_start BETWEEN p_start_date AND p_end_date;

  -- ── STATE: snapshot mais recente dentro do período ───────────────────────
  SELECT json_build_object(
    'pipeline_total',     s.pipeline_total,
    'pipeline_weighted',  s.pipeline_weighted,
    'pipeline_risk',      s.pipeline_risk,
    'open_count',         s.open_count,
    'stalled_count',      s.stalled_count,
    'hot_count',          s.hot_count,
    'avg_response_minutes', s.avg_response_minutes,
    'conversion_rate',    s.conversion_rate,
    'prob_0_20_value',    s.prob_0_20_value,
    'prob_21_40_value',   s.prob_21_40_value,
    'prob_41_60_value',   s.prob_41_60_value,
    'prob_61_80_value',   s.prob_61_80_value,
    'prob_81_100_value',  s.prob_81_100_value,
    'funnel_stages_cache', s.funnel_stages_cache,
    'snapshot_date',      s.period_start
  )
  INTO v_state
  FROM dashboard_snapshots s
  WHERE s.company_id   = p_company_id
    AND (
          (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
       OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
        )
    AND s.period_start <= p_end_date
  ORDER BY s.period_start DESC
  LIMIT 1;

  -- ── META: contexto da agregação ─────────────────────────────────────────
  v_meta := json_build_object(
    'from_date',            p_start_date,
    'to_date',              p_end_date,
    'funnel_id',            p_funnel_id,
    'snapshot_days_found',  COALESCE(v_days, 0),
    'has_data',             COALESCE(v_days, 0) > 0
  );

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  v_meta
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION aggregate_snapshot_period(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION aggregate_snapshot_period(UUID, UUID, DATE, DATE) TO authenticated;
COMMENT ON FUNCTION aggregate_snapshot_period IS
  'Helper centralizado anti-drift para agregar snapshots históricos.
   FLOW metrics → SUM. STATE metrics → LAST_VALUE (último dia do período).
   Toda API de comparação e tendência deve chamar esta função.
   Nunca agregar dashboard_snapshots diretamente em endpoints.';


-- =====================================================
-- aggregate_seller_snapshot_period
--
-- Versão para seller_snapshots.
-- FLOW → SUM; STATE → LAST_VALUE.
-- =====================================================

CREATE OR REPLACE FUNCTION aggregate_seller_snapshot_period(
  p_company_id UUID,
  p_user_id    UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow  JSON;
  v_state JSON;
  v_days  INT;
BEGIN
  -- FLOW: SUM
  SELECT json_build_object(
    'leads_received',   COALESCE(SUM(s.leads_received),   0),
    'leads_attended',   COALESCE(SUM(s.leads_attended),   0),
    'opps_generated',   COALESCE(SUM(s.opps_generated),   0),
    'opps_won',         COALESCE(SUM(s.opps_won),         0),
    'won_value',        COALESCE(SUM(s.won_value),        0),
    'sla_missed_count', COALESCE(SUM(s.sla_missed_count), 0)
  ),
  COUNT(*)::INT
  INTO v_flow, v_days
  FROM dashboard_seller_snapshots s
  WHERE s.company_id   = p_company_id
    AND s.user_id      = p_user_id
    AND s.period_start BETWEEN p_start_date AND p_end_date;

  -- STATE: LAST_VALUE
  SELECT json_build_object(
    'attendance_rate',  s.attendance_rate,
    'avg_response_min', s.avg_response_min,
    'conversion_rate',  s.conversion_rate,
    'snapshot_date',    s.period_start
  )
  INTO v_state
  FROM dashboard_seller_snapshots s
  WHERE s.company_id   = p_company_id
    AND s.user_id      = p_user_id
    AND s.period_start <= p_end_date
  ORDER BY s.period_start DESC
  LIMIT 1;

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  json_build_object(
      'from_date',           p_start_date,
      'to_date',             p_end_date,
      'snapshot_days_found', COALESCE(v_days, 0),
      'has_data',            COALESCE(v_days, 0) > 0
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION aggregate_seller_snapshot_period(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION aggregate_seller_snapshot_period(UUID, UUID, DATE, DATE) TO authenticated;
