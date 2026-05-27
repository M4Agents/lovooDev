-- =====================================================
-- MIGRATION: Filtro por tags nas RPCs do Funil de Vendas
-- Data: 27/05/2026
-- Objetivo: Adicionar parâmetros p_tag_ids e p_tag_mode às
--           RPCs do board para suporte a filtro por múltiplas
--           tags com condição OR ou AND.
--
-- RPCs alteradas:
--   1. get_stage_positions_paged        (cards paginados por coluna)
--   2. get_funnel_stage_counts          (contadores por etapa)
--   3. get_stage_opportunity_ids_filtered (IDs para bulk move)
--
-- Modos:
--   'or'  → lead possui qualquer uma das tags selecionadas
--   'and' → lead possui todas as tags selecionadas
--
-- Backward compatibility:
--   p_tag_ids  DEFAULT NULL → sem filtro de tags
--   p_tag_mode DEFAULT 'or' → modo padrão mantido
--
-- Garantias multi-tenant:
--   O filtro de tags usa lt.company_id = p_company_id para
--   garantir que tags de outras empresas não influenciem o resultado.
--   Tags inativas (lt.is_active = false) nunca passam no filtro.
--
-- Não gera duplicatas:
--   Tags filtradas via EXISTS/NOT EXISTS em subquery correlacionada,
--   sem JOIN no FROM principal — zero risco de duplicação de cards.
-- =====================================================


-- =====================================================
-- 1. get_stage_positions_paged
--    Adiciona: p_tag_ids uuid[] DEFAULT NULL
--              p_tag_mode text  DEFAULT 'or'
-- =====================================================

CREATE OR REPLACE FUNCTION get_stage_positions_paged(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INT     DEFAULT NULL,
  p_limit       INT     DEFAULT 20,
  p_offset      INT     DEFAULT 0,
  p_tag_ids     UUID[]  DEFAULT NULL,
  p_tag_mode    TEXT    DEFAULT 'or'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Validar p_tag_mode
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      row_data
      ORDER BY
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST
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
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
      -- Filtro de tags: sem filtro quando p_tag_ids é NULL ou vazio
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
    ORDER BY ofp.position_in_stage ASC, ofp.entered_stage_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;


-- =====================================================
-- 2. get_funnel_stage_counts
--    Adiciona: p_tag_ids uuid[] DEFAULT NULL
--              p_tag_mode text  DEFAULT 'or'
-- =====================================================

CREATE OR REPLACE FUNCTION get_funnel_stage_counts(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INT     DEFAULT NULL,
  p_tag_ids     UUID[]  DEFAULT NULL,
  p_tag_mode    TEXT    DEFAULT 'or'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
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
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
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
    GROUP BY ofp.stage_id
  ) subq;

  RETURN v_result;
END;
$$;


-- =====================================================
-- 3. get_stage_opportunity_ids_filtered
--    Adiciona: p_tag_ids uuid[] DEFAULT NULL
--              p_tag_mode text  DEFAULT 'or'
-- =====================================================

CREATE OR REPLACE FUNCTION get_stage_opportunity_ids_filtered(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INTEGER DEFAULT NULL,
  p_tag_ids     UUID[]  DEFAULT NULL,
  p_tag_mode    TEXT    DEFAULT 'or'
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  SELECT ARRAY_AGG(ofp.opportunity_id)
  INTO v_ids
  FROM opportunity_funnel_positions ofp
  JOIN opportunities o ON o.id = ofp.opportunity_id
  JOIN leads l         ON l.id = o.lead_id
  WHERE ofp.funnel_id = p_funnel_id
    AND ofp.stage_id  = p_stage_id
    AND o.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND (
      p_search IS NULL
      OR l.name  ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.email ILIKE '%' || p_search || '%'
    )
    AND (p_origin      IS NULL OR l.origin = p_origin)
    AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
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
    );

  RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$$;
