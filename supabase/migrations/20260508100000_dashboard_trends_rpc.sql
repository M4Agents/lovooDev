-- =====================================================
-- MIGRATION: RPCs para Dashboard de Tendências — Fase 1
-- Data: 08/05/2026
--
-- Funções criadas:
--   1. get_dashboard_trends        — séries diárias de leads e atendimentos
--   2. get_dashboard_selectable_users — usuários filtráveis pelo UserSelector
--
-- Segurança: SECURITY DEFINER
--   O endpoint /api/dashboard/trends valida membership e role antes de
--   chamar as funções via service_role. As funções em si não verificam
--   permissões — a validação fica na camada de API.
-- =====================================================

-- =====================================================
-- FUNÇÃO 1: get_dashboard_trends
--
-- Retorna JSON com duas séries:
--   leads_by_day:      [{ date: "YYYY-MM-DD", count: N }]
--   attendance_by_day: [{ date: "YYYY-MM-DD", attended: N, avg_response_minutes: N.N }]
--
-- Regras críticas de atendimento (correção obrigatória do usuário):
--   - Busca o PRIMEIRO inbound da conversa dentro do período
--   - Busca a PRIMEIRA resposta humana outbound APÓS esse inbound
--     (cm.created_at > first_in_at — nunca resposta anterior ao inbound)
--   - Mensagens de IA (is_ai_generated = true) são excluídas da contagem
--   - Garante response_minutes >= 0 por construção (out > in)
--   - Agrupado pelo dia em que ocorreu a primeira resposta humana
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_trends(
  p_company_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date   TIMESTAMPTZ,
  p_user_id    UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leads_by_day      JSON;
  v_attendance_by_day JSON;
BEGIN

  -- ── 1. Novos leads agrupados por dia ──────────────────────────────────────
  SELECT json_agg(row_to_json(d))
  INTO   v_leads_by_day
  FROM (
    SELECT
      (date_trunc('day', l.created_at AT TIME ZONE 'UTC'))::DATE AS date,
      COUNT(*)::INT                                               AS count
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
    ORDER BY 1 ASC
  ) d;

  -- ── 2. Atendimentos: primeira resposta humana APÓS primeiro inbound ───────
  -- CTE corrigida: first_human_response é estritamente dependente do
  -- first_inbound — never standalone, always cm.created_at > fi.first_in_at.
  WITH first_inbound AS (
    -- Primeira mensagem inbound por conversa dentro do período
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
    -- Primeira mensagem humana outbound APÓS o inbound da mesma conversa.
    -- A condição cm.created_at > fi.first_in_at garante avg >= 0.
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
      AND cm.created_at      > fi.first_in_at   -- ← CRÍTICO: só após o inbound
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),
  filtered AS (
    -- Filtra por vendedor via: chat_conversations → leads.responsible_user_id
    SELECT
      fhr.first_out_at,
      fhr.response_minutes
    FROM first_human_response fhr
    JOIN chat_conversations cc ON cc.id = fhr.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  )
  SELECT json_agg(row_to_json(d))
  INTO   v_attendance_by_day
  FROM (
    SELECT
      (date_trunc('day', first_out_at AT TIME ZONE 'UTC'))::DATE AS date,
      COUNT(*)::INT                                               AS attended,
      ROUND(AVG(response_minutes)::NUMERIC, 1)                   AS avg_response_minutes
    FROM filtered
    GROUP BY 1
    ORDER BY 1 ASC
  ) d;

  RETURN json_build_object(
    'leads_by_day',      COALESCE(v_leads_by_day,      '[]'::JSON),
    'attendance_by_day', COALESCE(v_attendance_by_day, '[]'::JSON)
  );

END;
$$;

-- Restringe execução: apenas roles explicitamente autorizadas (service_role tem acesso)
REVOKE EXECUTE ON FUNCTION get_dashboard_trends(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;

-- =====================================================
-- FUNÇÃO 2: get_dashboard_selectable_users
--
-- Retorna membros ativos da empresa com roles filtráveis.
-- Usada pelo endpoint /api/dashboard/dashboard-users para
-- popular o UserSelector do frontend.
--
-- Sem checagem de permissão interna — o endpoint valida o caller
-- e decide o que retornar com base no role do chamador.
--
-- Acessa auth.users via SET search_path = public, auth.
-- =====================================================

CREATE OR REPLACE FUNCTION get_dashboard_selectable_users(
  p_company_id UUID
)
RETURNS TABLE (
  user_id      UUID,
  display_name TEXT,
  role         TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    cu.user_id,
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'full_name',
      au.email,
      cu.user_id::TEXT
    ) AS display_name,
    cu.role
  FROM company_users cu
  JOIN auth.users au ON au.id = cu.user_id
  WHERE cu.company_id = p_company_id
    AND cu.is_active  = true
    AND cu.role       IN ('seller', 'manager', 'admin')
  ORDER BY cu.role ASC, display_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_selectable_users(UUID) FROM PUBLIC;

COMMENT ON FUNCTION get_dashboard_trends IS
  'Séries diárias para o cockpit comercial: novos leads por dia e atendimentos com tempo médio de primeira resposta humana. '
  'Fase 1 — Dashboard de Inteligência Comercial.';

COMMENT ON FUNCTION get_dashboard_selectable_users IS
  'Retorna membros ativos com role seller/manager/admin para o UserSelector da dashboard. '
  'Sem validação de permissão interna — validação é responsabilidade do endpoint.';
