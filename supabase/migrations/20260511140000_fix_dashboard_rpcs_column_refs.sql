-- =====================================================
-- MIGRATION: Corrige referências inválidas nas RPCs do dashboard
-- Data: 11/05/2026
--
-- Problemas corrigidos (evidência de runtime via execute_sql):
--
--   1. get_dashboard_seller_ranking
--      ERROR 42703: column cu.display_name does not exist
--      company_users não tem display_name nem email.
--      Fix: LEFT JOIN auth.users para obter nome e email.
--
--   2. get_dashboard_sla_alerts
--      ERROR 42703: column cu.display_name does not exist
--      Mesma causa. Fix: LEFT JOIN auth.users.
--
--   3. get_dashboard_priority_alerts
--      ERROR 42703: column cu.display_name does not exist
--      Mesma causa na CTE seller_risk. Fix: subquery em auth.users.
--
--   4. get_dashboard_funnel_executive
--      ERROR 42703: column fs.is_active does not exist
--      funnel_stages não tem is_active (tem is_hidden).
--      Fix: substituir is_active = true por is_hidden = false.
--
-- Padrão de referência (get_seller_performance — funcionando):
--   LEFT JOIN auth.users au ON au.id = <user_id>
--   COALESCE(au.raw_user_meta_data->>'name',
--            au.raw_user_meta_data->>'full_name',
--            split_part(au.email::text, '@', 1),
--            'Usuário')
-- =====================================================

