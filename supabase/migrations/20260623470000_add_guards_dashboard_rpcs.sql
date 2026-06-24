-- =====================================================
-- MIGRATION: Guards de acesso a funis nas RPCs de Dashboard
-- Data: 23/06/2026
-- Rev:  23/06/2026 — C3: corpos reconstruídos substituídos pelos corpos
--                        exatos das migrations originais. Única mudança
--                        permitida: inclusão do guard de acesso.
--
-- Objetivo:
--   Adicionar guard de acesso nas RPCs de dashboard que recebem
--   p_funnel_id UUID (singular, opcional ou obrigatório).
--
-- Pré-requisito: M2 (auth_user_can_access_funnel) e M6b (resolve_user_funnel_ids_access).
--
-- RPCs alvo e suas migrations originais:
--
--   1. get_dashboard_funnel_executive(p_company_id, p_funnel_id UUID obrigatório)
--      Definida em: 20260511140000_fix_dashboard_rpcs_column_refs.sql
--      (versão mais recente: corrige fs.is_active → fs.is_hidden = false)
--      Guard: auth_user_can_access_funnel(p_company_id, p_funnel_id) — obrigatório
--
--   2. get_dashboard_forecast(p_company_id, p_start_date DATE, p_end_date DATE,
--                             p_funnel_id UUID DEFAULT NULL, ...)
--      Definida em: 20260509200000_dashboard_phase3a_rpcs.sql
--      Guard: quando p_funnel_id IS NOT NULL E auth.uid() IS NOT NULL
--
--   3. aggregate_snapshot_period(p_company_id, p_funnel_id uuid,
--                                p_start_date date, p_end_date date)
--      Definida em: 20260609180000_fix_aggregate_snapshot_period_dedup.sql
--      Guard: quando p_funnel_id IS NOT NULL E auth.uid() IS NOT NULL
--      Tabela: dashboard_snapshots (NÃO dashboard_daily_snapshots)
--      Colunas: period_start, snapshot_taken_at (NÃO snapshot_date nem metrics JSONB)
--
-- NOTA sobre service_role:
--   Estas funções são chamadas via /api/dashboard/* (Vercel, service_role).
--   Com service_role, auth.uid() é NULL → guard nunca executa.
--   Proteção ativa apenas para chamadas diretas de usuários autenticados.
--
-- NOTA sobre p_funnel_id IS NULL (get_dashboard_forecast e aggregate_snapshot_period):
--   O guard cobre apenas o caso p_funnel_id IS NOT NULL.
--   Quando NULL, o usuário visualiza todos os funis: adequado pois estas funções
--   são chamadas via service_role em produção. Restrição de NULL é Fase 2.
--
-- IMPACTO ZERO:
--   Comportamento idêntico ao atual enquanto user_funnel_settings estiver vazia.
-- =====================================================

SET search_path = public;

-- ── 1. get_dashboard_funnel_executive ────────────────────────────────────
-- Assinatura original (20260511140000):
--   (p_company_id UUID, p_funnel_id UUID)
--   RETURNS JSON  ← NÃO JSONB
--
-- Guard adicionado: IF auth.uid() IS NOT NULL AND NOT auth_user_can_access_funnel(...)
-- Corpo: EXATAMENTE igual ao de 20260511140000 (versão com is_hidden = false).
-- Mudança única: inclusão do guard antes das CTEs.

CREATE OR REPLACE FUNCTION get_dashboard_funnel_executive(
  p_company_id UUID,
  p_funnel_id  UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- ── Guard: acesso ao funil ─────────────────────────────────────────────
  -- Apenas quando chamado por usuário autenticado (service_role → auth.uid() = NULL).
  IF auth.uid() IS NOT NULL
     AND NOT auth_user_can_access_funnel(p_company_id, p_funnel_id)
  THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- Corpo original (20260511140000) preservado exatamente.
  -- funnel_stages usa is_hidden = false (fix aplicado em 20260511140000).
  WITH stages_ordered AS (
    SELECT
      fs.id       AS stage_id,
      fs.name     AS stage_name,
      fs.position AS stage_position,
      fs.color    AS stage_color
    FROM funnel_stages fs
    WHERE fs.funnel_id  = p_funnel_id
      AND fs.is_hidden  = false
    ORDER BY fs.position
  ),

  stage_opps AS (
    SELECT
      ofp.stage_id,
      COUNT(*)::INT                                                     AS opp_count,
      ROUND(COALESCE(SUM(o.value), 0)::NUMERIC, 2)                     AS total_value,
      ROUND(
        COALESCE(SUM(o.value * o.probability / 100.0), 0)::NUMERIC, 2
      )                                                                 AS weighted_value,
      COUNT(*) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < NOW() - INTERVAL '14 days'
      )::INT                                                            AS stalled_count,
      ROUND(
        COALESCE(
          SUM(o.value) FILTER (
            WHERE o.last_interaction_at IS NULL
               OR o.last_interaction_at < NOW() - INTERVAL '14 days'
          ),
          0
        )::NUMERIC, 2
      )                                                                 AS stalled_value
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o ON o.id = ofp.opportunity_id
    JOIN leads l         ON l.id = o.lead_id
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND o.status       = 'open'
      AND l.deleted_at   IS NULL
    GROUP BY ofp.stage_id
  ),

  stage_avg_days AS (
    SELECT
      osh.to_stage_id AS stage_id,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (COALESCE(osh.stage_left_at, NOW()) - osh.stage_entered_at)) / 86400.0
        )::NUMERIC, 1
      )               AS avg_days
    FROM opportunity_stage_history osh
    WHERE osh.funnel_id = p_funnel_id
    GROUP BY osh.to_stage_id
  )

  SELECT json_build_object(
    'funnel_id', p_funnel_id,
    'stages', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'stage_id',       s.stage_id,
            'stage_name',     s.stage_name,
            'stage_color',    s.stage_color,
            'position',       s.stage_position,
            'opp_count',      COALESCE(so.opp_count, 0),
            'total_value',    COALESCE(so.total_value, 0),
            'weighted_value', COALESCE(so.weighted_value, 0),
            'stalled_count',  COALESCE(so.stalled_count, 0),
            'stalled_value',  COALESCE(so.stalled_value, 0),
            'avg_days',       COALESCE(sad.avg_days, 0)
          )
          ORDER BY s.stage_position
        )
        FROM stages_ordered s
        LEFT JOIN stage_opps     so  ON so.stage_id  = s.stage_id
        LEFT JOIN stage_avg_days sad ON sad.stage_id = s.stage_id
      ),
      '[]'::JSON
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_funnel_executive(UUID, UUID) TO authenticated;


-- ── 2. get_dashboard_forecast ─────────────────────────────────────────────
-- Assinatura original (20260509200000):
--   (p_company_id UUID, p_start_date DATE, p_end_date DATE,
--    p_funnel_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL,
--    p_stalled_days INT DEFAULT 14)
--   RETURNS JSON  ← NÃO JSONB
--   p_start_date e p_end_date são obrigatórios (sem DEFAULT)
--
-- Guard adicionado: quando auth.uid() IS NOT NULL E p_funnel_id IS NOT NULL
-- Corpo: EXATAMENTE igual ao de 20260509200000.
-- Mudança única: 3 linhas de guard antes das CTEs.

CREATE OR REPLACE FUNCTION get_dashboard_forecast(
  p_company_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_funnel_id    UUID    DEFAULT NULL,
  p_user_id      UUID    DEFAULT NULL,
  p_stalled_days INT     DEFAULT 14
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- ── Guard: acesso ao funil ─────────────────────────────────────────────
  -- Apenas quando chamado por usuário autenticado E com funnel explícito.
  -- p_funnel_id IS NULL (todos os funis): sem guard nesta fase (Fase 2).
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  -- Corpo original (20260509200000) preservado exatamente.
  WITH open_pipeline AS (
    SELECT
      o.id,
      COALESCE(o.value, 0)       AS value,
      COALESCE(o.probability, 0) AS probability,
      o.last_interaction_at
    FROM   opportunities o
    JOIN   leads l ON l.id = o.lead_id
    LEFT JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE  o.company_id   = p_company_id
      AND  o.status       = 'open'
      AND  l.company_id   = p_company_id
      AND  l.deleted_at   IS NULL
      AND  (p_funnel_id IS NULL OR ofp.funnel_id = p_funnel_id)
      AND  (p_user_id   IS NULL OR l.responsible_user_id = p_user_id)
  ),

  pipeline_metrics AS (
    SELECT
      ROUND(COALESCE(SUM(value), 0)::NUMERIC, 2)                    AS pipeline_total,
      ROUND(COALESCE(SUM(value * probability / 100.0), 0)::NUMERIC, 2) AS pipeline_weighted,
      COUNT(*)::INT                                                  AS open_count
    FROM open_pipeline
  ),

  stalled AS (
    SELECT id, value, probability
    FROM   open_pipeline
    WHERE  last_interaction_at IS NULL
        OR last_interaction_at < NOW() - make_interval(days => p_stalled_days)
  ),

  stalled_metrics AS (
    SELECT
      COUNT(*)::INT                                                        AS stalled_count,
      ROUND(COALESCE(SUM(value), 0)::NUMERIC, 2)                          AS stalled_value,
      ROUND(COALESCE(SUM(value * probability / 100.0), 0)::NUMERIC, 2)    AS stalled_weighted_value
    FROM stalled
  ),

  period_closed AS (
    SELECT
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'),  0)::NUMERIC, 2
      ) AS won_value,
      ROUND(
        COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'), 0)::NUMERIC, 2
      ) AS lost_value,
      COUNT(*) FILTER (WHERE o.status = 'won')::INT  AS won_count,
      COUNT(*) FILTER (WHERE o.status = 'lost')::INT AS lost_count
    FROM  opportunities o
    JOIN  leads l ON l.id = o.lead_id
    WHERE o.company_id   = p_company_id
      AND l.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND o.closed_at    IS NOT NULL
      AND o.closed_at::DATE BETWEEN p_start_date AND p_end_date
      AND (p_funnel_id IS NULL OR EXISTS (
            SELECT 1 FROM opportunity_funnel_positions ofp2
            WHERE  ofp2.opportunity_id = o.id
              AND  ofp2.funnel_id      = p_funnel_id
          ))
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  )

  SELECT json_build_object(
    'pipeline_total',          pm.pipeline_total,
    'pipeline_weighted',       pm.pipeline_weighted,
    'pipeline_risk',           sm.stalled_weighted_value,
    'pipeline_safe',           GREATEST(pm.pipeline_weighted - sm.stalled_weighted_value, 0),
    'open_count',              pm.open_count,
    'stalled_count',           sm.stalled_count,
    'stalled_value',           sm.stalled_value,
    'stalled_weighted_value',  sm.stalled_weighted_value,
    'won_value',               pc.won_value,
    'won_count',               pc.won_count,
    'lost_value',              pc.lost_value,
    'lost_count',              pc.lost_count,
    'conversion_rate',         CASE
                                 WHEN (pc.won_count + pc.lost_count) = 0 THEN 0
                                 ELSE ROUND(
                                   pc.won_count::NUMERIC / (pc.won_count + pc.lost_count) * 100,
                                   1
                                 )
                               END
  )
  INTO v_result
  FROM pipeline_metrics pm, stalled_metrics sm, period_closed pc;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_forecast(UUID, DATE, DATE, UUID, UUID, INT) TO authenticated;


-- ── 3. aggregate_snapshot_period ─────────────────────────────────────────
-- Assinatura original (20260609180000):
--   (p_company_id uuid, p_funnel_id uuid, p_start_date date, p_end_date date)
--   RETURNS json  ← NÃO jsonb
--   p_funnel_id NÃO tem DEFAULT NULL (parâmetro obrigatório; chamadores passam NULL explícito)
--
-- Guard adicionado: quando auth.uid() IS NOT NULL E p_funnel_id IS NOT NULL
-- Tabela: dashboard_snapshots (NÃO dashboard_daily_snapshots)
-- Colunas diretas: period_start, snapshot_taken_at, leads_created, etc. (NÃO JSONB metrics)
-- Deduplicação: DISTINCT ON (period_start) conforme hotfix 20260609180000.
-- Corpo: EXATAMENTE igual ao de 20260609180000.
-- Mudança única: 4 linhas de guard no início do BEGIN.

CREATE OR REPLACE FUNCTION public.aggregate_snapshot_period(
  p_company_id uuid,
  p_funnel_id  uuid,
  p_start_date date,
  p_end_date   date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_flow  JSON;
  v_state JSON;
  v_meta  JSON;
  v_days  INT;
BEGIN
  -- ── Guard: acesso ao funil ─────────────────────────────────────────────
  -- Apenas quando chamado por usuário autenticado E com funnel explícito.
  -- p_funnel_id IS NULL (company-wide): sem guard nesta fase (Fase 2).
  IF auth.uid() IS NOT NULL AND p_funnel_id IS NOT NULL THEN
    IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
    END IF;
  END IF;

  -- Corpo original (20260609180000) preservado exatamente.
  -- FLOW: deduplicar por period_start, mantendo o snapshot mais recente do dia
  WITH deduped AS (
    SELECT DISTINCT ON (s.period_start)
      s.period_start,
      s.leads_created,
      s.conversations_attended,
      s.won_count,
      s.won_value,
      s.lost_count,
      s.lost_value,
      s.sla_breached_count
    FROM dashboard_snapshots s
    WHERE s.company_id = p_company_id
      AND (
            (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
         OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
          )
      AND s.period_start BETWEEN p_start_date AND p_end_date
    ORDER BY s.period_start, s.snapshot_taken_at DESC
  )
  SELECT
    json_build_object(
      'leads_created',          COALESCE(SUM(d.leads_created),          0),
      'conversations_attended', COALESCE(SUM(d.conversations_attended), 0),
      'won_count',              COALESCE(SUM(d.won_count),              0),
      'won_value',              COALESCE(SUM(d.won_value),              0),
      'lost_count',             COALESCE(SUM(d.lost_count),             0),
      'lost_value',             COALESCE(SUM(d.lost_value),             0),
      'sla_breached_count',     COALESCE(SUM(d.sla_breached_count),     0)
    ),
    COUNT(*)::INT
  INTO v_flow, v_days
  FROM deduped d;

  -- STATE: snapshot mais recente dentro ou antes do período
  SELECT json_build_object(
    'pipeline_total',       s.pipeline_total,
    'pipeline_weighted',    s.pipeline_weighted,
    'pipeline_risk',        s.pipeline_risk,
    'open_count',           s.open_count,
    'stalled_count',        s.stalled_count,
    'hot_count',            s.hot_count,
    'avg_response_minutes', s.avg_response_minutes,
    'conversion_rate',      s.conversion_rate,
    'prob_0_20_value',      s.prob_0_20_value,
    'prob_21_40_value',     s.prob_21_40_value,
    'prob_41_60_value',     s.prob_41_60_value,
    'prob_61_80_value',     s.prob_61_80_value,
    'prob_81_100_value',    s.prob_81_100_value,
    'funnel_stages_cache',  s.funnel_stages_cache,
    'snapshot_date',        s.period_start
  )
  INTO v_state
  FROM dashboard_snapshots s
  WHERE s.company_id = p_company_id
    AND (
          (p_funnel_id IS NULL     AND s.funnel_id IS NULL)
       OR (p_funnel_id IS NOT NULL AND s.funnel_id = p_funnel_id)
        )
    AND s.period_start <= p_end_date
  ORDER BY s.period_start DESC, s.snapshot_taken_at DESC
  LIMIT 1;

  v_meta := json_build_object(
    'from_date',           p_start_date,
    'to_date',             p_end_date,
    'funnel_id',           p_funnel_id,
    'snapshot_days_found', COALESCE(v_days, 0),
    'has_data',            COALESCE(v_days, 0) > 0
  );

  RETURN json_build_object(
    'flow',  COALESCE(v_flow,  '{}'::JSON),
    'state', COALESCE(v_state, '{}'::JSON),
    'meta',  v_meta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION aggregate_snapshot_period(UUID, UUID, DATE, DATE) TO authenticated;
