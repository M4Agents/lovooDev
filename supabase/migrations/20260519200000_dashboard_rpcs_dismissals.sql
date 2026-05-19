-- =====================================================
-- MIGRATION: RPCs do dashboard com suporte a dispensa de alertas
-- Data: 19/05/2026
--
-- Funções atualizadas:
--   1. get_dashboard_alerts_count  (era: 20260509200000)
--   2. get_dashboard_sla_alerts    (era: 20260511140000)
--   3. get_dashboard_priority_alerts (era: 20260511140000)
--
-- Mudanças por função:
--   • last_inbound: MAX/GROUP BY → DISTINCT ON para expor cm.id AS last_inbound_id
--   • Novos CTEs: dismissed_sla, dismissed_opps (consultam dashboard_alert_dismissals)
--   • Filtro NOT EXISTS nas conversas e oportunidades pendentes
--   • sla_critical + sla_high unificados em sla_unanswered (severidade = apresentação)
--   • last_inbound_message_id exposto no JSON de retorno
--
-- Segurança:
--   • SECURITY DEFINER SET search_path = public preservado
--   • auth.uid() retorna o chamador (não o owner) — correto para escopo 'user'
--
-- Rollback:
--   Criar migration com CREATE OR REPLACE das versões canônicas de:
--     get_dashboard_sla_alerts / get_dashboard_priority_alerts → 20260511140000
--     get_dashboard_alerts_count                               → 20260509200000
-- =====================================================


-- =====================================================
-- 1. get_dashboard_alerts_count
--    Retorna INT escalar: SLA >= 4h + oportunidades paradas > 14 dias
--    Exclui alertas dispensados via dashboard_alert_dismissals
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

  -- SLA: conversas com inbound sem resposta humana >= 4h, excluindo dispensadas
  WITH
  last_inbound AS (
    -- DISTINCT ON expõe cm.id necessário para filtrar dispensas por mensagem específica
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
  AND    EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= 4
  AND    NOT EXISTS (
    SELECT 1 FROM dismissed_sla ds
    WHERE ds.last_inbound_message_id = li.last_inbound_id
  );

  -- Oportunidades abertas paradas > 14 dias com probabilidade >= 60, excluindo dispensadas
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
    AND  o.probability >= 60
    AND  l.deleted_at  IS NULL
    AND  (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    AND  (
           o.last_interaction_at IS NULL
        OR o.last_interaction_at < NOW() - INTERVAL '14 days'
         )
    AND  NOT EXISTS (
      SELECT 1 FROM dismissed_opps do_
      WHERE do_.entity_id = o.id
    );

  RETURN v_sla_count + v_stalled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_alerts_count(UUID, UUID) TO authenticated;


-- =====================================================
-- 2. get_dashboard_sla_alerts
--    Lista paginada de leads sem resposta (SLA).
--    Exclui alertas dispensados via dashboard_alert_dismissals.
--    Adiciona last_inbound_message_id ao JSON de cada item.
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

  -- Passo 1: total (excluindo dispensadas)
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.id           AS last_inbound_id,
      cm.created_at   AS last_in_at
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
  dismissed_sla AS (
    SELECT dad.last_inbound_message_id
    FROM   dashboard_alert_dismissals dad
    JOIN   companies c ON c.id = dad.company_id
    WHERE  dad.company_id  = p_company_id
      AND  dad.entity_type = 'conversation'
      AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),
  pending AS (
    SELECT li.conversation_id
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
      AND NOT EXISTS (
        SELECT 1 FROM dismissed_sla ds
        WHERE ds.last_inbound_message_id = li.last_inbound_id
      )
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

  -- Passo 2: dados paginados (excluindo dispensadas)
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.id           AS last_inbound_id,
      cm.created_at   AS last_in_at
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
  dismissed_sla AS (
    SELECT dad.last_inbound_message_id
    FROM   dashboard_alert_dismissals dad
    JOIN   companies c ON c.id = dad.company_id
    WHERE  dad.company_id  = p_company_id
      AND  dad.entity_type = 'conversation'
      AND  (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),
  pending AS (
    SELECT
      li.conversation_id,
      li.last_inbound_id,
      li.last_in_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0, 1) AS hours_waiting
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
      AND NOT EXISTS (
        SELECT 1 FROM dismissed_sla ds
        WHERE ds.last_inbound_message_id = li.last_inbound_id
      )
  )
  SELECT json_agg(row_to_json(t))
  INTO   v_items
  FROM (
    SELECT
      p.conversation_id::TEXT                                  AS conversation_id,
      l.id::TEXT                                               AS lead_id,
      p.last_inbound_id::TEXT                                  AS last_inbound_message_id,
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
-- 3. get_dashboard_priority_alerts
--    Alertas prioritários em tempo real.
--    Mudanças:
--    • last_inbound: DISTINCT ON expõe last_inbound_id
--    • CTEs dismissed_sla + dismissed_opps
--    • pending_sla: NOT EXISTS dismissed_sla
--    • sla_critical + sla_high unificados em sla_unanswered
--      (tipo único; severidade calculada por hours_waiting)
--    • stalled_opps: NOT EXISTS dismissed_opps
--    • last_inbound_message_id no JSON de retorno
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
    -- DISTINCT ON expõe cm.id para filtrar dispensas por mensagem específica
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
    -- Dispensas de alertas SLA: vinculadas à mensagem específica
    -- auth.uid() funciona em SECURITY DEFINER: retorna o chamador (não o owner)
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

  -- sla_unanswered unifica sla_high e sla_critical (mesma família lógica).
  -- Evita reaparecer como sla_critical após ser dispensado como sla_high.
  -- Severidade é calculada por hours_waiting e usada apenas para apresentação.
  sla_alerts AS (
    SELECT
      'sla_unanswered'::TEXT  AS type,
      CASE WHEN hours_waiting >= 24 THEN 'critical' ELSE 'high' END AS severity,
      conversation_id::TEXT   AS entity_id,
      'conversation'::TEXT    AS entity_type,
      last_inbound_id::TEXT   AS last_inbound_message_id,
      CONCAT(
        CASE WHEN hours_waiting >= 24
             THEN 'Lead sem resposta: '
             ELSE 'Lead aguardando: '
        END,
        COALESCE(lead_name, 'sem nome')
      )                       AS title,
      CONCAT(ROUND(hours_waiting::NUMERIC, 1)::TEXT, 'h sem resposta') AS description,
      hours_waiting           AS value,
      lead_id::TEXT           AS reference_id
    FROM pending_sla
    WHERE hours_waiting >= 4
    ORDER BY hours_waiting DESC
    LIMIT 10
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
    WHERE o.company_id   = p_company_id
      AND o.status       = 'open'
      AND o.probability  >= 60
      AND l.deleted_at   IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      AND (
            o.last_interaction_at IS NULL
         OR o.last_interaction_at < NOW() - INTERVAL '14 days'
          )
      AND NOT EXISTS (
        SELECT 1 FROM dismissed_opps do_
        WHERE do_.entity_id = o.id
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
