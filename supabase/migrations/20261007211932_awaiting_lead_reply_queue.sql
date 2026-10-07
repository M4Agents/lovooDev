-- =====================================================
-- Lista "Aguardando retorno do lead".
-- Conversa em que a última mensagem humana é do vendedor
-- e o lead não respondeu depois do prazo da empresa.
-- A Fila de Atendimento (get_dashboard_sla_alerts) não muda.
-- =====================================================

ALTER TABLE public.dashboard_alert_settings
  ADD COLUMN IF NOT EXISTS awaiting_lead_reply_settings JSONB NOT NULL
  DEFAULT '{"enabled":true,"min_minutes":1440,"critical_minutes":4320}'::jsonb;

ALTER TABLE public.dashboard_alert_settings
  DROP CONSTRAINT IF EXISTS chk_awaiting_lead_reply_settings;

ALTER TABLE public.dashboard_alert_settings
  ADD CONSTRAINT chk_awaiting_lead_reply_settings CHECK (
    jsonb_typeof(awaiting_lead_reply_settings) = 'object'
    AND awaiting_lead_reply_settings ? 'enabled'
    AND awaiting_lead_reply_settings ? 'min_minutes'
    AND awaiting_lead_reply_settings ? 'critical_minutes'
  );

ALTER TABLE public.dashboard_alert_dismissals
  DROP CONSTRAINT IF EXISTS dashboard_alert_dismissals_alert_kind_check;

ALTER TABLE public.dashboard_alert_dismissals
  ADD CONSTRAINT dashboard_alert_dismissals_alert_kind_check
  CHECK (alert_kind IN ('sla_unanswered', 'stalled_opportunity', 'awaiting_lead_reply'));

ALTER TABLE public.dashboard_alert_dismissals
  DROP CONSTRAINT IF EXISTS chk_kind_message;

