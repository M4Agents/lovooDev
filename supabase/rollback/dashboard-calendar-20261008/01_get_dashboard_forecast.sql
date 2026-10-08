-- Definição viva capturada em 2026-10-08 por pg_get_functiondef.
-- CREATE OR REPLACE da mesma assinatura preserva owner, search_path e ACL.
-- Não executar GRANT. Restaurar a função não desfaz snapshots.

CREATE OR REPLACE FUNCTION public.get_dashboard_forecast(p_company_id uuid, p_start_date date, p_end_date date, p_funnel_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_stalled_days integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

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
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'),  0)::NUMERIC, 2
      ) AS won_value,
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'), 0)::NUMERIC, 2
      ) AS lost_value,
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
$function$;
