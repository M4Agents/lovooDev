-- =====================================================
-- MIGRATION: RPCs do dashboard com suporte a configurações por empresa
-- Data: 19/05/2026
--
-- Funções atualizadas:
--   1. get_dashboard_alerts_count    (era: 20260519200000_dashboard_rpcs_dismissals)
--   2. get_dashboard_sla_alerts      (era: 20260519200000_dashboard_rpcs_dismissals)
--   3. get_dashboard_priority_alerts (era: 20260519200000_dashboard_rpcs_dismissals)
--
-- Mudanças por função:
--   • get_dashboard_alerts_count:
--     - DECLARE v_sla / v_stalled carregados uma vez via SELECT INTO
--     - COALESCE: company setting → default global
--     - Guards: IF (v_sla->>'enabled')::boolean para cada bloco
--     - Limiares configuráveis: min_minutes, idle_minutes, min_probability
--
--   • get_dashboard_sla_alerts:
--     - p_sla_hours DEFAULT NULL (era DEFAULT 6)
--     - DECLARE v_sla_settings / v_sla_threshold
--     - Precedência: p_sla_hours override → company setting → default 4.0h
--     - v_sla_threshold usado em ambos os blocos WITH (passo 1 e passo 2)
--
--   • get_dashboard_priority_alerts:
--     - CTE settings como PRIMEIRO CTE do WITH (LEFT JOIN dashboard_alert_settings)
--     - sla_alerts: enabled guard + min_minutes/critical_minutes/limit configuráveis
--     - stalled_opps: enabled guard + idle_minutes/min_probability/limit configuráveis
--     - seller_risk: enabled guard + waiting_minutes/min_leads/limit configuráveis
--
-- Compatibilidade retroativa:
--   • Empresa sem linha em dashboard_alert_settings: COALESCE garante defaults globais
--   • p_sla_hours=NULL: v_sla_threshold cai para company setting ou default
--   • p_sla_hours explícito (hoje o endpoint envia 6): override tem precedência
--   • Nenhuma alteração nos endpoints de API nesta fase
--
-- Unidade interna:
--   • dashboard_alert_settings armazena MINUTOS
--   • RPCs usam horas internamente → conversão: minutes / 60.0
--   • make_interval(mins => ...) para INTERVAL dinâmico
--
-- Segurança:
--   • SECURITY DEFINER SET search_path = public preservado
--   • auth.uid() continua retornando o chamador (não o owner) — correto para dismissed_by
--
-- Rollback:
--   CREATE OR REPLACE das 3 funções com o SQL de 20260519200000_dashboard_rpcs_dismissals.sql
-- =====================================================


-- =====================================================
-- 1. get_dashboard_alerts_count
--    Retorna INT escalar: contagem de SLA + oportunidades paradas
--    Agora respeita configurações por empresa (enabled, limiares)
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
BEGIN

  -- Carrega configurações da empresa uma vez.
  -- Se não houver linha, SELECT retorna NULL e os IF abaixo usam defaults.
  SELECT
    COALESCE(das.sla_settings,
      '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb),
    COALESCE(das.stalled_settings,
      '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb)
  INTO v_sla, v_stalled
  FROM dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  -- Garante defaults se a empresa não tem linha alguma
  IF v_sla IS NULL THEN
    v_sla := '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb;
  END IF;
  IF v_stalled IS NULL THEN
    v_stalled := '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb;
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
      );
  END IF;

  RETURN v_sla_count + v_stalled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_alerts_count(UUID, UUID) TO authenticated;


-- =====================================================
-- 2. get_dashboard_sla_alerts
--    Lista paginada de leads sem resposta (SLA).
--    Novidade: p_sla_hours DEFAULT NULL → usa company setting ou default global.
--    Precedência: p_sla_hours override > company setting > default 4.0h
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_sla_alerts(
  p_company_id    UUID,
  p_user_id       UUID     DEFAULT NULL,
  p_sla_hours     NUMERIC  DEFAULT NULL,   -- NULL = usar company setting; valor explícito = override
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
  v_items         JSON;
  v_total         BIGINT  := 0;
  v_sla_settings  JSONB;
  v_sla_threshold NUMERIC;  -- em HORAS para compatibilidade com o restante da RPC
BEGIN

  -- Carrega configurações da empresa
  SELECT COALESCE(
    das.sla_settings,
    '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb
  )
  INTO v_sla_settings
  FROM dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  -- Garante defaults se a empresa não tem linha alguma
  IF v_sla_settings IS NULL THEN
    v_sla_settings := '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb;
  END IF;

  -- Precedência do limiar SLA (trabalhamos em HORAS internamente):
  --   1. p_sla_hours explícito do caller (ex.: override da API, já em horas)
  --   2. company setting (min_minutes em minutos → /60.0 → horas)
  --   3. default global: 4.0h (= 240 minutos)
  v_sla_threshold := COALESCE(
    p_sla_hours,
    (v_sla_settings->>'min_minutes')::numeric / 60.0,
    4.0
  );

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
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= v_sla_threshold
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
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= v_sla_threshold
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

-- Chamada somente via service_role (API backend) — sem GRANT para authenticated
REVOKE EXECUTE ON FUNCTION get_dashboard_sla_alerts(UUID, UUID, NUMERIC, INTEGER, INTEGER, INTEGER) FROM PUBLIC;


-- =====================================================
-- 3. get_dashboard_priority_alerts
--    Alertas prioritários em tempo real.
--    Novidade: CTE settings como primeiro CTE — lê dashboard_alert_settings
--    via LEFT JOIN para garantir fallback (empresa sem linha = defaults).
--    Todos os limiares e limites passam a ser configuráveis por empresa.
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
      ) AS seller_risk
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
  -- O limiar mínimo é aplicado em sla_alerts e seller_risk separadamente
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
  -- Limiar mínimo, limiar crítico e limite máximo agora são configuráveis.
  -- Guard de enabled: se sla->>'enabled' = false, retorna 0 linhas.
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

  -- stalled_opps: oportunidades paradas.
  -- idle_minutes, min_probability e limite agora são configuráveis.
  -- Guard de enabled: se stalled->>'enabled' = false, retorna 0 linhas.
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
    ORDER BY COALESCE(o.value, 0) DESC
    LIMIT (SELECT (stalled->>'limit')::integer FROM settings)
  ),

  -- seller_risk: vendedores com muitos leads parados.
  -- waiting_minutes, min_leads e limite agora são configuráveis.
  -- Guard de enabled: se seller_risk->>'enabled' = false, retorna 0 linhas.
  -- p_user_id IS NULL: seller_risk não faz sentido em visão filtrada por vendedor
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
