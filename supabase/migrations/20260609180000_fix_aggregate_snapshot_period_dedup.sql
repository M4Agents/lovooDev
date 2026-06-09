-- =============================================================================
-- FASE 5.4.1 — Hotfix: aggregate_snapshot_period com deduplicação por dia
--
-- Problema: a função somava todas as linhas brutas de dashboard_snapshots,
-- incluindo as duplicatas geradas pelo cron (funnel_id IS NULL sem constraint
-- NULLS NOT DISTINCT). Isso inflava métricas FLOW em ~5× para tenants com
-- histórico de 7+ dias.
--
-- Correção:
--   - FLOW: usa CTE DISTINCT ON (period_start) antes de somar
--   - STATE: mantém ORDER BY period_start DESC, snapshot_taken_at DESC
--   - snapshot_days_found: agora reflete dias únicos (COUNT(*) no CTE deduped)
-- =============================================================================

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

  -- FLOW: deduplicar por period_start, mantendo o snapshot mais recente do dia
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

  -- STATE: snapshot mais recente dentro ou antes do período
  -- ORDER BY period_start DESC, snapshot_taken_at DESC garante o tie-break correto
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
