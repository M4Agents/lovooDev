-- =====================================================
-- MIGRATION: add_cycle_state_filter_to_funnel_rpcs
-- Data: 09/07/2026
-- Fase: 10 — Filtro por Estado do Ciclo no Kanban
--
-- Objetivo:
--   Adicionar p_contact_attempts_state (TEXT DEFAULT NULL)
--   às duas RPCs canônicas do Kanban para permitir filtrar
--   oportunidades pelo estado do ciclo de contato.
--
-- Assinatura anterior → nova:
--   get_stage_positions_paged : 14 params → 15 params
--   get_funnel_stage_counts   : 10 params → 11 params
--
-- Estratégia: DROP da canônica atual + CREATE + GRANT
--   Necessário porque a assinatura muda (novo parâmetro).
--   Overloads legados (8/10 e 5/7 params) NÃO são tocados.
--
-- Diff mínimo por função:
--   + p_contact_attempts_state TEXT DEFAULT NULL          (parâmetro)
--   + RAISE EXCEPTION se valor inválido                   (validação)
--   + AND (p_contact_attempts_state IS NULL
--           OR ofp.contact_attempts_state = p_contact_attempts_state)  (WHERE)
--
-- Rollback: supabase/rollback/20260709160000_rollback_add_cycle_state_filter.sql
-- =====================================================


-- ══════════════════════════════════════════════════════════════════════════
-- 1. get_stage_positions_paged  14 params → 15 params
-- ══════════════════════════════════════════════════════════════════════════

-- Drop da canônica atual (14 params) antes de recriar com 15.
-- Overloads legados (8 e 10 params) NÃO são removidos.
DROP FUNCTION IF EXISTS get_stage_positions_paged(
  UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT,
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
);