-- =====================================================
-- 1. get_dashboard_seller_ranking — fix cu.display_name / cu.email
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_seller_ranking(
  p_company_id      UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_user_id         UUID    DEFAULT NULL,
  p_include_ranking BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH
  active_sellers AS (
    SELECT
      cu.user_id,
      COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'full_name',
        split_part(au.email::text, '@', 1),
        cu.user_id::TEXT
      ) AS display_name
    FROM company_users cu
    LEFT JOIN auth.users au ON au.id = cu.user_id
    WHERE cu.company_id = p_company_id
      AND cu.is_active  = true
      AND cu.role       IN ('seller', 'manager', 'admin')
      AND (p_user_id IS NULL OR cu.user_id = p_user_id)
  ),

  leads_metrics AS (
    SELECT
      l.responsible_user_id         AS user_id,
      COUNT(DISTINCT l.id)::INT     AS leads_received
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  opp_metrics AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.created_at >= p_start_date AND o.created_at <= p_end_date
      )::INT AS opps_generated,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      )::INT AS opps_won,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status IN ('won','lost')
      )::INT AS opps_closed,
      COALESCE(SUM(o.value) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      ), 0) AS won_value
    FROM leads l
    JOIN opportunities o ON o.lead_id = l.id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  first_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= p_start_date
      AND cm.created_at <= p_end_date
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),

  first_human_response AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS response_min
    FROM first_inbound fi
    JOIN chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),

  attendance_metrics AS (
    SELECT
      l.responsible_user_id                       AS user_id,
      COUNT(DISTINCT fhr.conversation_id)::INT    AS leads_attended,
      ROUND(AVG(fhr.response_min)::NUMERIC, 1)    AS avg_response_min
    FROM first_human_response fhr
    JOIN chat_conversations cc ON cc.id = fhr.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  sla_missed_convs AS (
    SELECT fi.conversation_id
    FROM first_inbound fi
    LEFT JOIN first_human_response fhr ON fhr.conversation_id = fi.conversation_id
    WHERE fhr.conversation_id IS NULL
  ),

  sla_metrics AS (
    SELECT
      l.responsible_user_id                        AS user_id,
      COUNT(DISTINCT smc.conversation_id)::INT     AS sla_missed_count
    FROM sla_missed_convs smc
    JOIN chat_conversations cc ON cc.id = smc.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  combined AS (
    SELECT
      s.user_id,
      s.display_name,
      COALESCE(lm.leads_received,   0) AS leads_received,
      COALESCE(am.leads_attended,   0) AS leads_attended,
      am.avg_response_min,
      COALESCE(om.opps_generated,   0) AS opps_generated,
      COALESCE(om.opps_won,         0) AS opps_won,
      COALESCE(om.opps_closed,      0) AS opps_closed,
      COALESCE(om.won_value,        0) AS won_value,
      COALESCE(sm.sla_missed_count, 0) AS sla_missed_count
    FROM active_sellers s
    LEFT JOIN leads_metrics lm      ON lm.user_id = s.user_id
    LEFT JOIN opp_metrics om        ON om.user_id = s.user_id
    LEFT JOIN attendance_metrics am ON am.user_id = s.user_id
    LEFT JOIN sla_metrics sm        ON sm.user_id = s.user_id
    WHERE COALESCE(lm.leads_received, 0) > 0
  ),

  norm AS (
    SELECT *,
      MAX(COALESCE(avg_response_min, 0)) OVER () AS max_response,
      MAX(opps_generated)               OVER () AS max_opps
    FROM combined
  ),

  scored AS (
    SELECT
      user_id,
      display_name,
      leads_received,
      leads_attended,
      avg_response_min,
      opps_generated,
      opps_won,
      opps_closed,
      won_value,
      sla_missed_count,
      ROUND(COALESCE(leads_attended::NUMERIC    / NULLIF(leads_received,  0), 0),   3) AS attendance_rate,
      ROUND(COALESCE(opps_won::NUMERIC          / NULLIF(opps_closed,     0), 0.5), 3) AS conversion_rate,
      ROUND(COALESCE(sla_missed_count::NUMERIC  / NULLIF(leads_received,  0), 0),   3) AS sla_missed_rate,
      CASE WHEN p_include_ranking THEN
        ROUND((
          0.35 * COALESCE(opps_won::NUMERIC / NULLIF(opps_closed, 0), 0.5)
        + 0.25 * CASE
                   WHEN avg_response_min IS NULL THEN 0
                   WHEN max_response > 0         THEN 1.0 - (avg_response_min / max_response)
                   ELSE 1.0
                 END
        + 0.20 * COALESCE(leads_attended::NUMERIC / NULLIF(leads_received, 0), 0)
        + 0.10 * CASE WHEN max_opps > 0 THEN opps_generated::NUMERIC / max_opps ELSE 0 END
        + 0.10 * GREATEST(1.0 - COALESCE(sla_missed_count::NUMERIC / NULLIF(leads_received, 0), 0), 0)
        ) * 100, 1)
      ELSE NULL
      END AS score
    FROM norm
  )

  SELECT json_agg(row_to_json(t) ORDER BY COALESCE(t.score, -1) DESC)
  INTO   v_result
  FROM (
    SELECT
      scored.*,
      CASE WHEN p_include_ranking AND score IS NOT NULL
           THEN ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST)
           ELSE NULL
      END AS rank
    FROM scored
  ) t;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_seller_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC;


-- =====================================================
-- 2. get_dashboard_sla_alerts — fix cu.display_name / cu.email
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_sla_alerts(
  p_company_id    UUID,
  p_user_id       UUID     DEFAULT NULL,
  p_sla_hours     NUMERIC  DEFAULT 6,
  p_max_age_hours INTEGER  DEFAULT 168,
  p_limit         INTEGER  DEFAULT 20,
  p_offset        INTEGER  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSON;
  v_total BIGINT := 0;
BEGIN

  -- Passo 1: total
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS last_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= NOW() - make_interval(hours => p_max_age_hours)
    ORDER BY cm.conversation_id, cm.created_at DESC
  ),
  has_response AS (
    SELECT DISTINCT li.conversation_id
    FROM last_inbound li
    JOIN chat_messages cm
      ON  cm.conversation_id = li.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > li.last_in_at
  ),
  pending AS (
    SELECT li.conversation_id
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
  )
  SELECT COUNT(DISTINCT p.conversation_id)
  INTO   v_total
  FROM pending p
  JOIN chat_conversations cc ON cc.id = p.conversation_id
  JOIN leads l               ON l.id  = cc.lead_id
  WHERE cc.lead_id  IS NOT NULL
    AND l.company_id  = p_company_id
    AND l.deleted_at IS NULL
    AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id);

  -- Passo 2: dados paginados
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS last_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= NOW() - make_interval(hours => p_max_age_hours)
    ORDER BY cm.conversation_id, cm.created_at DESC
  ),
  has_response AS (
    SELECT DISTINCT li.conversation_id
    FROM last_inbound li
    JOIN chat_messages cm
      ON  cm.conversation_id = li.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > li.last_in_at
  ),
  pending AS (
    SELECT
      li.conversation_id,
      li.last_in_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0, 1) AS hours_waiting
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
  )
  SELECT json_agg(row_to_json(t))
  INTO   v_items
  FROM (
    SELECT
      p.conversation_id::TEXT                                  AS conversation_id,
      l.id::TEXT                                               AS lead_id,
      COALESCE(l.name, 'Lead sem nome')                        AS lead_name,
      l.responsible_user_id::TEXT                              AS responsible_user_id,
      COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'full_name',
        split_part(au.email::text, '@', 1)
      )                                                        AS seller_name,
      p.last_in_at,
      p.hours_waiting,
      CASE
        WHEN p.hours_waiting > 48 THEN 'critical'
        WHEN p.hours_waiting > 24 THEN 'high'
        WHEN p.hours_waiting > 12 THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM pending p
    JOIN chat_conversations cc ON cc.id = p.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    LEFT JOIN company_users cu
      ON  cu.user_id    = l.responsible_user_id
      AND cu.company_id = p_company_id
    LEFT JOIN auth.users au ON au.id = l.responsible_user_id
    WHERE cc.lead_id  IS NOT NULL
      AND l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    ORDER BY p.last_in_at ASC
    LIMIT  p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'items',  COALESCE(v_items, '[]'::JSON),
    'total',  v_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_sla_alerts(UUID, UUID, NUMERIC, INTEGER, INTEGER, INTEGER) FROM PUBLIC;