ALTER TABLE public.dashboard_alert_dismissals
  ADD CONSTRAINT chk_kind_message CHECK (
    (alert_kind = 'sla_unanswered'       AND last_inbound_message_id IS NOT NULL)
    OR (alert_kind = 'stalled_opportunity' AND last_inbound_message_id IS NULL)
    OR (alert_kind = 'awaiting_lead_reply' AND last_inbound_message_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION get_dashboard_awaiting_lead_reply(
  p_company_id    UUID,
  p_user_id       UUID     DEFAULT NULL,
  p_min_hours     NUMERIC  DEFAULT NULL,
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
  v_items        JSON;
  v_total        BIGINT := 0;
  v_settings     JSONB;
  v_enabled      BOOLEAN;
  v_threshold    NUMERIC;
BEGIN
  SELECT COALESCE(
    das.awaiting_lead_reply_settings,
    '{"enabled":true,"min_minutes":1440,"critical_minutes":4320}'::jsonb
  )
  INTO v_settings
  FROM dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  IF v_settings IS NULL THEN
    v_settings := '{"enabled":true,"min_minutes":1440,"critical_minutes":4320}'::jsonb;
  END IF;

  v_enabled := COALESCE((v_settings->>'enabled')::boolean, true);
  v_threshold := COALESCE(
    p_min_hours,
    (v_settings->>'min_minutes')::numeric / 60.0,
    24.0
  );

  IF NOT v_enabled THEN
    RETURN json_build_object('items', '[]'::JSON, 'total', 0);
  END IF;

  WITH last_human_out AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.id         AS last_out_id,
      cm.created_at AS last_out_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at >= NOW() - make_interval(hours => p_max_age_hours)
    ORDER BY cm.conversation_id, cm.created_at DESC
  ),
  lead_replied AS (
    SELECT DISTINCT lo.conversation_id
    FROM last_human_out lo
    JOIN chat_messages cm
      ON cm.conversation_id = lo.conversation_id
     AND cm.company_id = p_company_id
     AND cm.direction = 'inbound'
     AND cm.created_at > lo.last_out_at
  ),
  dismissed AS (
    SELECT dad.last_inbound_message_id
    FROM dashboard_alert_dismissals dad
    JOIN companies c ON c.id = dad.company_id
    WHERE dad.company_id = p_company_id
      AND dad.entity_type = 'conversation'
      AND dad.alert_kind = 'awaiting_lead_reply'
      AND (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),
  pending AS (
    SELECT
      lo.conversation_id,
      lo.last_out_id,
      lo.last_out_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - lo.last_out_at)) / 3600.0, 1) AS hours_waiting
    FROM last_human_out lo
    LEFT JOIN lead_replied lr ON lr.conversation_id = lo.conversation_id
    WHERE lr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - lo.last_out_at)) / 3600.0 >= v_threshold
      AND NOT EXISTS (
        SELECT 1 FROM dismissed d
        WHERE d.last_inbound_message_id = lo.last_out_id
      )
  )
  SELECT COUNT(DISTINCT p.conversation_id)
  INTO v_total
  FROM pending p
  JOIN chat_conversations cc ON cc.id = p.conversation_id
  JOIN leads l ON l.id = cc.lead_id
  WHERE cc.lead_id IS NOT NULL
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL
    AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id);

  WITH last_human_out AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.id         AS last_out_id,
      cm.created_at AS last_out_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at >= NOW() - make_interval(hours => p_max_age_hours)
    ORDER BY cm.conversation_id, cm.created_at DESC
  ),
  lead_replied AS (
    SELECT DISTINCT lo.conversation_id
    FROM last_human_out lo
    JOIN chat_messages cm
      ON cm.conversation_id = lo.conversation_id
     AND cm.company_id = p_company_id
     AND cm.direction = 'inbound'
     AND cm.created_at > lo.last_out_at
  ),
  dismissed AS (
    SELECT dad.last_inbound_message_id
    FROM dashboard_alert_dismissals dad
    JOIN companies c ON c.id = dad.company_id
    WHERE dad.company_id = p_company_id
      AND dad.entity_type = 'conversation'
      AND dad.alert_kind = 'awaiting_lead_reply'
      AND (c.alert_dismissal_scope = 'company' OR dad.dismissed_by = auth.uid())
  ),
  pending AS (
    SELECT
      lo.conversation_id,
      lo.last_out_id,
      lo.last_out_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - lo.last_out_at)) / 3600.0, 1) AS hours_waiting
    FROM last_human_out lo
    LEFT JOIN lead_replied lr ON lr.conversation_id = lo.conversation_id
    WHERE lr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - lo.last_out_at)) / 3600.0 >= v_threshold
      AND NOT EXISTS (
        SELECT 1 FROM dismissed d
        WHERE d.last_inbound_message_id = lo.last_out_id
      )
  )
  SELECT json_agg(row_to_json(t))
  INTO v_items
  FROM (
    SELECT
      p.conversation_id::TEXT AS conversation_id,
      l.id::TEXT              AS lead_id,
      p.last_out_id::TEXT     AS last_outbound_message_id,
      COALESCE(l.name, 'Lead sem nome') AS lead_name,
      l.responsible_user_id::TEXT AS responsible_user_id,
      COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'full_name',
        split_part(au.email::text, '@', 1)
      ) AS seller_name,
      p.last_out_at,
      p.hours_waiting,
      CASE
        WHEN p.hours_waiting > 48 THEN 'critical'
        WHEN p.hours_waiting > 24 THEN 'high'
        WHEN p.hours_waiting > 12 THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM pending p
    JOIN chat_conversations cc ON cc.id = p.conversation_id
    JOIN leads l ON l.id = cc.lead_id
    LEFT JOIN auth.users au ON au.id = l.responsible_user_id
    WHERE cc.lead_id IS NOT NULL
      AND l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    ORDER BY p.last_out_at ASC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'items', COALESCE(v_items, '[]'::JSON),
    'total', v_total
  );
END;
$$;

-- Chamada somente via service_role (API backend).
-- REVOKE FROM PUBLIC não remove o grant padrão do Supabase para anon/authenticated.
REVOKE EXECUTE ON FUNCTION get_dashboard_awaiting_lead_reply(UUID, UUID, NUMERIC, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_awaiting_lead_reply(UUID, UUID, NUMERIC, INTEGER, INTEGER, INTEGER) TO service_role;