CREATE OR REPLACE FUNCTION get_stage_positions_paged(
  p_funnel_id               UUID,
  p_stage_id                UUID,
  p_company_id              UUID,
  p_search                  TEXT        DEFAULT NULL,
  p_origin                  TEXT        DEFAULT NULL,
  p_period_days             INT         DEFAULT NULL,
  p_limit                   INT         DEFAULT 20,
  p_offset                  INT         DEFAULT 0,
  p_tag_ids                 UUID[]      DEFAULT NULL,
  p_tag_mode                TEXT        DEFAULT 'or',
  p_start_date              TIMESTAMPTZ DEFAULT NULL,
  p_end_date                TIMESTAMPTZ DEFAULT NULL,
  p_sort_by                 TEXT        DEFAULT NULL,
  p_owner_user_id           UUID        DEFAULT NULL,
  p_contact_attempts_state  TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- ── Validação p_tag_mode ──────────────────────────────────
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  -- ── Sanitização p_sort_by: valor inválido → NULL ─────────
  IF p_sort_by IS NOT NULL AND p_sort_by NOT IN ('entered_stage_at', 'entered_funnel_at', 'lead_created_at', 'last_interaction_at') THEN
    p_sort_by := NULL;
  END IF;

  -- ── Validação p_contact_attempts_state ───────────────────
  IF p_contact_attempts_state IS NOT NULL
     AND p_contact_attempts_state NOT IN ('none', 'cycle_open', 'waiting', 'eligible') THEN
    RAISE EXCEPTION 'Invalid contact_attempts_state: %. Valores válidos: none, cycle_open, waiting, eligible.', p_contact_attempts_state;
  END IF;

  -- ── Restrição por responsável ─────────────────────────────
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

  SELECT COALESCE(
    jsonb_agg(
      row_data
      ORDER BY
        CASE
          WHEN p_sort_by = 'entered_stage_at'    THEN (row_data->>'entered_stage_at')::timestamptz
          WHEN p_sort_by = 'entered_funnel_at'   THEN (row_data->'opportunity'->>'created_at')::timestamptz
          WHEN p_sort_by = 'lead_created_at'     THEN (row_data->'opportunity'->'lead'->>'created_at')::timestamptz
          WHEN p_sort_by = 'last_interaction_at' THEN (row_data->'opportunity'->'lead'->>'last_contact_at')::timestamptz
          ELSE NULL
        END DESC NULLS LAST,
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST,
        (row_data->>'id')::text                      ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',                ofp.id,
      'opportunity_id',    ofp.opportunity_id,
      'lead_id',           ofp.lead_id,
      'funnel_id',         ofp.funnel_id,
      'stage_id',          ofp.stage_id,
      'position_in_stage', ofp.position_in_stage,
      'entered_stage_at',  ofp.entered_stage_at,
      'updated_at',        ofp.updated_at,
      -- ── Campos de ciclo de contato (Fase 5) ────────────────
      'contact_attempts_state',    ofp.contact_attempts_state,
      'current_contact_cycle_id',  ofp.current_contact_cycle_id,
      'contact_cycle_opened_at',   ofp.contact_cycle_opened_at,
      'total_contact_attempts',    ofp.total_contact_attempts,
      'last_contact_attempt_at',   ofp.last_contact_attempt_at,
      'last_cycle_close_reason',   ofp.last_cycle_close_reason,
      'eligible_for_new_cycle_at', ofp.eligible_for_new_cycle_at,
      -- ────────────────────────────────────────────────────────
      'opportunity', jsonb_build_object(
        'id',                  o.id,
        'lead_id',             o.lead_id,
        'company_id',          o.company_id,
        'title',               o.title,
        'description',         o.description,
        'value',               o.value,
        'currency',            o.currency,
        'status',              o.status,
        'probability',         o.probability,
        'expected_close_date', o.expected_close_date,
        'actual_close_date',   o.actual_close_date,
        'source',              o.source,
        'owner_user_id',       o.owner_user_id,
        'created_at',          o.created_at,
        'updated_at',          o.updated_at,
        'closed_at',           o.closed_at,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'email',               l.email,
          'phone',               l.phone,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb),
          'tags', COALESCE(
            (SELECT jsonb_agg(lt2.name ORDER BY lt2.name)
             FROM   lead_tag_assignments lta2
             JOIN   lead_tags lt2 ON lt2.id = lta2.tag_id
             WHERE  lta2.lead_id   = l.id
               AND  lt2.is_active  = true),
            '[]'::jsonb
          )
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND ofp.stage_id   = p_stage_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus leads.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
      -- Filtro por responsável: leads.responsible_user_id (campo canônico).
      AND (p_owner_user_id IS NULL OR l.responsible_user_id = p_owner_user_id)
      -- Filtro por estado do ciclo de contato (Fase 10). NULL = sem filtro.
      AND (
        p_contact_attempts_state IS NULL
        OR ofp.contact_attempts_state = p_contact_attempts_state
      )
    ORDER BY
      CASE
        WHEN p_sort_by = 'entered_stage_at'    THEN ofp.entered_stage_at
        WHEN p_sort_by = 'entered_funnel_at'   THEN o.created_at
        WHEN p_sort_by = 'lead_created_at'     THEN l.created_at
        WHEN p_sort_by = 'last_interaction_at' THEN l.last_contact_at
        ELSE NULL
      END DESC NULLS LAST,
      ofp.position_in_stage ASC,
      ofp.entered_stage_at  DESC NULLS LAST,
      ofp.id                ASC
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stage_positions_paged(
  UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT,
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, TEXT
) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. get_funnel_stage_counts  10 params → 11 params
-- ══════════════════════════════════════════════════════════════════════════

-- Drop da canônica atual (10 params) antes de recriar com 11.
-- Overloads legados (5 e 7 params) NÃO são removidos.
DROP FUNCTION IF EXISTS get_funnel_stage_counts(
  UUID, UUID, TEXT, TEXT, INT, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
);

CREATE OR REPLACE FUNCTION get_funnel_stage_counts(
  p_funnel_id               UUID,
  p_company_id              UUID,
  p_search                  TEXT        DEFAULT NULL,
  p_origin                  TEXT        DEFAULT NULL,
  p_period_days             INT         DEFAULT NULL,
  p_tag_ids                 UUID[]      DEFAULT NULL,
  p_tag_mode                TEXT        DEFAULT 'or',
  p_start_date              TIMESTAMPTZ DEFAULT NULL,
  p_end_date                TIMESTAMPTZ DEFAULT NULL,
  p_owner_user_id           UUID        DEFAULT NULL,
  p_contact_attempts_state  TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────
  IF auth.uid() IS NOT NULL
     AND NOT auth_user_can_access_funnel(p_company_id, p_funnel_id)
  THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  -- ── Validação p_contact_attempts_state ───────────────────
  IF p_contact_attempts_state IS NOT NULL
     AND p_contact_attempts_state NOT IN ('none', 'cycle_open', 'waiting', 'eligible') THEN
    RAISE EXCEPTION 'Invalid contact_attempts_state: %. Valores válidos: none, cycle_open, waiting, eligible.', p_contact_attempts_state;
  END IF;

  IF auth.uid() IS NULL THEN
    v_restricted := false;
  ELSE
    v_restricted := auth_user_restricted_to_own_leads(p_company_id);
  END IF;

  SELECT COALESCE(jsonb_agg(stage_data), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'stage_id',    ofp.stage_id,
      'count',       COUNT(*)::int,
      'total_value', COALESCE(SUM(o.value), 0)::numeric
    ) AS stage_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities o ON o.id = ofp.opportunity_id
    JOIN  leads         l ON l.id = o.lead_id
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus contadores.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
      -- Filtro por responsável: leads.responsible_user_id (campo canônico).
      AND (p_owner_user_id IS NULL OR l.responsible_user_id = p_owner_user_id)
      -- Filtro por estado do ciclo de contato (Fase 10). NULL = sem filtro.
      AND (
        p_contact_attempts_state IS NULL
        OR ofp.contact_attempts_state = p_contact_attempts_state
      )
    GROUP BY ofp.stage_id
  ) subq;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_funnel_stage_counts(
  UUID, UUID, TEXT, TEXT, INT, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) TO authenticated;
