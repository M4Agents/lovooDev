-- =====================================================
-- MIGRATION: get_dashboard_trends — adicionar inbound_total e unanswered por dia
-- Data: 20/05/2026
--
-- Mudança ADITIVA: nenhum campo existente é removido ou alterado.
--
-- Novos campos em cada objeto de attendance_by_day[]:
--   inbound_total = attended + unanswered (total de inbounds recebidos no dia)
--   unanswered    = inbounds SEM resposta humana no dia
--
-- Motivação:
--   O frontend precisa de inbound_total por dia para exibir o funil correto:
--   "X recebidos · Y respondidos · Z sem resposta · avg Nmin"
--   Antes, unanswered só existia como escalar (total_unanswered do período),
--   sem granularidade diária.
--
-- Campos mantidos sem alteração:
--   leads_by_day, attended, avg_response_minutes, sum_response_minutes,
--   total_unanswered (escalar do período)
--
-- Rollback:
--   Recriar a função sem as duas novas chaves no json_build_object.
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

  -- ── Validação do timezone ─────────────────────────────────────────────────
  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_timezone
  ) THEN
    p_timezone := 'America/Sao_Paulo';
  END IF;

  -- ── 1. Novos leads agrupados por dia ─────────────────────────────────────
  -- Inalterado em relação à v2.
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
  -- Semântica mantida (v2):
  --   attendance_by_day.date = dia do primeiro inbound (first_in_at)
  --   LEFT JOIN garante que inbounds sem resposta humana continuem visíveis.
  --
  -- Novo nesta versão:
  --   'inbound_total' = attended + unanswered  (total recebido no dia)
  --   'unanswered'    = inbounds sem resposta humana no dia (antes só existia
  --                     como escalar total_unanswered; agora também por dia)

  WITH first_inbound AS (
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
  'Séries diárias para o cockpit comercial (v3): novos leads por dia e funil inbound com tempo médio de primeira resposta humana. '
  'attendance_by_day.date representa o dia do inbound no timezone da empresa. '
  'attendance_by_day.inbound_total = attended + unanswered (total recebido no dia). '
  'attendance_by_day.unanswered = inbounds sem resposta humana no dia. '
  'total_unanswered: escalar do período (sem resposta). '
  'Fase 1 v3 — Dashboard de Inteligência Comercial.';
