-- Recuperação da agregação compatível com as duas bases.
-- NÃO aplicar 03_aggregate_snapshot_period.sql: aquela função soma todas as bases.
-- Esta mantém o filtro calendar_basis e esvazia a janela incompleta.
-- CREATE OR REPLACE preserva owner e ACL. search_path, VOLATILE e PARALLEL UNSAFE
-- estão explícitos. Não executar GRANT nem REVOKE.

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
  v_flow        JSON;
  v_state       JSON;
  v_meta        JSON;
  v_days        INT;
  v_expected    INT;
  v_timezone    TEXT;
  v_compatible  BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  SELECT NULLIF(btrim(c.timezone), '')
    INTO v_timezone
  FROM companies c
  WHERE c.id = p_company_id;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = v_timezone
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
    FROM dashboard_snapshots s
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
  FROM dashboard_snapshots s
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

COMMENT ON FUNCTION aggregate_snapshot_period IS
  'Agrega snapshots somente na calendar_basis do fuso atual da empresa. Janela incompleta não devolve soma. Fórmulas de soma e último estado inalteradas.';
