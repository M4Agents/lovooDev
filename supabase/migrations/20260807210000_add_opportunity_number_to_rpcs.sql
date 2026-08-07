-- =====================================================
-- MIGRATION: add_opportunity_number_to_rpcs
-- Data: 07/08/2026
-- Objetivo: Expor opportunity_number no JSON retornado
--           pelas duas RPCs canônicas do funil.
--
-- RPCs alteradas:
--   1. get_funnel_positions_with_photos
--      Base: 20260623450000_add_guards_kanban_rpcs.sql (versão vigente)
--      Mudança: adição de 'opportunity_number', o.opportunity_number
--               após 'discount_value' no jsonb_build_object de opportunity.
--
--   2. get_stage_positions_paged
--      Base: 20260804120000_rpc_stage_positions_add_nuvemshop_order_id.sql
--            (versão vigente — supera 20260803100000)
--      Mudança: adição de 'opportunity_number', o.opportunity_number
--               após 'nuvemshop_order_id' no jsonb_build_object de opportunity.
--
-- As assinaturas NÃO mudam. Usar CREATE OR REPLACE sem DROP.
-- Compatibilidade com Produção: o novo campo é aditivo.
-- Clientes que não conhecem opportunity_number ignoram o campo.
-- =====================================================

SET search_path = public;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. get_funnel_positions_with_photos
--    Versão vigente: 20260623450000_add_guards_kanban_rpcs.sql
--    Única mudança: 'opportunity_number', o.opportunity_number
--                   adicionado após 'discount_value'.
--    Preservado integralmente:
--      - STABLE modifier
--      - Guard auth_user_can_access_funnel
--      - v_restricted (seller restriction por responsible_user_id)
--      - is_over_plan masking (email/phone nullados)
--      - reentry_count via subquery em opportunity_stage_history
--      - value_mode, items_subtotal, discount_type, discount_value
--      - JOIN via l.phone_normalized (não regex)
--      - Filtros p_search, p_origin, p_period_days, p_stage_id
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_funnel_positions_with_photos(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_stage_id    UUID    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────────────────
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- Calcular restrição uma única vez para toda a query.
  -- auth.uid() sempre presente neste contexto (frontend JWT).
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY (row_data->>'position_in_stage')::int ASC),
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
      'reentry_count',     COALESCE(rc.reentry_count, 0),
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
        'value_mode',          o.value_mode,
        'items_subtotal',      o.items_subtotal,
        'discount_type',       o.discount_type,
        'discount_value',      o.discount_value,
        'opportunity_number',  o.opportunity_number,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'is_over_plan',        l.is_over_plan,
          -- Campos sensíveis mascarados no banco para leads restritos pelo plano
          'email',               CASE WHEN l.is_over_plan THEN NULL ELSE l.email END,
          'phone',               CASE WHEN l.is_over_plan THEN NULL ELSE l.phone END,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb)
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN (
      SELECT opportunity_id, COUNT(*) AS reentry_count
      FROM opportunity_stage_history
      WHERE move_type  = 'lead_reentry'
        AND company_id = p_company_id
      GROUP BY opportunity_id
    ) rc ON rc.opportunity_id = ofp.opportunity_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus leads.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (p_stage_id    IS NULL OR ofp.stage_id = p_stage_id)
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
  ) subq;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. get_stage_positions_paged
--    Versão vigente: 20260804120000_rpc_stage_positions_add_nuvemshop_order_id.sql
--    (supera 20260803100000 — adiciona nuvemshop_order_id ao JSON)
--    Única mudança: 'opportunity_number', o.opportunity_number
--                   adicionado após 'nuvemshop_order_id'.
--    Preservado integralmente:
--      - Todos os 16 parâmetros incluindo p_date_field
--      - Guard auth_user_can_access_funnel
--      - v_restricted (seller restriction)
--      - Todos os campos de ciclo de contato nas posições
--      - Tags subquery no lead
--      - nuvemshop_order_id no opportunity
--      - Filtro dinâmico por p_date_field (created_at ou closed_at)
--      - p_sort_by, p_owner_user_id, p_contact_attempts_state
--      - Sanitizações de p_sort_by, p_contact_attempts_state, p_date_field
--
--    Sem DROP: a assinatura não mudou (16 params → 16 params).
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_stage_positions_paged(
  p_funnel_id               uuid,
  p_stage_id                uuid,
  p_company_id              uuid,
  p_search                  text        DEFAULT NULL,
  p_origin                  text        DEFAULT NULL,
  p_period_days             integer     DEFAULT NULL,
  p_limit                   integer     DEFAULT 20,
  p_offset                  integer     DEFAULT 0,
  p_tag_ids                 uuid[]      DEFAULT NULL,
  p_tag_mode                text        DEFAULT 'or',
  p_start_date              timestamptz DEFAULT NULL,
  p_end_date                timestamptz DEFAULT NULL,
  p_sort_by                 text        DEFAULT NULL,
  p_owner_user_id           uuid        DEFAULT NULL,
  p_contact_attempts_state  text        DEFAULT NULL,
  p_date_field              text        DEFAULT 'created_at'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  IF p_sort_by IS NOT NULL AND p_sort_by NOT IN ('entered_stage_at', 'entered_funnel_at', 'lead_created_at', 'last_interaction_at') THEN
    p_sort_by := NULL;
  END IF;

  IF p_contact_attempts_state IS NOT NULL
     AND p_contact_attempts_state NOT IN ('none', 'cycle_open', 'waiting', 'eligible') THEN
    RAISE EXCEPTION 'Invalid contact_attempts_state: %. Valores válidos: none, cycle_open, waiting, eligible.', p_contact_attempts_state;
  END IF;

  IF p_date_field IS NULL OR p_date_field NOT IN ('created_at', 'closed_at') THEN
    p_date_field := 'created_at';
  END IF;

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
      'contact_attempts_state',    ofp.contact_attempts_state,
      'current_contact_cycle_id',  ofp.current_contact_cycle_id,
      'contact_cycle_opened_at',   ofp.contact_cycle_opened_at,
      'total_contact_attempts',    ofp.total_contact_attempts,
      'last_contact_attempt_at',   ofp.last_contact_attempt_at,
      'last_cycle_close_reason',   ofp.last_cycle_close_reason,
      'eligible_for_new_cycle_at', ofp.eligible_for_new_cycle_at,
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
        'nuvemshop_order_id',  o.nuvemshop_order_id,
        'opportunity_number',  o.opportunity_number,
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
          WHEN p_start_date IS NOT NULL THEN
            CASE WHEN p_date_field = 'closed_at' THEN o.closed_at ELSE o.created_at END >= p_start_date
          WHEN p_period_days IS NOT NULL THEN
            o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (
        p_end_date IS NULL OR
        CASE WHEN p_date_field = 'closed_at' THEN o.closed_at ELSE o.created_at END <= p_end_date
      )
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
      AND (p_owner_user_id IS NULL OR l.responsible_user_id = p_owner_user_id)
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
$function$;
