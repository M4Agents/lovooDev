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

  WITH base_page AS (
    SELECT
      ofp.id                           AS ofp_id,
      ofp.opportunity_id               AS ofp_opportunity_id,
      ofp.lead_id                      AS ofp_lead_id,
      ofp.funnel_id                    AS ofp_funnel_id,
      ofp.stage_id                     AS ofp_stage_id,
      ofp.position_in_stage            AS ofp_position_in_stage,
      ofp.entered_stage_at             AS ofp_entered_stage_at,
      ofp.updated_at                   AS ofp_updated_at,
      ofp.contact_attempts_state       AS ofp_contact_attempts_state,
      ofp.current_contact_cycle_id     AS ofp_current_contact_cycle_id,
      ofp.contact_cycle_opened_at      AS ofp_contact_cycle_opened_at,
      ofp.total_contact_attempts       AS ofp_total_contact_attempts,
      ofp.last_contact_attempt_at      AS ofp_last_contact_attempt_at,
      ofp.last_cycle_close_reason      AS ofp_last_cycle_close_reason,
      ofp.eligible_for_new_cycle_at    AS ofp_eligible_for_new_cycle_at,
      o.id                             AS o_id,
      o.lead_id                        AS o_lead_id,
      o.company_id                     AS o_company_id,
      o.title                          AS o_title,
      o.description                    AS o_description,
      o.value                          AS o_value,
      o.currency                       AS o_currency,
      o.status                         AS o_status,
      o.probability                    AS o_probability,
      o.expected_close_date            AS o_expected_close_date,
      o.actual_close_date              AS o_actual_close_date,
      o.source                         AS o_source,
      o.owner_user_id                  AS o_owner_user_id,
      o.created_at                     AS o_created_at,
      o.updated_at                     AS o_updated_at,
      o.closed_at                      AS o_closed_at,
      o.nuvemshop_order_id             AS o_nuvemshop_order_id,
      o.opportunity_number             AS o_opportunity_number,
      l.id                             AS l_id,
      l.name                           AS l_name,
      l.email                          AS l_email,
      l.phone                          AS l_phone,
      l.company_name                   AS l_company_name,
      l.created_at                     AS l_created_at,
      l.origin                         AS l_origin,
      l.status                         AS l_status,
      l.record_type                    AS l_record_type,
      l.last_contact_at                AS l_last_contact_at,
      l.phone_normalized               AS l_phone_normalized,
      l.company_id                     AS l_company_id,
      CASE
        WHEN p_sort_by = 'entered_stage_at'    THEN ofp.entered_stage_at
        WHEN p_sort_by = 'entered_funnel_at'   THEN o.created_at
        WHEN p_sort_by = 'lead_created_at'     THEN l.created_at
        WHEN p_sort_by = 'last_interaction_at' THEN l.last_contact_at
        ELSE NULL
      END                              AS sort_custom,
      ofp.position_in_stage            AS sort_position_in_stage,
      ofp.entered_stage_at             AS sort_entered_stage_at,
      ofp.id::text                     AS sort_id_text
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o  ON o.id  = ofp.opportunity_id
    JOIN leads         l  ON l.id  = o.lead_id
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
  )
  SELECT COALESCE(
    jsonb_agg(
      row_data
      ORDER BY
        sort_custom               DESC NULLS LAST,
        sort_position_in_stage    ASC,
        sort_entered_stage_at     DESC NULLS LAST,
        sort_id_text              ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id',                bp.ofp_id,
        'opportunity_id',    bp.ofp_opportunity_id,
        'lead_id',           bp.ofp_lead_id,
        'funnel_id',         bp.ofp_funnel_id,
        'stage_id',          bp.ofp_stage_id,
        'position_in_stage', bp.ofp_position_in_stage,
        'entered_stage_at',  bp.ofp_entered_stage_at,
        'updated_at',        bp.ofp_updated_at,
        'contact_attempts_state',    bp.ofp_contact_attempts_state,
        'current_contact_cycle_id',  bp.ofp_current_contact_cycle_id,
        'contact_cycle_opened_at',   bp.ofp_contact_cycle_opened_at,
        'total_contact_attempts',    bp.ofp_total_contact_attempts,
        'last_contact_attempt_at',   bp.ofp_last_contact_attempt_at,
        'last_cycle_close_reason',   bp.ofp_last_cycle_close_reason,
        'eligible_for_new_cycle_at', bp.ofp_eligible_for_new_cycle_at,
        'opportunity', jsonb_build_object(
          'id',                  bp.o_id,
          'lead_id',             bp.o_lead_id,
          'company_id',          bp.o_company_id,
          'title',               bp.o_title,
          'description',         bp.o_description,
          'value',               bp.o_value,
          'currency',            bp.o_currency,
          'status',              bp.o_status,
          'probability',         bp.o_probability,
          'expected_close_date', bp.o_expected_close_date,
          'actual_close_date',   bp.o_actual_close_date,
          'source',              bp.o_source,
          'owner_user_id',       bp.o_owner_user_id,
          'created_at',          bp.o_created_at,
          'updated_at',          bp.o_updated_at,
          'closed_at',           bp.o_closed_at,
          'nuvemshop_order_id',  bp.o_nuvemshop_order_id,
          'opportunity_number',  bp.o_opportunity_number,
          'lead', jsonb_build_object(
            'id',                  bp.l_id,
            'name',                bp.l_name,
            'email',               bp.l_email,
            'phone',               bp.l_phone,
            'company_name',        bp.l_company_name,
            'created_at',          bp.l_created_at,
            'origin',              bp.l_origin,
            'status',              bp.l_status,
            'record_type',         bp.l_record_type,
            'last_contact_at',     bp.l_last_contact_at,
            'profile_picture_url', cc.profile_picture_url,
            'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb),
            'tags', COALESCE(
              (SELECT jsonb_agg(lt2.name ORDER BY lt2.name)
               FROM   lead_tag_assignments lta2
               JOIN   lead_tags lt2 ON lt2.id = lta2.tag_id
               WHERE  lta2.lead_id   = bp.l_id
                 AND  lt2.is_active  = true),
              '[]'::jsonb
            )
          )
        )
      ) AS row_data,
      bp.sort_custom,
      bp.sort_position_in_stage,
      bp.sort_entered_stage_at,
      bp.sort_id_text
    FROM base_page bp
    LEFT JOIN chat_contacts cc ON
      bp.l_phone_normalized = cc.phone_number
      AND bp.l_company_id   = cc.company_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = bp.l_phone_normalized
        AND  cv.company_id    = bp.l_company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
  ) subq;

  RETURN v_result;
END;
$function$;
