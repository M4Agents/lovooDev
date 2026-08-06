-- =====================================================================
-- MIGRATION: RPC get_agent_report
-- Data: 2026-08-06
--
-- Propósito:
--   Retorna métricas consolidadas do Agente de IA para o relatório de
--   atendimento. Execução exclusiva via SECURITY DEFINER — nunca expõe
--   dados de outras empresas.
--
-- Autorização (verificada internamente):
--   Trilha 1: membro ativo com role manager | admin | system_admin | super_admin
--   Trilha 2: super_admin | system_admin da empresa parent (via auth_user_is_parent_admin)
--   partner e seller: acesso negado.
--
-- Fontes de dados (canonicais):
--   Sessões     → agent_conversation_sessions (filtro: started_at)
--   Créditos    → ai_usage_daily (feature_type = 'whatsapp', filtro: date)
--   Follow-ups  → agent_contact_schedules (status = 'sent', filtro: processed_at)
--   Handoffs    → agent_handoff_events (handoff_type = 'ai_to_human', filtro: occurred_at)
--   Assignments → company_agent_assignments (display_name, is_active)
--   Timezone    → companies.timezone (com fallback para 'America/Sao_Paulo')
--
-- Convenção de período:
--   >= p_date_from AND <= p_date_to  (consistente com o restante do projeto)
--
-- Cardinalidade:
--   Todas as agregações multi-para-um são feitas via CTEs separadas
--   antes de qualquer JOIN — nunca JOIN direto entre sessão e múltiplos logs.
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
  v_total_sessions        BIGINT  := 0;
  v_completed_sessions    BIGINT  := 0;
  v_total_messages_sent   BIGINT  := 0;
  v_total_followups       BIGINT  := 0;
  v_total_credits         BIGINT  := 0;
  v_human_handoffs        BIGINT  := 0;

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

  -- ── 2. Autorização (Trilha 1) ────────────────────────────────────────────────
  SELECT cu.role INTO v_role
  FROM public.company_users cu
  WHERE cu.user_id    = v_uid
    AND cu.company_id = p_company_id
    AND cu.is_active  = true
  LIMIT 1;

  IF v_role IS NOT NULL AND v_role IN ('manager', 'admin', 'system_admin', 'super_admin') THEN
    -- acesso concedido via Trilha 1
    NULL;
  ELSIF public.auth_user_is_parent_admin(p_company_id) THEN
    -- acesso concedido via Trilha 2
    NULL;
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

  -- ── 4. Calcular métricas (CTEs) ──────────────────────────────────────────────
  --
  -- Estratégia anti-inflate:
  --   period_sessions  — sessões do período (base de tudo)
  --   period_handoffs  — 1 linha por session_id único com handoff ai_to_human
  --   period_followups — follow-ups sent no período (não ligados à sessão)
  --   period_credits   — créditos de ai_usage_daily (agregados por data)
  --   agg_by_assign    — métricas por assignment (sem cross-join entre CTEs)
  --   daily_agg        — sessões e handoffs por data local
  --   hourly_agg       — sessões por hora local
  --
  -- Nenhum JOIN direto entre sessões e ai_agent_execution_logs (inflate).
  -- Créditos por assignment vêm de ai_agent_execution_logs agregados via CTE.

  -- ── KPIs ─────────────────────────────────────────────────────────────────────

  WITH period_sessions AS (
    SELECT
      s.id              AS session_id,
      s.assignment_id,
      s.status,
      s.messages_sent,
      s.started_at
    FROM public.agent_conversation_sessions s
    WHERE s.company_id  = p_company_id
      AND s.started_at >= p_date_from
      AND s.started_at <= p_date_to
  ),
  period_handoffs AS (
    -- Uma sessão conta no máximo 1 vez como handoff
    SELECT DISTINCT h.session_id
    FROM public.agent_handoff_events h
    INNER JOIN period_sessions ps ON ps.session_id = h.session_id
    WHERE h.company_id    = p_company_id
      AND h.handoff_type  = 'ai_to_human'
      AND h.occurred_at  >= p_date_from
      AND h.occurred_at  <= p_date_to
  )
  SELECT
    COUNT(ps.session_id),
    COUNT(ps.session_id) FILTER (WHERE ps.status = 'completed'),
    COALESCE(SUM(ps.messages_sent), 0),
    COUNT(ph.session_id)
  INTO
    v_total_sessions,
    v_completed_sessions,
    v_total_messages_sent,
    v_human_handoffs
  FROM period_sessions ps
  LEFT JOIN period_handoffs ph ON ph.session_id = ps.session_id;

  -- Follow-ups: agent_contact_schedules.processed_at (quando foi efetivamente enviado)
  SELECT COALESCE(COUNT(*), 0)
  INTO v_total_followups
  FROM public.agent_contact_schedules acs
  WHERE acs.company_id   = p_company_id
    AND acs.status       = 'sent'
    AND acs.processed_at >= p_date_from
    AND acs.processed_at <= p_date_to;

  -- Créditos: ai_usage_daily, feature_type = 'whatsapp', filtro por date
  -- ai_usage_daily.date é DATE — comparamos com a data local no timezone da empresa
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
      jsonb_build_object(
        'hour',          h.hour,
        'session_count', h.cnt
      )
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
        COUNT(*)                                      AS sessions
      FROM public.agent_conversation_sessions s
      WHERE s.company_id  = p_company_id
        AND s.started_at >= p_date_from
        AND s.started_at <= p_date_to
      GROUP BY 1
    ),
    daily_handoffs AS (
      -- Agrupa por data local do occurred_at, COUNT DISTINCT session_id por dia
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
        aud.date   AS day_date,
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
    LEFT JOIN daily_credits dc ON dc.day_date = ds.day_date
    LEFT JOIN daily_handoffs dh ON dh.day_date = ds.day_date
  ) d;

  -- ── Assignment breakdown ──────────────────────────────────────────────────────
  -- Créditos por assignment: agregar execution_logs por assignment_id (CTE separada)
  -- para evitar inflate via JOIN com sessões.

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'assignment_id',       ab.assignment_id,
        'display_name',        ab.display_name,
        'is_active',           ab.is_active,
        'session_count',       ab.session_count,
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
        s.id         AS session_id,
        s.messages_sent
      FROM public.agent_conversation_sessions s
      WHERE s.company_id  = p_company_id
        AND s.started_at >= p_date_from
        AND s.started_at <= p_date_to
    ),
    assign_handoffs AS (
      -- COUNT DISTINCT session_id por assignment
      SELECT DISTINCT
        ps.assignment_id,
        h.session_id
      FROM public.agent_handoff_events h
      INNER JOIN assign_sessions ps ON ps.session_id = h.session_id
      WHERE h.company_id   = p_company_id
        AND h.handoff_type = 'ai_to_human'
        AND h.occurred_at >= p_date_from
        AND h.occurred_at <= p_date_to
    ),
    assign_credits AS (
      -- Créditos por assignment via execution_logs (separado das sessões)
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
        COUNT(a.session_id)                     AS session_count,
        COALESCE(AVG(a.messages_sent), 0)       AS avg_messages_raw,
        COUNT(ah.session_id)                    AS human_handoffs
      FROM assign_sessions a
      LEFT JOIN assign_handoffs ah
        ON ah.assignment_id = a.assignment_id
       AND ah.session_id    = a.session_id
      GROUP BY a.assignment_id
    )
    SELECT
      agg.assignment_id,
      COALESCE(caa.display_name, 'Assignment desconhecido') AS display_name,
      COALESCE(caa.is_active, false)                        AS is_active,
      agg.session_count,
      ROUND(agg.avg_messages_raw::NUMERIC, 1)               AS avg_messages,
      COALESCE(ac.total_credits, 0)                         AS total_credits,
      agg.human_handoffs,
      CASE
        WHEN agg.session_count = 0 THEN 0
        ELSE ROUND((agg.human_handoffs::NUMERIC / agg.session_count) * 100, 1)
      END AS human_handoff_rate
    FROM assign_agg agg
    LEFT JOIN public.company_agent_assignments caa
      ON caa.id = agg.assignment_id
    LEFT JOIN assign_credits ac
      ON ac.assignment_id = agg.assignment_id
  ) ab;

  -- ── 5. Montar resultado ───────────────────────────────────────────────────────

  v_result := jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_sessions',       v_total_sessions,
      'completed_sessions',   v_completed_sessions,
      'completion_rate',      CASE
                                WHEN v_total_sessions = 0 THEN 0
                                ELSE ROUND((v_completed_sessions::NUMERIC / v_total_sessions) * 100, 1)
                              END,
      'avg_messages_sent',    CASE
                                WHEN v_total_sessions = 0 THEN 0
                                ELSE ROUND(v_total_messages_sent::NUMERIC / v_total_sessions, 1)
                              END,
      'total_followups_sent', v_total_followups,
      'total_credits_used',   v_total_credits,
      'avg_credits_per_session', CASE
                                   WHEN v_total_sessions = 0 THEN 0
                                   ELSE ROUND(v_total_credits::NUMERIC / v_total_sessions, 2)
                                 END,
      'human_handoffs',       v_human_handoffs,
      'human_handoff_rate',   CASE
                                WHEN v_total_sessions = 0 THEN 0
                                ELSE ROUND((v_human_handoffs::NUMERIC / v_total_sessions) * 100, 1)
                              END
    ),
    'hourly_distribution', v_hourly_distribution,
    'daily_trend',         v_daily_trend,
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
Timezone resolvido internamente via companies.timezone.';

-- Revogar acesso público e garantir execução apenas via anon/authenticated autenticado
REVOKE ALL ON FUNCTION public.get_agent_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
