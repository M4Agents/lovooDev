-- =====================================================
-- MIGRATION: Atualiza get_dashboard_priority_alerts e get_dashboard_alerts_count
--            com suporte a funnel_scope_settings
-- Data: 22/05/2026
--
-- Mudanças:
--   1. get_dashboard_priority_alerts:
--      - CTE settings lê funnel_scope_settings
--      - CTE stalled_opps: filtro EXISTS por stage via lead_id (coluna confiável, UNIQUE)
--      - JOIN defensivo: funnel_stages + sales_funnels com sf.company_id = p_company_id
--      - Usa EXISTS (não JOIN) para evitar duplicatas quando lead está em múltiplos funis
--
--   2. get_dashboard_alerts_count:
--      - Mesmo filtro EXISTS aplicado ao bloco de oportunidades paradas
--      - Garante consistência com get_dashboard_priority_alerts
--
-- Coluna usada no EXISTS: ofp.lead_id = o.lead_id
--   Motivo: lead_id é a coluna original com UNIQUE(lead_id, funnel_id), sempre populada.
--   opportunity_id foi adicionado posteriormente como nullable, sem UNIQUE constraint.
--
-- Rollback:
--   Aplicar novamente a migration 20260519400000_dashboard_rpcs_alert_settings.sql
-- =====================================================


