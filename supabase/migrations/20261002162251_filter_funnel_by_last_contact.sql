-- Filtro de período do funil também aceita leads.last_contact_at.
-- Assinatura das RPCs do quadro não muda: só entra o valor 'last_contact_at'.
-- A função usada pela movimentação em massa ganha p_date_field no final, com padrão created_at.

DO $patch$
DECLARE
  r record;
  v_def text;
  v_old_list constant text := 'NOT IN (''created_at'', ''closed_at'')';
  v_new_list constant text := 'NOT IN (''created_at'', ''closed_at'', ''last_contact_at'')';
  v_old_case constant text := 'CASE WHEN p_date_field = ''closed_at'' THEN o.closed_at ELSE o.created_at END';
  v_new_case constant text := 'CASE WHEN p_date_field = ''closed_at'' THEN o.closed_at WHEN p_date_field = ''last_contact_at'' THEN l.last_contact_at ELSE o.created_at END';
  v_list_hits int;
  v_case_hits int;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname IN (
          'get_stage_positions_paged_assignee',
          'get_funnel_stage_counts_assignee'
        )
        OR (
          p.proname = 'get_funnel_stage_counts'
          AND pg_get_function_identity_arguments(p.oid) LIKE '%p_date_field%'
        )
      )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_list_hits := (length(v_def) - length(replace(v_def, v_old_list, ''))) / length(v_old_list);
    v_case_hits := (length(v_def) - length(replace(v_def, v_old_case, ''))) / length(v_old_case);

    IF v_list_hits <> 1 THEN
      RAISE EXCEPTION 'whitelist de data inesperada em % (%): %', r.proname, r.args, v_list_hits;
    END IF;
    IF v_case_hits <> 2 THEN
      RAISE EXCEPTION 'expressão de data inesperada em % (%): %', r.proname, r.args, v_case_hits;
    END IF;

    v_def := replace(v_def, v_old_list, v_new_list);
    v_def := replace(v_def, v_old_case, v_new_case);
    EXECUTE v_def;
  END LOOP;
END
$patch$;

DROP FUNCTION IF EXISTS public.get_stage_opportunity_ids_filtered(
  uuid, uuid, uuid, text, text, integer, uuid[], text, timestamptz, timestamptz
);

CREATE OR REPLACE FUNCTION public.get_stage_opportunity_ids_filtered(
  p_funnel_id   uuid,
  p_stage_id    uuid,
  p_company_id  uuid,
  p_search      text DEFAULT NULL,
  p_origin      text DEFAULT NULL,
  p_period_days integer DEFAULT NULL,
  p_tag_ids     uuid[] DEFAULT NULL,
  p_tag_mode    text DEFAULT 'or',
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL,
  p_date_field  text DEFAULT 'created_at'
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids UUID[];
BEGIN
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  IF p_date_field IS NULL OR p_date_field NOT IN ('created_at', 'closed_at', 'last_contact_at') THEN
    p_date_field := 'created_at';
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
      OR l.name         ILIKE '%' || p_search || '%'
      OR l.phone        ILIKE '%' || p_search || '%'
      OR l.email        ILIKE '%' || p_search || '%'
      OR l.company_name ILIKE '%' || p_search || '%'
    )
    AND (p_origin IS NULL OR l.origin = p_origin)
    AND (
      CASE
        WHEN p_start_date IS NOT NULL THEN
          CASE
            WHEN p_date_field = 'closed_at' THEN o.closed_at
            WHEN p_date_field = 'last_contact_at' THEN l.last_contact_at
            ELSE o.created_at
          END >= p_start_date
        WHEN p_period_days IS NOT NULL THEN
          o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
        ELSE TRUE
      END
    )
    AND (
      p_end_date IS NULL OR
      CASE
        WHEN p_date_field = 'closed_at' THEN o.closed_at
        WHEN p_date_field = 'last_contact_at' THEN l.last_contact_at
        ELSE o.created_at
      END <= p_end_date
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
    );

  RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stage_opportunity_ids_filtered(
  uuid, uuid, uuid, text, text, integer, uuid[], text, timestamptz, timestamptz, text
) TO PUBLIC, anon, authenticated, service_role;
