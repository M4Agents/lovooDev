-- =====================================================
-- MIGRATION: RPC get_dashboard_activation
-- Data: 20/05/2026
--
-- Objetivo:
--   Retornar métricas de ativação comercial (prospecção + resgate) para
--   a nova aba "Ativação Comercial" do dashboard. Stack completamente
--   isolada de get_dashboard_trends — semânticas distintas.
--
-- Prospecção:
--   Conversa cuja primeira mensagem HISTÓRICA é outbound E ocorreu no
--   período. Mede geração ativa de novos relacionamentos.
--   Respondida = inbound posterior dentro de prospection_response_window_days.
--
-- Resgate:
--   Lead com outbound no período, cujo último inbound (via chat_messages)
--   anterior à tentativa era >= lead_rescue_inactivity_days atrás
--   — ou lead sem nenhum inbound histórico. Entidade: lead (deduplicado).
--   Respondido = inbound posterior dentro de rescue_response_window_days.
--
-- Filtro de vendedor (p_user_id):
--   chat_conversations.assigned_to (primário)
--   leads.responsible_user_id      (fallback quando assigned_to IS NULL)
--
-- Segurança:
--   SECURITY DEFINER com search_path seguro.
--   Validação de permissão e company_id na camada de API (/api/dashboard/activation).
--   Toda CTE filtra explicitamente por company_id.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS get_dashboard_activation(
--     UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, INTEGER, INTEGER, INTEGER
--   );
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_activation(
  p_company_id                       UUID,
  p_start_date                       TIMESTAMPTZ,
  p_end_date                         TIMESTAMPTZ,
  p_user_id                          UUID    DEFAULT NULL,
  p_timezone                         TEXT    DEFAULT 'America/Sao_Paulo',
  p_lead_rescue_inactivity_days      INTEGER DEFAULT 15,
  p_rescue_response_window_days      INTEGER DEFAULT 7,
  p_prospection_response_window_days INTEGER DEFAULT 7
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prospection_by_day          JSON;
  v_prospection_total_initiated BIGINT;
  v_prospection_total_responded BIGINT;
  v_rescue_by_day               JSON;
  v_rescue_total_initiated      BIGINT;
  v_rescue_total_responded      BIGINT;
BEGIN

  -- ── Validação do timezone ─────────────────────────────────────────────────
  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_timezone
  ) THEN
    p_timezone := 'America/Sao_Paulo';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PROSPECÇÃO
  -- Definição: conversa cuja primeira mensagem histórica é outbound
  --            E ocorreu dentro do período [p_start_date, p_end_date].
  -- Unidade: conversa (conversation_id).
  -- ═══════════════════════════════════════════════════════════════════════════
  WITH conv_first_msg AS (
    -- Candidatos: primeiro outbound por conversa no período,
    -- validando que não há mensagem anterior na conversa (toda a história).
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_at
    FROM chat_messages cm
    WHERE cm.company_id  = p_company_id
      AND cm.direction   = 'outbound'
      AND cm.created_at >= p_start_date
      AND cm.created_at <= p_end_date
      -- Garante que é a primeira mensagem de toda a história da conversa
      AND NOT EXISTS (
        SELECT 1 FROM chat_messages cm2
        WHERE cm2.company_id      = p_company_id
          AND cm2.conversation_id = cm.conversation_id
          AND cm2.created_at      < cm.created_at
        LIMIT 1
      )
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  prospection_base AS (
    -- Filtra por empresa + lead ativo + vendedor (assigned_to com fallback)
    SELECT
      cfm.conversation_id,
      cfm.first_at
    FROM conv_first_msg cfm
    JOIN chat_conversations cc ON cc.id        = cfm.conversation_id
                               AND cc.company_id = p_company_id
    JOIN leads l               ON l.id         = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (
        p_user_id IS NULL
        OR cc.assigned_to                               = p_user_id
        OR (cc.assigned_to IS NULL AND l.responsible_user_id = p_user_id)
      )
  ),
  prospection_with_response AS (
    -- Verifica se o lead enviou inbound dentro da janela configurada
    SELECT
      pb.conversation_id,
      pb.first_at,
      EXISTS (
        SELECT 1 FROM chat_messages r
        WHERE r.conversation_id = pb.conversation_id
          AND r.company_id      = p_company_id
          AND r.direction       = 'inbound'
          AND r.created_at      > pb.first_at
          AND r.created_at     <= pb.first_at
                                + (p_prospection_response_window_days || ' days')::INTERVAL
        LIMIT 1
      ) AS responded
    FROM prospection_base pb
  )
  SELECT
    json_agg(
      json_build_object(
        'date',      d.date,
        'initiated', d.initiated,
        'responded', d.responded
      )
      ORDER BY d.date ASC
    ),
    COALESCE(SUM(d.initiated), 0),
    COALESCE(SUM(d.responded), 0)
  INTO
    v_prospection_by_day,
    v_prospection_total_initiated,
    v_prospection_total_responded
  FROM (
    SELECT
      (date_trunc('day', first_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*)::INT                                                 AS initiated,
      SUM(CASE WHEN responded THEN 1 ELSE 0 END)::INT              AS responded
    FROM prospection_with_response
    GROUP BY 1
  ) d;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- RESGATE / REATIVAÇÃO
  -- Definição: lead com outbound no período cujo último inbound real (em
  --            qualquer conversa) anterior ao contato estava há >=
  --            lead_rescue_inactivity_days — ou lead sem inbound histórico.
  -- Unidade: lead (lead_id) — deduplicado via DISTINCT ON.
  -- ═══════════════════════════════════════════════════════════════════════════
  WITH rescue_candidates AS (
    -- Primeiro outbound no período por lead (DISTINCT ON lead_id).
    -- Inclui qualquer outbound (humano, IA, automação).
    SELECT DISTINCT ON (cc.lead_id)
      cc.lead_id,
      cc.id                    AS conversation_id,
      cc.assigned_to,
      l.responsible_user_id,
      cm.created_at            AS rescue_at
    FROM leads l
    JOIN chat_conversations cc
      ON  cc.lead_id    = l.id
      AND cc.company_id = p_company_id
    JOIN chat_messages cm
      ON  cm.conversation_id = cc.id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.created_at     >= p_start_date
      AND cm.created_at     <= p_end_date
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (
        p_user_id IS NULL
        OR cc.assigned_to                                = p_user_id
        OR (cc.assigned_to IS NULL AND l.responsible_user_id = p_user_id)
      )
    ORDER BY cc.lead_id, cm.created_at ASC
  ),
  lead_last_inbound_before_rescue AS (
    -- Último inbound do lead em QUALQUER de suas conversas, antes do rescue_at.
    -- Se o lead nunca teve inbound, não aparece nesta CTE.
    SELECT
      rc.lead_id,
      rc.conversation_id,
      rc.rescue_at,
      MAX(cm.created_at) AS last_inbound_at
    FROM rescue_candidates rc
    JOIN chat_conversations cc2
      ON  cc2.lead_id    = rc.lead_id
      AND cc2.company_id = p_company_id
    JOIN chat_messages cm
      ON  cm.conversation_id = cc2.id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'inbound'
      AND cm.created_at      < rc.rescue_at
    GROUP BY rc.lead_id, rc.conversation_id, rc.rescue_at
  ),
  qualified_rescues AS (
    -- Ramo A: lead tinha inbound histórico, mas estava inativo
    -- (último inbound >= inactivity_days antes do resgate)
    SELECT lead_id, conversation_id, rescue_at
    FROM lead_last_inbound_before_rescue
    WHERE last_inbound_at
            < rescue_at - (p_lead_rescue_inactivity_days || ' days')::INTERVAL

    UNION ALL

    -- Ramo B: lead nunca enviou nenhum inbound (sem histórico algum)
    -- Também qualifica como inativo — jamais iniciou conversa
    SELECT rc.lead_id, rc.conversation_id, rc.rescue_at
    FROM rescue_candidates rc
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_last_inbound_before_rescue lib
      WHERE lib.lead_id = rc.lead_id
    )
  ),
  rescue_with_response AS (
    -- Verifica se o lead respondeu em QUALQUER conversa dentro da janela
    SELECT
      qr.lead_id,
      qr.rescue_at,
      EXISTS (
        SELECT 1
        FROM chat_conversations cc3
        JOIN chat_messages r
          ON  r.conversation_id = cc3.id
          AND r.company_id      = p_company_id
          AND r.direction       = 'inbound'
          AND r.created_at      > qr.rescue_at
          AND r.created_at     <= qr.rescue_at
                                + (p_rescue_response_window_days || ' days')::INTERVAL
        WHERE cc3.lead_id    = qr.lead_id
          AND cc3.company_id = p_company_id
        LIMIT 1
      ) AS responded
    FROM qualified_rescues qr
  )
  SELECT
    json_agg(
      json_build_object(
        'date',      d.date,
        'initiated', d.initiated,
        'responded', d.responded
      )
      ORDER BY d.date ASC
    ),
    COALESCE(SUM(d.initiated), 0),
    COALESCE(SUM(d.responded), 0)
  INTO
    v_rescue_by_day,
    v_rescue_total_initiated,
    v_rescue_total_responded
  FROM (
    SELECT
      (date_trunc('day', rescue_at AT TIME ZONE p_timezone))::DATE AS date,
      COUNT(*)::INT                                                  AS initiated,
      SUM(CASE WHEN responded THEN 1 ELSE 0 END)::INT               AS responded
    FROM rescue_with_response
    GROUP BY 1
  ) d;

  -- ── Retorno ───────────────────────────────────────────────────────────────
  RETURN json_build_object(
    'prospection_by_day', COALESCE(v_prospection_by_day, '[]'::JSON),
    'rescue_by_day',      COALESCE(v_rescue_by_day,      '[]'::JSON),
    'summary', json_build_object(
      'total_prospection_initiated', COALESCE(v_prospection_total_initiated, 0),
      'total_prospection_responded', COALESCE(v_prospection_total_responded, 0),
      'total_rescue_initiated',      COALESCE(v_rescue_total_initiated,      0),
      'total_rescue_responded',      COALESCE(v_rescue_total_responded,      0)
    )
  );

END;
$$;

-- Restringe execução: apenas service_role tem acesso (via endpoint autenticado)
REVOKE EXECUTE ON FUNCTION get_dashboard_activation(
  UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;

COMMENT ON FUNCTION get_dashboard_activation IS
  'Métricas de ativação comercial (v1): prospecção outbound-first e resgate de leads inativos. '
  'Prospecção = conversa cuja 1ª mensagem histórica é outbound e ocorreu no período. '
  'Resgate = lead com outbound no período após >= lead_rescue_inactivity_days sem inbound real. '
  'Unidade de prospecção: conversa. Unidade de resgate: lead (deduplicado). '
  'Fase 2 — Aba Ativação Comercial do Dashboard de Inteligência Comercial.';
