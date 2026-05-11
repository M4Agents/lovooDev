-- =====================================================
-- MIGRATION: RPCs Dashboard Fase 2 — Gestão Comercial
-- Data: 09/05/2026
--
-- Funções criadas:
--   1. get_dashboard_seller_ranking  — ranking com score composto
--   2. get_dashboard_sla_alerts      — leads sem resposta paginado
--   3. get_dashboard_lead_origins    — volume e conversão por origem
--
-- Score composto (ajuste obrigatório do usuário):
--   Conversão    35% | Velocidade   25%
--   Atendimento  20% | Geração      10% | SLA mantido 10%
--
-- Oportunidades (ajuste obrigatório):
--   opps_generated → filtrado por o.created_at no período
--   opps_won/lost  → filtrado por o.closed_at no período
-- =====================================================

-- =====================================================
-- 1. get_dashboard_seller_ranking
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_seller_ranking(
  p_company_id      UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_user_id         UUID    DEFAULT NULL,
  p_include_ranking BOOLEAN DEFAULT TRUE
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
  -- 1. Membros ativos com roles comerciais (respeitando filtro de vendedor)
  active_sellers AS (
    SELECT
      cu.user_id,
      COALESCE(cu.display_name, cu.email, cu.user_id::TEXT) AS display_name
    FROM company_users cu
    WHERE cu.company_id = p_company_id
      AND cu.is_active  = true
      AND cu.role       IN ('seller', 'manager', 'admin')
      AND (p_user_id IS NULL OR cu.user_id = p_user_id)
  ),

  -- 2. Leads recebidos no período (eixo: responsible_user_id)
  leads_metrics AS (
    SELECT
      l.responsible_user_id         AS user_id,
      COUNT(DISTINCT l.id)::INT     AS leads_received
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  -- 3. Oportunidades via leads do vendedor
  --    opps_generated: o.created_at no período (ajuste obrigatório)
  --    opps_won/lost:  o.closed_at  no período (ajuste obrigatório)
  opp_metrics AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.created_at >= p_start_date AND o.created_at <= p_end_date
      )::INT AS opps_generated,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      )::INT AS opps_won,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status IN ('won','lost')
      )::INT AS opps_closed,
      COALESCE(SUM(o.value) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      ), 0) AS won_value
    FROM leads l
    JOIN opportunities o ON o.lead_id = l.id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  -- 4. Primeiro inbound por conversa no período
  first_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= p_start_date
      AND cm.created_at <= p_end_date
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),

  -- 5. Primeira resposta humana após o inbound (sem bound de período)
  first_human_response AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS response_min
    FROM first_inbound fi
    JOIN chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),

  -- 6. Atendimentos e tempo médio por vendedor
  attendance_metrics AS (
    SELECT
      l.responsible_user_id                       AS user_id,
      COUNT(DISTINCT fhr.conversation_id)::INT    AS leads_attended,
      ROUND(AVG(fhr.response_min)::NUMERIC, 1)    AS avg_response_min
    FROM first_human_response fhr
    JOIN chat_conversations cc ON cc.id = fhr.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  -- 7. SLA perdido: inbound no período, sem nenhuma resposta humana após
  --    Usa LEFT JOIN com first_human_response; NULL = sem resposta
  sla_missed_convs AS (
    SELECT fi.conversation_id
    FROM first_inbound fi
    LEFT JOIN first_human_response fhr ON fhr.conversation_id = fi.conversation_id
    WHERE fhr.conversation_id IS NULL
  ),

  -- 8. SLA perdido por vendedor
  sla_metrics AS (
    SELECT
      l.responsible_user_id                        AS user_id,
      COUNT(DISTINCT smc.conversation_id)::INT     AS sla_missed_count
    FROM sla_missed_convs smc
    JOIN chat_conversations cc ON cc.id = smc.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  -- 9. Combinação de todas as métricas por vendedor
  combined AS (
    SELECT
      s.user_id,
      s.display_name,
      COALESCE(lm.leads_received,   0) AS leads_received,
      COALESCE(am.leads_attended,   0) AS leads_attended,
      am.avg_response_min,
      COALESCE(om.opps_generated,   0) AS opps_generated,
      COALESCE(om.opps_won,         0) AS opps_won,
      COALESCE(om.opps_closed,      0) AS opps_closed,
      COALESCE(om.won_value,        0) AS won_value,
      COALESCE(sm.sla_missed_count, 0) AS sla_missed_count
    FROM active_sellers s
    LEFT JOIN leads_metrics lm      ON lm.user_id = s.user_id
    LEFT JOIN opp_metrics om        ON om.user_id = s.user_id
    LEFT JOIN attendance_metrics am ON am.user_id = s.user_id
    LEFT JOIN sla_metrics sm        ON sm.user_id = s.user_id
    WHERE COALESCE(lm.leads_received, 0) > 0  -- exclui sellers sem leads no período
  ),

  -- 10. Normalização via window functions (single pass)
  norm AS (
    SELECT *,
      MAX(COALESCE(avg_response_min, 0)) OVER () AS max_response,
      MAX(opps_generated)               OVER () AS max_opps
    FROM combined
  ),

  -- 11. Score composto e taxas derivadas
  --     Pesos: Conversão 35% | Velocidade 25% | Atendimento 20% | Geração 10% | SLA 10%
  scored AS (
    SELECT
      user_id,
      display_name,
      leads_received,
      leads_attended,
      avg_response_min,
      opps_generated,
      opps_won,
      opps_closed,
      won_value,
      sla_missed_count,
      -- Taxas derivadas
      ROUND(COALESCE(leads_attended::NUMERIC    / NULLIF(leads_received,  0), 0),   3) AS attendance_rate,
      ROUND(COALESCE(opps_won::NUMERIC          / NULLIF(opps_closed,     0), 0.5), 3) AS conversion_rate,
      ROUND(COALESCE(sla_missed_count::NUMERIC  / NULLIF(leads_received,  0), 0),   3) AS sla_missed_rate,
      -- Score composto (null quando individual view — sem comparação relativa válida)
      CASE WHEN p_include_ranking THEN
        ROUND((
          0.35 * COALESCE(opps_won::NUMERIC / NULLIF(opps_closed, 0), 0.5)
        + 0.25 * CASE
                   WHEN avg_response_min IS NULL THEN 0
                   WHEN max_response > 0         THEN 1.0 - (avg_response_min / max_response)
                   ELSE 1.0
                 END
        + 0.20 * COALESCE(leads_attended::NUMERIC / NULLIF(leads_received, 0), 0)
        + 0.10 * CASE WHEN max_opps > 0 THEN opps_generated::NUMERIC / max_opps ELSE 0 END
        + 0.10 * GREATEST(1.0 - COALESCE(sla_missed_count::NUMERIC / NULLIF(leads_received, 0), 0), 0)
        ) * 100, 1)
      ELSE NULL
      END AS score
    FROM norm
  )

  -- 12. Resultado final com rank
  SELECT json_agg(row_to_json(t) ORDER BY COALESCE(t.score, -1) DESC)
  INTO   v_result
  FROM (
    SELECT
      scored.*,
      CASE WHEN p_include_ranking AND score IS NOT NULL
           THEN ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST)
           ELSE NULL
      END AS rank
    FROM scored
  ) t;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_seller_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC;

-- =====================================================
-- 2. get_dashboard_sla_alerts (paginado — ajuste obrigatório)
--
-- Paginação correta via dois passes sobre as CTEs.
-- Ajuste obrigatório: retorna total, limit, offset.
-- Conversas filtradas: last_inbound no max_age_hours,
--   sem resposta humana após, com sla_hours de espera.
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

  -- Passo 1: total (sem LIMIT para paginação correta)
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS last_in_at
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
  pending AS (
    SELECT li.conversation_id
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
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

  -- Passo 2: dados paginados
  WITH last_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS last_in_at
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
  pending AS (
    SELECT
      li.conversation_id,
      li.last_in_at,
      ROUND(EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0, 1) AS hours_waiting
    FROM last_inbound li
    LEFT JOIN has_response hr ON hr.conversation_id = li.conversation_id
    WHERE hr.conversation_id IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - li.last_in_at)) / 3600.0 >= p_sla_hours
  )
  SELECT json_agg(row_to_json(t))
  INTO   v_items
  FROM (
    SELECT
      p.conversation_id::TEXT                                 AS conversation_id,
      l.id::TEXT                                              AS lead_id,
      COALESCE(l.name, 'Lead sem nome')                       AS lead_name,
      l.responsible_user_id::TEXT                             AS responsible_user_id,
      COALESCE(cu.display_name, cu.email)                     AS seller_name,
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
-- 3. get_dashboard_lead_origins
--
-- Agrupa leads por origem (LOWER+TRIM, NULL → desconhecida).
-- Usa barras horizontais no frontend.
-- LEFT JOIN com opportunities para conversão e receita.
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_lead_origins(
  p_company_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date   TIMESTAMPTZ,
  p_user_id    UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_agg(row_to_json(d) ORDER BY d.lead_count DESC, d.total_won_value DESC)
  FROM (
    SELECT
      COALESCE(NULLIF(LOWER(TRIM(l.origin)), ''), 'desconhecida') AS origin,
      COUNT(DISTINCT l.id)::INT                                    AS lead_count,
      COUNT(DISTINCT o.id)::INT                                    AS opps_generated,
      COUNT(DISTINCT CASE WHEN o.status = 'won'             THEN l.id END)::INT AS leads_converted,
      ROUND(
        COUNT(DISTINCT CASE WHEN o.status = 'won'             THEN l.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT CASE WHEN o.status IN ('won','lost') THEN l.id END), 0) * 100
      , 1) AS conversion_rate_pct,
      ROUND(COALESCE(
        SUM(CASE WHEN o.status = 'won' THEN o.value ELSE 0 END), 0
      )::NUMERIC, 2) AS total_won_value,
      ROUND(COALESCE(
        AVG(CASE WHEN o.status = 'won' THEN o.value END), 0
      )::NUMERIC, 2) AS avg_won_value
    FROM leads l
    LEFT JOIN opportunities o ON o.lead_id = l.id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
    ORDER BY lead_count DESC, total_won_value DESC
    LIMIT 20
  ) d;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_lead_origins(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;

COMMENT ON FUNCTION get_dashboard_seller_ranking IS
  'Ranking comercial com score composto (Conversão 35%, Velocidade 25%, Atendimento 20%, Geração 10%, SLA 10%). '
  'p_include_ranking=FALSE retorna métricas sem score/rank (visão individual). Fase 2.';

COMMENT ON FUNCTION get_dashboard_sla_alerts IS
  'Leads sem resposta humana após p_sla_hours horas. Paginado com total correto via dois passes. Fase 2.';

COMMENT ON FUNCTION get_dashboard_lead_origins IS
  'Volume, conversão e receita por canal de origem dos leads. LOWER+TRIM normalizado; NULL → desconhecida. Fase 2.';
