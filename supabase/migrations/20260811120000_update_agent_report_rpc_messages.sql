-- =====================================================================
-- MIGRATION: Adicionar métricas de mensagens à RPC get_agent_report
-- Data: 2026-08-11
--
-- Propósito:
--   Incluir nos KPIs do relatório do Agente de IA:
--     - total_messages_sent:     total de mensagens enviadas pelo agente no período
--     - total_messages_received: total de mensagens recebidas dos usuários no período
--     - total_messages:          soma de enviadas + recebidas
--
-- Fonte: agent_conversation_sessions.messages_sent / messages_received
--   Ambas as colunas já existem e estão 100% populadas.
--
-- Impacto:
--   - Apenas adiciona campos ao JSONB retornado — contrato existente preservado
--   - Nenhuma alteração em parâmetros, autorização ou demais seções da RPC
--
-- Dependências:
--   - 20260807120000_update_agent_report_rpc_completion.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_agent_report(
  p_company_id UUID,
  p_date_from  TIMESTAMPTZ,
  p_date_to    TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid           UUID;
  v_role          TEXT;
  v_timezone      TEXT;
  v_result        JSONB;

  -- KPIs
  v_total_sessions          BIGINT  := 0;
  v_completed_sessions      BIGINT  := 0;
  v_total_messages_sent     BIGINT  := 0;
  v_total_messages_received BIGINT  := 0;
  v_total_followups         BIGINT  := 0;
  v_total_credits           BIGINT  := 0;
  v_human_handoffs          BIGINT  := 0;

  -- Arrays
  v_hourly_distribution   JSONB   := '[]'::JSONB;
  v_daily_trend           JSONB   := '[]'::JSONB;
  v_assignment_breakdown  JSONB   := '[]'::JSONB;
BEGIN
  -- ── 1. Autenticação ──────────────────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- ── 2. Autorização (Trilha 1 + Trilha 2) ────────────────────────────────────
  SELECT cu.role INTO v_role
  FROM public.company_users cu
  WHERE cu.user_id    = v_uid
    AND cu.company_id = p_company_id
    AND cu.is_active  = true
  LIMIT 1;

  IF v_role IS NOT NULL AND v_role IN ('manager', 'admin', 'system_admin', 'super_admin') THEN
    NULL; -- acesso via Trilha 1
  ELSIF public.auth_user_is_parent_admin(p_company_id) THEN
    NULL; -- acesso via Trilha 2
  ELSE
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- ── 3. Resolver timezone da empresa ─────────────────────────────────────────
  SELECT COALESCE(NULLIF(TRIM(c.timezone), ''), 'America/Sao_Paulo')
  INTO v_timezone
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_timezone IS NULL THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;

  -- ── 4. KPIs ──────────────────────────────────────────────────────────────────
  WITH period_sessions AS (
    SELECT
      s.id                AS session_id,
      s.assignment_id,
      s.status,
      s.end_reason,
      s.messages_sent,
      s.messages_received,
      s.started_at
    FROM public.agent_conversation_sessions s
    WHERE s.company_id  = p_company_id
      AND s.started_at >= p_date_from
      AND s.started_at <= p_date_to
  ),
  period_handoffs AS (
    SELECT DISTINCT h.session_id
    FROM public.agent_handoff_events h
    INNER JOIN period_sessions ps ON ps.session_id = h.session_id
    WHERE h.company_id   = p_company_id
      AND h.handoff_type = 'ai_to_human'
      AND h.occurred_at >= p_date_from
      AND h.occurred_at <= p_date_to
  )
  SELECT
    COUNT(ps.session_id),
    COUNT(ps.session_id) FILTER (
      WHERE ps.end_reason IS NOT NULL
        AND ps.end_reason = ANY(
          COALESCE(
            (SELECT caa.completion_triggers
             FROM public.company_agent_assignments caa
             WHERE caa.id = ps.assignment_id),
            '{}'::TEXT[]
          )
        )
    ),
    COALESCE(SUM(ps.messages_sent),     0),
    COALESCE(SUM(ps.messages_received), 0),
    COUNT(ph.session_id)
  INTO
    v_total_sessions,
    v_completed_sessions,
    v_total_messages_sent,
    v_total_messages_received,
    v_human_handoffs
  FROM period_sessions ps
  LEFT JOIN period_handoffs ph ON ph.session_id = ps.session_id;

  -- Follow-ups enviados no período
  SELECT COALESCE(COUNT(*), 0)
  INTO v_total_followups
  FROM public.agent_contact_schedules acs
  WHERE acs.company_id   = p_company_id
    AND acs.status       = 'sent'
    AND acs.processed_at >= p_date_from
    AND acs.processed_at <= p_date_to;

  -- Créditos: ai_usage_daily, feature_type = 'whatsapp'
  SELECT COALESCE(SUM(aud.total_credits_used), 0)
  INTO v_total_credits
  FROM public.ai_usage_daily aud
  WHERE aud.company_id   = p_company_id
    AND aud.feature_type = 'whatsapp'
    AND aud.date        >= (p_date_from AT TIME ZONE v_timezone)::DATE
    AND aud.date        <= (p_date_to   AT TIME ZONE v_timezone)::DATE;

  -- ── Distribuição horária ──────────────────────────────────────────────────────

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('hour', h.hour, 'session_count', h.cnt)
      ORDER BY h.hour
    ),
    '[]'::JSONB
  )
  INTO v_hourly_distribution
  FROM (
    SELECT
      EXTRACT(HOUR FROM s.started_at AT TIME ZONE v_timezone)::INT AS hour,
      COUNT(*) AS cnt
    FROM public.agent_conversation_sessions s
    WHERE s.company_id  = p_company_id
      AND s.started_at >= p_date_from
      AND s.started_at <= p_date_to
    GROUP BY 1
  ) h;

  -- ── Tendência diária ──────────────────────────────────────────────────────────

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date',           d.day_date,
        'sessions',       d.sessions,
        'credits',        d.credits,
        'human_handoffs', d.handoffs
      )
      ORDER BY d.day_date
    ),
    '[]'::JSONB
  )
  INTO v_daily_trend
  FROM (
    WITH daily_sessions AS (
      SELECT
        (s.started_at AT TIME ZONE v_timezone)::DATE AS day_date,
        COUNT(*) AS sessions
      FROM public.agent_conversation_sessions s
      WHERE s.company_id  = p_company_id
        AND s.started_at >= p_date_from
        AND s.started_at <= p_date_to
      GROUP BY 1
    ),
    daily_handoffs AS (
      SELECT
        (h.occurred_at AT TIME ZONE v_timezone)::DATE AS day_date,
        COUNT(DISTINCT h.session_id)                   AS handoffs
      FROM public.agent_handoff_events h
      WHERE h.company_id   = p_company_id
        AND h.handoff_type = 'ai_to_human'
        AND h.occurred_at >= p_date_from
        AND h.occurred_at <= p_date_to
      GROUP BY 1
    ),
    daily_credits AS (
      SELECT
        aud.date AS day_date,
        SUM(aud.total_credits_used) AS credits
      FROM public.ai_usage_daily aud
      WHERE aud.company_id   = p_company_id
        AND aud.feature_type = 'whatsapp'
        AND aud.date        >= (p_date_from AT TIME ZONE v_timezone)::DATE
        AND aud.date        <= (p_date_to   AT TIME ZONE v_timezone)::DATE
      GROUP BY 1
    )
    SELECT
      ds.day_date,
      ds.sessions,
      COALESCE(dc.credits,  0) AS credits,
      COALESCE(dh.handoffs, 0) AS handoffs
    FROM daily_sessions ds
    LEFT JOIN daily_credits  dc ON dc.day_date = ds.day_date
    LEFT JOIN daily_handoffs dh ON dh.day_date = ds.day_date
  ) d;

  -- ── Assignment breakdown ──────────────────────────────────────────────────────

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'assignment_id',       ab.assignment_id,
        'display_name',        ab.display_name,
        'is_active',           ab.is_active,
        'session_count',       ab.session_count,
        'completed_sessions',  ab.completed_sessions,
        'completion_rate',     ab.completion_rate,
        'avg_messages',        ab.avg_messages,
        'total_credits',       ab.total_credits,
        'human_handoffs',      ab.human_handoffs,
        'human_handoff_rate',  ab.human_handoff_rate
      )
      ORDER BY ab.session_count DESC, ab.display_name
    ),
    '[]'::JSONB
  )
  INTO v_assignment_breakdown
  FROM (
    WITH assign_sessions AS (
      SELECT
        s.assignment_id,
        s.id            AS session_id,
        s.messages_sent,
        s.end_reason
      FROM public.agent_conversation_sessions s
      WHERE s.company_id  = p_company_id
        AND s.started_at >= p_date_from
        AND s.started_at <= p_date_to
    ),
    assign_handoffs AS (
      SELECT DISTINCT ps.assignment_id, h.session_id
      FROM public.agent_handoff_events h
      INNER JOIN assign_sessions ps ON ps.session_id = h.session_id
      WHERE h.company_id   = p_company_id
        AND h.handoff_type = 'ai_to_human'
        AND h.occurred_at >= p_date_from
        AND h.occurred_at <= p_date_to
    ),
    assign_credits AS (
      SELECT
        el.assignment_id,
        COALESCE(SUM(el.credits_used), 0) AS total_credits
      FROM public.ai_agent_execution_logs el
      WHERE el.consumer_company_id = p_company_id
        AND el.feature_type        = 'whatsapp'
        AND el.assignment_id      IS NOT NULL
        AND el.created_at         >= p_date_from
        AND el.created_at         <= p_date_to
      GROUP BY el.assignment_id
    ),
    assign_agg AS (
      SELECT
        a.assignment_id,
        COUNT(a.session_id)               AS session_count,
        COALESCE(AVG(a.messages_sent), 0) AS avg_messages_raw,
        COUNT(ah.session_id)              AS human_handoffs
      FROM assign_sessions a
      LEFT JOIN assign_handoffs ah
        ON ah.assignment_id = a.assignment_id
       AND ah.session_id    = a.session_id
      GROUP BY a.assignment_id
    ),
    assign_completed AS (
      SELECT
        a.assignment_id,
        COUNT(a.session_id) FILTER (
          WHERE a.end_reason IS NOT NULL
            AND a.end_reason = ANY(COALESCE(caa.completion_triggers, '{}'::TEXT[]))
        ) AS completed_sessions
      FROM assign_sessions a
      LEFT JOIN public.company_agent_assignments caa ON caa.id = a.assignment_id
      GROUP BY a.assignment_id
    )
    SELECT
      agg.assignment_id,
      COALESCE(caa.display_name, 'Assignment desconhecido') AS display_name,
      COALESCE(caa.is_active, false)                        AS is_active,
      agg.session_count,
      COALESCE(ac_done.completed_sessions, 0)               AS completed_sessions,
      CASE
        WHEN agg.session_count = 0 THEN 0
        ELSE ROUND((COALESCE(ac_done.completed_sessions, 0)::NUMERIC / agg.session_count) * 100, 1)
      END                                                   AS completion_rate,
      ROUND(agg.avg_messages_raw::NUMERIC, 1)               AS avg_messages,
      COALESCE(ac.total_credits, 0)                         AS total_credits,
      agg.human_handoffs,
      CASE
        WHEN agg.session_count = 0 THEN 0
        ELSE ROUND((agg.human_handoffs::NUMERIC / agg.session_count) * 100, 1)
      END                                                   AS human_handoff_rate
    FROM assign_agg agg
    LEFT JOIN public.company_agent_assignments caa     ON caa.id = agg.assignment_id
    LEFT JOIN assign_credits                   ac      ON ac.assignment_id  = agg.assignment_id
    LEFT JOIN assign_completed                 ac_done ON ac_done.assignment_id = agg.assignment_id
  ) ab;

  -- ── 5. Montar resultado ───────────────────────────────────────────────────────

  v_result := jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_sessions',          v_total_sessions,
      'completed_sessions',      v_completed_sessions,
      'completion_rate',         CASE
                                   WHEN v_total_sessions = 0 THEN 0
                                   ELSE ROUND((v_completed_sessions::NUMERIC / v_total_sessions) * 100, 1)
                                 END,
      'avg_messages_sent',       CASE
                                   WHEN v_total_sessions = 0 THEN 0
                                   ELSE ROUND(v_total_messages_sent::NUMERIC / v_total_sessions, 1)
                                 END,
      'total_followups_sent',    v_total_followups,
      'total_credits_used',      v_total_credits,
      'avg_credits_per_session', CASE
                                   WHEN v_total_sessions = 0 THEN 0
                                   ELSE ROUND(v_total_credits::NUMERIC / v_total_sessions, 2)
                                 END,
      'human_handoffs',          v_human_handoffs,
      'human_handoff_rate',      CASE
                                   WHEN v_total_sessions = 0 THEN 0
                                   ELSE ROUND((v_human_handoffs::NUMERIC / v_total_sessions) * 100, 1)
                                 END,
      'total_messages_sent',     v_total_messages_sent,
      'total_messages_received', v_total_messages_received,
      'total_messages',          v_total_messages_sent + v_total_messages_received
    ),
    'hourly_distribution',  v_hourly_distribution,
    'daily_trend',          v_daily_trend,
    'assignment_breakdown', v_assignment_breakdown
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM IN ('UNAUTHORIZED', 'FORBIDDEN') THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'get_agent_report: erro interno: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.get_agent_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
'Relatório de atendimento do Agente de IA por período.
Autorização: manager, admin, system_admin, super_admin da empresa (Trilha 1)
  ou super_admin/system_admin da empresa parent (Trilha 2).
partner e seller não possuem acesso.
Retorna JSONB com kpis, hourly_distribution, daily_trend, assignment_breakdown.
Timezone resolvido internamente via companies.timezone.
completed_sessions e completion_rate calculados via company_agent_assignments.completion_triggers.
total_messages_sent, total_messages_received e total_messages via agent_conversation_sessions.';

REVOKE ALL ON FUNCTION public.get_agent_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