-- =====================================================
-- 1. get_dashboard_priority_alerts (atualizada)
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

  -- Configurações da empresa (ou defaults se sem linha)
  -- LEFT JOIN garante que a query retorna uma linha mesmo sem registro
  settings AS (
    SELECT
      COALESCE(das.sla_settings,
        '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb
      ) AS sla,
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

  -- pending_sla: todas as conversas pendentes (sem filtro de limiar aqui)
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

  -- sla_alerts: unifica sla_high e sla_critical em sla_unanswered.
  sla_alerts AS (
    SELECT
      'sla_unanswered'::TEXT  AS type,
      CASE
        WHEN hours_waiting >= (SELECT (sla->>'critical_minutes')::numeric / 60.0 FROM settings)
        THEN 'critical'
        ELSE 'high'
      END                     AS severity,
      conversation_id::TEXT   AS entity_id,
      'conversation'::TEXT    AS entity_type,
      last_inbound_id::TEXT   AS last_inbound_message_id,
      CONCAT(
        CASE
          WHEN hours_waiting >= (SELECT (sla->>'critical_minutes')::numeric / 60.0 FROM settings)
          THEN 'Lead sem resposta: '
          ELSE 'Lead aguardando: '
        END,
        COALESCE(lead_name, 'sem nome')
      )                       AS title,
      CONCAT(ROUND(hours_waiting::NUMERIC, 1)::TEXT, 'h sem resposta') AS description,
      hours_waiting           AS value,
      lead_id::TEXT           AS reference_id
    FROM pending_sla
    WHERE (SELECT (sla->>'enabled')::boolean FROM settings)
      AND hours_waiting >= (SELECT (sla->>'min_minutes')::numeric / 60.0 FROM settings)
    ORDER BY hours_waiting DESC
    LIMIT (SELECT (sla->>'limit')::integer FROM settings)
  ),

  -- stalled_opps: oportunidades paradas com filtro opcional por etapa de funil.
  -- Usa EXISTS (não JOIN) para evitar duplicatas quando o lead está em múltiplos funis.
  -- JOIN defensivo: sales_funnels com sf.company_id = p_company_id garante isolamento multi-tenant.
  -- Coluna de join: ofp.lead_id = o.lead_id (original, UNIQUE, sempre populada).
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
      -- Filtro por escopo de funil/etapa:
      --   mode=all: nenhum filtro adicional (comportamento padrão)
      --   mode=custom: apenas oportunidades cujo lead está em uma das etapas configuradas
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

  -- seller_risk: vendedores com muitos leads parados.
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
    FROM sla_alerts
    UNION ALL
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


-- =====================================================
-- 2. get_dashboard_alerts_count (atualizada)
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
  v_sla_count     INT  := 0;
  v_stalled_count INT  := 0;
  v_sla           JSONB;
  v_stalled       JSONB;
  v_funnel_scope  JSONB;
BEGIN

  -- Carrega configurações da empresa uma vez.
  SELECT
    COALESCE(das.sla_settings,
      '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb),
    COALESCE(das.stalled_settings,
      '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb),
    COALESCE(das.funnel_scope_settings,
      '{"mode":"all"}'::jsonb)
  INTO v_sla, v_stalled, v_funnel_scope
  FROM dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  -- Garante defaults se a empresa não tem linha alguma
  IF v_sla IS NULL THEN
    v_sla := '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb;
  END IF;
  IF v_stalled IS NULL THEN
    v_stalled := '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb;
  END IF;
  IF v_funnel_scope IS NULL THEN
    v_funnel_scope := '{"mode":"all"}'::jsonb;
  END IF;

  -- SLA: só conta se o alerta estiver habilitado
  IF (v_sla->>'enabled')::boolean THEN
    WITH
    last_inbound AS (
      SELECT DISTINCT ON (cm.conversation_id)
        cm.conversation_id,
        cm.id           AS last_inbound_id,
        cm.created_at   AS last_in_at
      FROM    chat_messages cm
      JOIN    chat_conversations cc ON cc.id = cm.conversation_id
      JOIN    leads l               ON l.id  = cc.lead_id
      WHERE   cm.direction  = 'inbound'
        AND   cc.company_id = p_company_id
        AND   l.company_id  = p_company_id
        AND   l.deleted_at  IS NULL
        AND   (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      ORDER BY cm.conversation_id, cm.created_at DESC
    ),
    dismissed_sla AS (
      SELECT dad.last_inbound_message_id
      FROM   dashboard_alert_dismissals dad
      JOIN   companies c ON c.id = dad.company_id
      WHERE  dad.company_id  = p_company_id
        AND  dad.entity_type = 'conversation'
        AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
    )
    SELECT COUNT(DISTINCT li.conversation_id)
    INTO   v_sla_count
    FROM   last_inbound li
    WHERE  NOT EXISTS (
      SELECT 1
      FROM   chat_messages cm2
      WHERE  cm2.conversation_id = li.conversation_id
        AND  cm2.direction       = 'outbound'
        AND  cm2.is_ai_generated = false
        AND  cm2.created_at      > li.last_in_at
    )
    AND    EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0
           >= (v_sla->>'min_minutes')::numeric / 60.0
    AND    NOT EXISTS (
      SELECT 1 FROM dismissed_sla ds
      WHERE ds.last_inbound_message_id = li.last_inbound_id
    );
  END IF;

  -- Oportunidades paradas: só conta se o alerta estiver habilitado
  -- Inclui o mesmo filtro por escopo de funil/etapa de get_dashboard_priority_alerts
  IF (v_stalled->>'enabled')::boolean THEN
    WITH
    dismissed_opps AS (
      SELECT dad.entity_id
      FROM   dashboard_alert_dismissals dad
      JOIN   companies c ON c.id = dad.company_id
      WHERE  dad.company_id  = p_company_id
        AND  dad.entity_type = 'opportunity'
        AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
    )
    SELECT COUNT(*)
    INTO   v_stalled_count
    FROM   opportunities o
    JOIN   leads l ON l.id = o.lead_id
    WHERE  o.company_id  = p_company_id
      AND  o.status      = 'open'
      AND  o.probability >= (v_stalled->>'min_probability')::integer
      AND  l.deleted_at  IS NULL
      AND  (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      AND  (
             o.last_interaction_at IS NULL
          OR o.last_interaction_at < NOW()
             - make_interval(mins => (v_stalled->>'idle_minutes')::integer)
           )
      AND  NOT EXISTS (
        SELECT 1 FROM dismissed_opps do_
        WHERE do_.entity_id = o.id
      )
      -- Mesmo filtro de escopo de funnel_scope_settings
      AND (
        v_funnel_scope->>'mode' = 'all'
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
                       v_funnel_scope->'stage_ids'
                     )::uuid
                   )
                 )
        )
      );
  END IF;

  RETURN v_sla_count + v_stalled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_alerts_count(UUID, UUID) TO authenticated;