-- =====================================================
-- 3. get_dashboard_priority_alerts — fix cu.display_name / cu.email
--    na CTE seller_risk (GROUP BY requer subquery para auth.users)
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
    LEFT JOIN has_response hr    ON hr.conversation_id = li.conversation_id
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
    SELECT
      'seller_risk'::TEXT                  AS type,
      'high'::TEXT                         AS severity,
      l.responsible_user_id::TEXT          AS entity_id,
      'seller'::TEXT                       AS entity_type,
      CONCAT('Vendedor com pendências: ',
             COALESCE(
               au.raw_user_meta_data->>'name',
               au.raw_user_meta_data->>'full_name',
               split_part(au.email::text, '@', 1),
               l.responsible_user_id::TEXT
             )) AS title,
      CONCAT(
        COUNT(DISTINCT ps.conversation_id)::TEXT,
        ' lead(s) sem resposta há +12h'
      )                                    AS description,
      COUNT(DISTINCT ps.conversation_id)::NUMERIC AS value,
      l.responsible_user_id::TEXT          AS reference_id
    FROM   pending_sla ps
    JOIN   leads l ON l.id = ps.lead_id
    JOIN   company_users cu
             ON cu.user_id    = l.responsible_user_id
            AND cu.company_id = p_company_id
            AND cu.is_active  = true
    LEFT JOIN auth.users au ON au.id = l.responsible_user_id
    WHERE  ps.hours_waiting > 12
      AND  p_user_id IS NULL
    GROUP BY l.responsible_user_id, au.raw_user_meta_data, au.email
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
-- 4. get_dashboard_funnel_executive — fix fs.is_active
--    funnel_stages tem is_hidden (bool), não is_active.
--    is_hidden = false equivale ao filtro desejado.
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
