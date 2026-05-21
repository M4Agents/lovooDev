-- =====================================================
-- MIGRATION: get_dashboard_trends v4
-- Data: 21/05/2026
--
-- Mudanças:
--   1. leads_by_day → agora conta APENAS leads de importação
--      (origin = 'file_import') para o gráfico "Novos Leads".
--
--   2. attendance_by_day → fonte migrada de chat_messages para
--      leads.created_at filtrado por origin IN ('whatsapp',
--      'webhook_ultra_simples'), capturando todos os leads que
--      chegaram via WhatsApp ou webhook externo, mesmo que nunca
--      tenham enviado uma mensagem.
--
--   3. "attended" agora significa: lead teve ao menos um outbound
--      humano (is_ai_generated = false) em qualquer de suas
--      conversas após leads.created_at.
--
--   4. avg/sum_response_minutes calculados a partir de leads.created_at
--      até o primeiro outbound humano do lead.
--
-- O que NÃO muda:
--   - assinatura da função (mesmos parâmetros e retorno)
--   - nomes dos campos retornados (retrocompatível com frontend)
--   - segurança: SECURITY DEFINER, search_path, REVOKE
--
-- Prospecção (origin outbound-first) não entra neste gráfico
-- — permanece exclusivamente na aba "Ativação Comercial".
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_trends(
  p_company_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date   TIMESTAMPTZ,
  p_user_id    UUID DEFAULT NULL,
  p_timezone   TEXT DEFAULT 'America/Sao_Paulo'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leads_by_day      JSON;
  v_attendance_by_day JSON;
  v_total_unanswered  BIGINT;
BEGIN

  -- ── Validação do timezone ──────────────────────────────────────────────────
  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_timezone
  ) THEN
    p_timezone := 'America/Sao_Paulo';
  END IF;

  -- ── 1. Novos leads de importação agrupados por dia ─────────────────────────
  --
  -- Fonte: leads.created_at WHERE origin = 'file_import'
  -- Representa leads inseridos manualmente via planilha/CSV.
  -- Não inclui WhatsApp, webhook ou prospecção ativa.
  SELECT json_agg(row_to_json(d))
  INTO   v_leads_by_day
  FROM (
    SELECT
      (date_trunc('day', l.created_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*)::INT                                                    AS count
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.origin      = 'file_import'
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
    ORDER BY 1 ASC
  ) d;

  -- ── 2. Inbound por Dia — leads de WhatsApp + webhook ──────────────────────
  --
  -- Fonte: leads.created_at WHERE origin IN ('whatsapp', 'webhook_ultra_simples')
  -- Captura todos os leads que chegaram via canais externos independente de
  -- terem enviado mensagem (resolve o gap de webhook leads sem chat_messages).
  --
  -- "attended" = lead teve ao menos um outbound humano após leads.created_at.
  -- avg/sum_response_minutes = de leads.created_at até primeiro outbound humano.
  --
  -- Prospecção (conversa outbound-first) não entra: os leads aqui existem por
  -- iniciativa do cliente (whatsapp) ou integração externa (webhook), não por
  -- ação ativa da empresa.
  WITH inbound_leads AS (
    SELECT
      l.id          AS lead_id,
      l.created_at  AS lead_at
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.origin      IN ('whatsapp', 'webhook_ultra_simples')
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  ),
  first_human_response AS (
    -- Primeiro outbound humano por lead em qualquer de suas conversas,
    -- ocorrido APÓS leads.created_at.
    SELECT DISTINCT ON (il.lead_id)
      il.lead_id,
      il.lead_at,
      cm.created_at                                                       AS first_response_at,
      EXTRACT(EPOCH FROM (cm.created_at - il.lead_at)) / 60.0            AS response_minutes
    FROM inbound_leads il
    JOIN chat_conversations cc
      ON  cc.lead_id    = il.lead_id
      AND cc.company_id = p_company_id
    JOIN chat_messages cm
      ON  cm.conversation_id = cc.id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > il.lead_at
    ORDER BY il.lead_id, cm.created_at ASC
  ),
  inbound_with_response AS (
    -- LEFT JOIN: inclui todos os leads inbound,
    -- respondidos (first_response_at IS NOT NULL) e não respondidos.
    SELECT
      il.lead_id,
      il.lead_at,
      fhr.first_response_at,
      fhr.response_minutes
    FROM inbound_leads il
    LEFT JOIN first_human_response fhr ON fhr.lead_id = il.lead_id
  )
  SELECT
    json_agg(
      json_build_object(
        'date',                 d.date,
        'attended',             d.attended,
        'avg_response_minutes', d.avg_response_minutes,
        'sum_response_minutes', d.sum_response_minutes,
        'unanswered',           d.unanswered,
        'inbound_total',        d.attended + d.unanswered
      )
      ORDER BY d.date ASC
    ),
    SUM(d.unanswered)
  INTO
    v_attendance_by_day,
    v_total_unanswered
  FROM (
    SELECT
      (date_trunc('day', lead_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::INT  AS attended,
      ROUND(
        AVG(response_minutes) FILTER (WHERE response_minutes IS NOT NULL)::NUMERIC,
        1
      )                                                           AS avg_response_minutes,
      COALESCE(
        SUM(response_minutes) FILTER (WHERE response_minutes IS NOT NULL),
        0
      )::NUMERIC                                                  AS sum_response_minutes,
      COUNT(*) FILTER (WHERE first_response_at IS NULL)::INT      AS unanswered
    FROM inbound_with_response
    GROUP BY 1
  ) d;

  RETURN json_build_object(
    'leads_by_day',      COALESCE(v_leads_by_day,      '[]'::JSON),
    'attendance_by_day', COALESCE(v_attendance_by_day, '[]'::JSON),
    'total_unanswered',  COALESCE(v_total_unanswered,  0)
  );

END;
$$;

-- Restringe execução: apenas service_role tem acesso (via endpoint autenticado)
REVOKE EXECUTE ON FUNCTION get_dashboard_trends(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION get_dashboard_trends IS
  'Séries diárias para o cockpit comercial (v4): '
  'leads_by_day = importações via planilha/CSV (origin = file_import). '
  'attendance_by_day = leads de WhatsApp e webhook (origin IN whatsapp, webhook_ultra_simples). '
  '"attended" = lead teve outbound humano após criação. '
  'Prospecção ativa permanece exclusivamente na aba Ativação Comercial. '
  'Fase 1 v4 — Dashboard de Inteligência Comercial.';
