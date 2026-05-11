-- =====================================================
-- FASE 3A — Inteligência Executiva Confiável
-- RPCs: alerts_count, forecast, priority_alerts, funnel_executive
--
-- Correções obrigatórias aplicadas:
--   • COUNT(*) em todos os trechos — sem COUNT() vazio
--   • pipeline_safe = pipeline_weighted - stalled_weighted_value (ambos ponderados)
--   • pipeline_risk = stalled_weighted_value (valor ponderado em risco)
-- =====================================================

-- =====================================================
-- 1. get_dashboard_alerts_count
--    Retorna INT escalar: SLA crítico/alto + oportunidades
--    abertas paradas > 14 dias com probabilidade >= 60.
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_alerts_count(
  p_company_id UUID,
  p_user_id    UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sla_count     INT := 0;
  v_stalled_count INT := 0;
BEGIN
  -- SLA: conversas com inbound sem resposta humana >= 4h
  SELECT COUNT(DISTINCT li.conversation_id)
  INTO   v_sla_count
  FROM (
    SELECT  cm.conversation_id,
            MAX(cm.created_at) AS last_in_at
    FROM    chat_messages cm
    JOIN    chat_conversations cc ON cc.id = cm.conversation_id
    JOIN    leads l               ON l.id  = cc.lead_id
    WHERE   cm.direction         = 'inbound'
      AND   cc.company_id        = p_company_id
      AND   l.company_id         = p_company_id
      AND   l.deleted_at         IS NULL
      AND   (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY cm.conversation_id
  ) li
  WHERE NOT EXISTS (
    SELECT 1
    FROM   chat_messages cm2
    WHERE  cm2.conversation_id  = li.conversation_id
      AND  cm2.direction        = 'outbound'
      AND  cm2.is_ai_generated  = false
      AND  cm2.created_at       > li.last_in_at
  )
  AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= 4;

  -- Oportunidades abertas paradas > 14 dias com probabilidade >= 60
  SELECT COUNT(*)
  INTO   v_stalled_count
  FROM   opportunities o
  JOIN   leads l ON l.id = o.lead_id
  WHERE  o.company_id  = p_company_id
    AND  o.status      = 'open'
    AND  o.probability >= 60
    AND  l.deleted_at  IS NULL
    AND  (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    AND  (
           o.last_interaction_at IS NULL
        OR o.last_interaction_at < NOW() - INTERVAL '14 days'
         );

  RETURN v_sla_count + v_stalled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_alerts_count(UUID, UUID) TO authenticated;


-- =====================================================
-- 2. get_dashboard_forecast
--    Métricas de pipeline: total bruto, ponderado,
--    risco ponderado, safe ponderado, ganhos/perdas no período.
--
--    pipeline_safe  = pipeline_weighted - stalled_weighted_value
--    pipeline_risk  = stalled_weighted_value
--    Ambos são valores PONDERADOS — sem mistura com valor bruto.
-- =====================================================
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
    -- Oportunidades abertas agora (estado atual, não usa período)
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
    -- Oportunidades paradas (sem interação por N dias)
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
    -- Ganhos e perdas fechados dentro do período (usa closed_at)
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
    -- Pipeline atual (estado presente)
    'pipeline_total',          pm.pipeline_total,
    'pipeline_weighted',       pm.pipeline_weighted,
    -- Risco: valor ponderado das oportunidades paradas
    'pipeline_risk',           sm.stalled_weighted_value,
    -- Seguro: weighted - risco (ambos ponderados — sem mistura com valor bruto)
    'pipeline_safe',           GREATEST(pm.pipeline_weighted - sm.stalled_weighted_value, 0),
    'open_count',              pm.open_count,
    -- Paradas
    'stalled_count',           sm.stalled_count,
    'stalled_value',           sm.stalled_value,           -- bruto (informativo)
    'stalled_weighted_value',  sm.stalled_weighted_value,  -- ponderado (usado em pipeline_risk)
    -- Fechamentos no período
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

GRANT EXECUTE ON FUNCTION get_dashboard_forecast(UUID, DATE, DATE, UUID, UUID, INT) TO authenticated;


-- =====================================================
-- 3. get_dashboard_priority_alerts
--    Alertas prioritários em tempo real (sem filtro de período).
--    Tipos: sla_critical, sla_high, stalled_opportunity, seller_risk.
--    Retorna JSON com array de alertas + contadores por severidade.
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_priority_alerts(
  p_company_id UUID,
  p_user_id    UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH last_inbound AS (
    SELECT
      cm.conversation_id,
      MAX(cm.created_at) AS last_in_at
    FROM   chat_messages cm
    JOIN   chat_conversations cc ON cc.id = cm.conversation_id
    JOIN   leads l               ON l.id  = cc.lead_id
    WHERE  cm.direction   = 'inbound'
      AND  cc.company_id  = p_company_id
      AND  l.company_id   = p_company_id
      AND  l.deleted_at   IS NULL
      AND  (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY cm.conversation_id
  ),

  has_response AS (
    SELECT DISTINCT cm.conversation_id
    FROM   chat_messages cm
    JOIN   last_inbound li ON li.conversation_id = cm.conversation_id
    WHERE  cm.direction       = 'outbound'
      AND  cm.is_ai_generated = false
      AND  cm.created_at      > li.last_in_at
  ),

  pending_sla AS (
    SELECT
      li.conversation_id,
      li.last_in_at,
      EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 AS hours_waiting,
      cc.lead_id,
      l.name                   AS lead_name,
      l.responsible_user_id
    FROM   last_inbound li
    LEFT JOIN has_response hr   ON hr.conversation_id = li.conversation_id
    JOIN   chat_conversations cc ON cc.id = li.conversation_id
    JOIN   leads l               ON l.id  = cc.lead_id
    WHERE  hr.conversation_id IS NULL
      AND  l.company_id = p_company_id
      AND  l.deleted_at IS NULL
  ),

  sla_critical AS (
    SELECT
      'sla_critical'::TEXT        AS type,
      'critical'::TEXT            AS severity,
      conversation_id::TEXT       AS entity_id,
      'conversation'::TEXT        AS entity_type,
      CONCAT('Lead sem resposta: ', COALESCE(lead_name, 'sem nome')) AS title,
      CONCAT(ROUND(hours_waiting::NUMERIC, 1)::TEXT, 'h sem resposta') AS description,
      hours_waiting               AS value,
      lead_id::TEXT               AS reference_id
    FROM pending_sla
    WHERE hours_waiting >= 24
    ORDER BY hours_waiting DESC
    LIMIT 5
  ),

  sla_high AS (
    SELECT
      'sla_high'::TEXT            AS type,
      'high'::TEXT                AS severity,
      conversation_id::TEXT       AS entity_id,
      'conversation'::TEXT        AS entity_type,
      CONCAT('Lead aguardando: ', COALESCE(lead_name, 'sem nome')) AS title,
      CONCAT(ROUND(hours_waiting::NUMERIC, 1)::TEXT, 'h sem resposta') AS description,
      hours_waiting               AS value,
      lead_id::TEXT               AS reference_id
    FROM pending_sla
    WHERE hours_waiting >= 4 AND hours_waiting < 24
    ORDER BY hours_waiting DESC
    LIMIT 5
  ),

  stalled_opps AS (
    SELECT
      'stalled_opportunity'::TEXT AS type,
      'high'::TEXT                AS severity,
      o.id::TEXT                  AS entity_id,
      'opportunity'::TEXT         AS entity_type,
      CONCAT('Oportunidade parada: ', COALESCE(l.name, 'sem nome')) AS title,
      CONCAT(
        ROUND(
          EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_interaction_at, o.created_at))) / 86400.0
        )::INT::TEXT,
        ' dias sem interação'
      )                           AS description,
      COALESCE(o.value, 0)        AS value,
      o.lead_id::TEXT             AS reference_id
    FROM  opportunities o
    JOIN  leads l ON l.id = o.lead_id
    WHERE o.company_id   = p_company_id
      AND o.status       = 'open'
      AND o.probability  >= 60
      AND l.deleted_at   IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      AND (
            o.last_interaction_at IS NULL
         OR o.last_interaction_at < NOW() - INTERVAL '14 days'
          )
    ORDER BY COALESCE(o.value, 0) DESC
    LIMIT 5
  ),

  seller_risk AS (
    -- Apenas visível quando não há filtro de usuário (visão gerencial)
    SELECT
      'seller_risk'::TEXT                  AS type,
      'high'::TEXT                         AS severity,
      l.responsible_user_id::TEXT          AS entity_id,
      'seller'::TEXT                       AS entity_type,
      CONCAT('Vendedor com pendências: ',
             COALESCE(cu.display_name, cu.email)) AS title,
      CONCAT(
        COUNT(DISTINCT ps.conversation_id)::TEXT,
        ' lead(s) sem resposta há +12h'
      )                                    AS description,
      COUNT(DISTINCT ps.conversation_id)::NUMERIC AS value,
      l.responsible_user_id::TEXT          AS reference_id
    FROM   pending_sla ps
    JOIN   leads l         ON l.id = ps.lead_id
    JOIN   company_users cu
             ON cu.user_id    = l.responsible_user_id
            AND cu.company_id = p_company_id
            AND cu.is_active  = true
    WHERE  ps.hours_waiting > 12
      AND  p_user_id IS NULL   -- exibido apenas na visão geral
    GROUP BY l.responsible_user_id, cu.display_name, cu.email
    HAVING COUNT(DISTINCT ps.conversation_id) >= 3
    ORDER BY COUNT(DISTINCT ps.conversation_id) DESC
    LIMIT 3
  ),

  all_alerts AS (
    SELECT type, severity, entity_id, entity_type, title, description, value, reference_id
    FROM sla_critical
    UNION ALL
    SELECT type, severity, entity_id, entity_type, title, description, value, reference_id
    FROM sla_high
    UNION ALL
    SELECT type, severity, entity_id, entity_type, title, description, value, reference_id
    FROM stalled_opps
    UNION ALL
    SELECT type, severity, entity_id, entity_type, title, description, value, reference_id
    FROM seller_risk
  )

  SELECT json_build_object(
    'alerts', COALESCE(
      (
        SELECT json_agg(a ORDER BY
          CASE a.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
          a.value DESC NULLS LAST
        )
        FROM all_alerts a
      ),
      '[]'::JSON
    ),
    'total',    (SELECT COUNT(*) FROM all_alerts),
    'critical', (SELECT COUNT(*) FROM all_alerts WHERE severity = 'critical'),
    'high',     (SELECT COUNT(*) FROM all_alerts WHERE severity = 'high')
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_priority_alerts(UUID, UUID) TO authenticated;


-- =====================================================
-- 4. get_dashboard_funnel_executive
--    Visão executiva do funil: valor total, ponderado,
--    avg_days por etapa, oportunidades paradas.
--    Complementa funnel-snapshot (não o substitui).
-- =====================================================
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
    WHERE fs.funnel_id = p_funnel_id
      AND fs.is_active = true
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
    -- funnel_id existe diretamente em opportunity_stage_history
    -- colunas corretas: stage_entered_at e stage_left_at
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
