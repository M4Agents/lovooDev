-- Lista paginada de leads filtrados por tags.
-- A interseção das tags ocorre no banco, antes da página.
-- A função ainda não deve ser aplicada no projeto compartilhado.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_lead_ids_for_filters(
  p_company_id uuid,
  p_tag_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_status text,
  p_origin text,
  p_responsible_user_id text,
  p_search text,
  p_search_phone_variants text[],
  p_name text,
  p_phone text,
  p_phone_variants text[],
  p_email text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (lead_id integer, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_limit integer;
  v_offset integer;
  v_requested integer;
  v_matched integer;
BEGIN
  IF p_company_id IS NULL
     OR p_tag_ids IS NULL
     OR cardinality(p_tag_ids) = 0
     OR EXISTS (
       SELECT 1
       FROM unnest(p_tag_ids) AS requested(tag_id)
       WHERE requested.tag_id IS NULL
     )
  THEN
    RETURN QUERY SELECT NULL::integer, 0::bigint;
    RETURN;
  END IF;

  SELECT count(DISTINCT requested.tag_id)
    INTO v_requested
  FROM unnest(p_tag_ids) AS requested(tag_id)
  WHERE requested.tag_id IS NOT NULL;

  SELECT count(DISTINCT tag.id)
    INTO v_matched
  FROM public.lead_tags AS tag
  WHERE tag.company_id = p_company_id
    AND tag.id = ANY (p_tag_ids);

  IF v_matched <> v_requested THEN
    RETURN QUERY SELECT NULL::integer, 0::bigint;
    RETURN;
  END IF;

  IF p_responsible_user_id IS NOT NULL
     AND p_responsible_user_id <> ''
     AND p_responsible_user_id <> 'unassigned'
     AND p_responsible_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'invalid input syntax for type uuid: "%"', p_responsible_user_id
      USING ERRCODE = '22P02';
  END IF;

  v_limit := CASE
    WHEN p_limit IS NULL THEN 100
    WHEN p_limit < 0 THEN 0
    WHEN p_limit > 100 THEN 100
    ELSE p_limit
  END;

  v_offset := CASE
    WHEN p_offset IS NULL OR p_offset < 0 THEN 0
    ELSE p_offset
  END;

  RETURN QUERY
  WITH filtered AS (
    SELECT lead.id, lead.created_at
    FROM public.leads AS lead
    WHERE lead.company_id = p_company_id
      AND lead.deleted_at IS NULL
      AND (p_start IS NULL OR lead.created_at >= p_start)
      AND (p_end IS NULL OR lead.created_at <= p_end)
      AND (p_status IS NULL OR p_status = '' OR lead.status = p_status)
      AND (p_origin IS NULL OR p_origin = '' OR lead.origin = p_origin)
      AND (
        CASE
          WHEN p_responsible_user_id IS NULL
            THEN TRUE
          WHEN p_responsible_user_id = ''
            THEN TRUE
          WHEN p_responsible_user_id = 'unassigned'
            THEN lead.responsible_user_id IS NULL
          ELSE
            lead.responsible_user_id = p_responsible_user_id::uuid
        END
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(p_tag_ids) AS wanted(tag_id)
        WHERE wanted.tag_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.lead_tag_assignments AS assignment
            WHERE assignment.lead_id = lead.id
              AND assignment.tag_id = wanted.tag_id
          )
      )
      AND (
        p_search IS NULL OR p_search = ''
        OR lead.name ILIKE '%' || p_search || '%'
        OR lead.email ILIKE '%' || p_search || '%'
        OR lead.phone ILIKE '%' || p_search || '%'
        OR lead.company_name ILIKE '%' || p_search || '%'
        OR (
          coalesce(cardinality(p_search_phone_variants), 0) > 0
          AND lead.phone_normalized = ANY (p_search_phone_variants)
        )
      )
      AND (p_name IS NULL OR p_name = '' OR lead.name ILIKE '%' || p_name || '%')
      AND (
        p_phone IS NULL OR p_phone = ''
        OR lead.phone ILIKE '%' || p_phone || '%'
        OR (
          coalesce(cardinality(p_phone_variants), 0) > 0
          AND lead.phone_normalized = ANY (p_phone_variants)
        )
      )
      AND (p_email IS NULL OR p_email = '' OR lead.email ILIKE '%' || p_email || '%')
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count
    FROM filtered
  ),
  page AS (
    SELECT filtered.id, filtered.created_at
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT page.id, counted.total_count
  FROM counted
  LEFT JOIN page ON true
  ORDER BY page.created_at DESC, page.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_lead_ids_for_filters(
  uuid, uuid[], timestamptz, timestamptz, text, text, text, text, text[], text, text, text[], text, integer, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.list_lead_ids_for_filters(
  uuid, uuid[], timestamptz, timestamptz, text, text, text, text, text[], text, text, text[], text, integer, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.list_lead_ids_for_filters(
  uuid, uuid[], timestamptz, timestamptz, text, text, text, text, text[], text, text, text[], text, integer, integer
) FROM service_role;

GRANT EXECUTE ON FUNCTION public.list_lead_ids_for_filters(
  uuid, uuid[], timestamptz, timestamptz, text, text, text, text, text[], text, text, text[], text, integer, integer
) TO authenticated;

COMMIT;
