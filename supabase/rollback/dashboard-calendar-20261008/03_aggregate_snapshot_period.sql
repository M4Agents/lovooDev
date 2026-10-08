-- NÃO APLICAR depois que existirem linhas de outra calendar_basis.
-- Esta definição viva soma todas as bases. A recuperação é o arquivo
-- 05_aggregate_snapshot_period_mesma_base.sql.
--
-- Definição viva capturada em 2026-10-08 por pg_get_functiondef.
-- CREATE OR REPLACE da mesma assinatura preserva owner, search_path e ACL.
-- Não executar GRANT. Restaurar a função não desfaz snapshots.
-- Esta versão soma todas as calendar_basis. Não usar depois que existirem
-- linhas geradas no fuso da empresa, senão as bases voltam a ser somadas.

CREATE OR REPLACE FUNCTION public.aggregate_snapshot_period(p_company_id uuid, p_funnel_id uuid, p_start_date date, p_end_date date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flow  JSON;
  v_state JSON;
  v_meta  JSON;
  v_days  INT;
BEGIN
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
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
$function$;
