-- =====================================================
-- Alertas prioritários deixam de listar lead sem resposta.
-- Esse lead fica só na Fila de Atendimento (get_dashboard_sla_alerts).
-- Oportunidade parada e risco de vendedor permanecem.
-- O resumo por vendedor continua calculado a partir dos leads
-- sem resposta humana; só não são mais repetidos como linhas de SLA.
--
-- get_dashboard_alerts_count não muda: o card do dashboard
-- passa a usar o total da fila, não esta contagem.
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
  WITH

  settings AS (
    SELECT
      COALESCE(das.stalled_settings,
        '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb
      ) AS stalled,
      COALESCE(das.seller_risk_settings,
        '{"enabled":true,"waiting_minutes":720,"min_leads":3,"limit":3}'::jsonb
      ) AS seller_risk,
      COALESCE(das.funnel_scope_settings,
        '{"mode":"all"}'::jsonb
      ) AS funnel_scope
    FROM (SELECT p_company_id AS company_id) AS _ref
    LEFT JOIN dashboard_alert_settings das USING (company_id)
  ),

  last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.id           AS last_inbound_id,
      cm.created_at   AS last_in_at
    FROM   chat_messages cm
    JOIN   chat_conversations cc ON cc.id = cm.conversation_id
    JOIN   leads l               ON l.id  = cc.lead_id
    WHERE  cm.direction   = 'inbound'
      AND  cc.company_id  = p_company_id
      AND  l.company_id   = p_company_id
      AND  l.deleted_at   IS NULL
      AND  (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    ORDER BY cm.conversation_id, cm.created_at DESC
  ),

  has_response AS (
    SELECT DISTINCT cm.conversation_id
    FROM   chat_messages cm
    JOIN   last_inbound li ON li.conversation_id = cm.conversation_id
    WHERE  cm.direction       = 'outbound'
      AND  cm.is_ai_generated = false
      AND  cm.created_at      > li.last_in_at
  ),

  dismissed_sla AS (
    SELECT dad.last_inbound_message_id
    FROM   dashboard_alert_dismissals dad
    JOIN   companies c ON c.id = dad.company_id
    WHERE  dad.company_id  = p_company_id
      AND  dad.entity_type = 'conversation'
      AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),

  dismissed_opps AS (
    SELECT dad.entity_id
    FROM   dashboard_alert_dismissals dad
    JOIN   companies c ON c.id = dad.company_id
    WHERE  dad.company_id  = p_company_id
      AND  dad.entity_type = 'opportunity'
      AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),

  -- Base do resumo por vendedor. Não vira linha de lead na lista.
  pending_sla AS (
    SELECT
      li.conversation_id,
      li.last_inbound_id,
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
      AND  NOT EXISTS (
        SELECT 1 FROM dismissed_sla ds
        WHERE ds.last_inbound_message_id = li.last_inbound_id
      )
  ),

  stalled_opps AS (
    SELECT
      'stalled_opportunity'::TEXT AS type,
      'high'::TEXT                AS severity,
      o.id::TEXT                  AS entity_id,
      'opportunity'::TEXT         AS entity_type,
      NULL::TEXT                  AS last_inbound_message_id,
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
    WHERE o.company_id  = p_company_id
      AND o.status      = 'open'
      AND (SELECT (stalled->>'enabled')::boolean FROM settings)
      AND o.probability >= (SELECT (stalled->>'min_probability')::integer FROM settings)
      AND l.deleted_at  IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      AND (
            o.last_interaction_at IS NULL
         OR o.last_interaction_at < NOW()
            - make_interval(mins => (SELECT (stalled->>'idle_minutes')::integer FROM settings))
          )
      AND NOT EXISTS (
        SELECT 1 FROM dismissed_opps do_
        WHERE do_.entity_id = o.id
      )
      AND (
        (SELECT funnel_scope->>'mode' FROM settings) = 'all'
        OR EXISTS (
          SELECT 1
          FROM   opportunity_funnel_positions ofp
          JOIN   funnel_stages fs ON fs.id = ofp.stage_id
          JOIN   sales_funnels sf
                   ON sf.id = fs.funnel_id
                  AND sf.company_id = p_company_id
          WHERE  ofp.lead_id = o.lead_id
            AND  ofp.stage_id = ANY(
                   ARRAY(
                     SELECT jsonb_array_elements_text(
                       (SELECT funnel_scope->'stage_ids' FROM settings)
                     )::uuid
                   )
                 )
        )
      )
    ORDER BY COALESCE(o.value, 0) DESC
    LIMIT (SELECT (stalled->>'limit')::integer FROM settings)
  ),

  seller_risk AS (
    SELECT
      'seller_risk'::TEXT                  AS type,
      'high'::TEXT                         AS severity,
      l.responsible_user_id::TEXT          AS entity_id,
      'seller'::TEXT                       AS entity_type,
      NULL::TEXT                           AS last_inbound_message_id,
      CONCAT('Vendedor com pendências: ',
             COALESCE(
               au.raw_user_meta_data->>'name',
               au.raw_user_meta_data->>'full_name',
               split_part(au.email::text, '@', 1),
               l.responsible_user_id::TEXT
             ))                            AS title,
      CONCAT(
        COUNT(DISTINCT ps.conversation_id)::TEXT,
        ' lead(s) sem resposta há +'
        || ROUND((SELECT (seller_risk->>'waiting_minutes')::numeric / 60.0 FROM settings), 0)::TEXT
        || 'h'
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
    WHERE  (SELECT (seller_risk->>'enabled')::boolean FROM settings)
      AND  ps.hours_waiting >= (SELECT (seller_risk->>'waiting_minutes')::numeric / 60.0 FROM settings)
      AND  p_user_id IS NULL
    GROUP BY l.responsible_user_id, au.raw_user_meta_data, au.email
    HAVING COUNT(DISTINCT ps.conversation_id) >= (SELECT (seller_risk->>'min_leads')::integer FROM settings)
    ORDER BY COUNT(DISTINCT ps.conversation_id) DESC
    LIMIT (SELECT (seller_risk->>'limit')::integer FROM settings)
  ),

  all_alerts AS (
    SELECT type, severity, entity_id, entity_type, last_inbound_message_id,
           title, description, value, reference_id
    FROM stalled_opps
    UNION ALL
    SELECT type, severity, entity_id, entity_type, last_inbound_message_id,
           title, description, value, reference_id
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
