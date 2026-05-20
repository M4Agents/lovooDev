-- =====================================================
-- MIGRATION: get_dashboard_trends v2
-- Data: 20/05/2026
--
-- Correções aplicadas:
--   1. Novo parâmetro p_timezone (validado internamente)
--   2. Agrupamento diário por dia do inbound (first_in_at),
--      não pelo dia da resposta humana
--   3. LEFT JOIN para incluir conversas sem resposta humana
--   4. sum_response_minutes por dia (para média ponderada no frontend)
--   5. total_unanswered no retorno (escalar para o período todo)
--
-- Semântica de datas:
--   attendance_by_day.date = dia do INBOUND no timezone da empresa
--   Inbound define entrada no funil; resposta é consequência posterior.
--   Conversas sem resposta aparecem no total_unanswered.
--
-- Segurança:
--   SECURITY DEFINER com search_path seguro.
--   Validação de permissão na camada de API (endpoint /api/dashboard/trends).
-- =====================================================

-- Remove assinatura antiga (4 parâmetros) para evitar coexistência de overload
-- que poderia causar chamadas ambíguas e bugs difíceis de rastrear.
DROP FUNCTION IF EXISTS get_dashboard_trends(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

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

  -- ── Validação do timezone ─────────────────────────────────────────────────
  -- Protege contra valores inválidos em companies.timezone.
  -- AT TIME ZONE com nome desconhecido lançaria erro de runtime.
  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_timezone
  ) THEN
    p_timezone := 'America/Sao_Paulo';
  END IF;

  -- ── 1. Novos leads agrupados por dia ─────────────────────────────────────
  -- Sem mudança de lógica: leads.created_at controla entrada no período.
  SELECT json_agg(row_to_json(d))
  INTO   v_leads_by_day
  FROM (
    SELECT
      (date_trunc('day', l.created_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*)::INT                                                    AS count
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
    ORDER BY 1 ASC
  ) d;

  -- ── 2. Atendimentos: agrupados por dia do inbound ────────────────────────
  --
  -- Semântica definida:
  --   attendance_by_day.date = dia do primeiro inbound (first_in_at)
  --   Inbound define entrada no funil; resposta é evento posterior.
  --   LEFT JOIN garante que inbounds sem resposta humana continuem visíveis.
  --
  -- Filtro de período: first_in_at (inbound) dentro de [p_start_date, p_end_date].
  -- first_out_at NÃO é usado para decidir inclusão no período.

  WITH first_inbound AS (
    -- Primeiro inbound por conversa dentro do período
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM chat_messages cm
    WHERE cm.company_id  = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= p_start_date
      AND cm.created_at <= p_end_date
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  first_human_response AS (
    -- Primeira resposta humana outbound APÓS o inbound da mesma conversa
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      cm.created_at AS first_out_at,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS response_minutes
    FROM first_inbound fi
    JOIN chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),
  filtered AS (
    -- LEFT JOIN: inclui TODOS os inbounds (respondidos e não respondidos).
    -- fhr.first_out_at IS NULL → conversa ainda sem resposta humana.
    SELECT
      fi.first_in_at,
      fhr.first_out_at,
      fhr.response_minutes
    FROM first_inbound fi
    LEFT JOIN first_human_response fhr ON fhr.conversation_id = fi.conversation_id
    JOIN chat_conversations cc ON cc.id = fi.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  )
  -- Subquery `d` agrupa por dia do inbound.
  -- `unanswered` per dia é somado externamente para obter o total do período.
  -- `first_out_at` só existe no CTE `filtered`; não está em `d`,
  --  por isso COUNT FILTER é feito dentro do GROUP BY e somado fora.
  SELECT
    json_agg(
      json_build_object(
        'date',                 d.date,
        'attended',             d.attended,
        'avg_response_minutes', d.avg_response_minutes,
        'sum_response_minutes', d.sum_response_minutes
      )
      ORDER BY d.date ASC
    ),
    SUM(d.unanswered)
  INTO
    v_attendance_by_day,
    v_total_unanswered
  FROM (
    SELECT
      (date_trunc('day', first_in_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*) FILTER (WHERE first_out_at IS NOT NULL)::INT           AS attended,
      ROUND(
        AVG(response_minutes) FILTER (WHERE response_minutes IS NOT NULL)::NUMERIC,
        1
      )                                                               AS avg_response_minutes,
      COALESCE(
        SUM(response_minutes) FILTER (WHERE response_minutes IS NOT NULL),
        0
      )::NUMERIC                                                      AS sum_response_minutes,
      COUNT(*) FILTER (WHERE first_out_at IS NULL)::INT               AS unanswered
    FROM filtered
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
  'Séries diárias para o cockpit comercial (v2): novos leads por dia e atendimentos com tempo médio de primeira resposta humana. '
  'attendance_by_day.date representa o dia do inbound no timezone da empresa. '
  'total_unanswered: conversas com inbound no período sem resposta humana. '
  'Fase 1 revisada — Dashboard de Inteligência Comercial.';
