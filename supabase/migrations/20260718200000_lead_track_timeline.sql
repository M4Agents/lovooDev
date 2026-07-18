-- Enrich first lead_entry with track metadata + RPC for paginated visit/entry timeline

CREATE OR REPLACE FUNCTION public.create_initial_lead_entry_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_is_duplicate BOOLEAN;
  v_source       TEXT;
  v_metadata     JSONB;
BEGIN
  SELECT is_duplicate INTO v_is_duplicate FROM leads WHERE id = NEW.id;

  IF COALESCE(v_is_duplicate, false) THEN
    RETURN NEW;
  END IF;

  v_source := CASE NEW.origin
    WHEN 'webhook_ultra_simples' THEN 'webhook'
    WHEN 'whatsapp'              THEN 'whatsapp'
    WHEN 'api'                   THEN 'webhook'
    WHEN 'instagram'             THEN 'instagram'
    ELSE                              'manual'
  END;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'visitor_id',   NULLIF(BTRIM(COALESCE(NEW.visitor_id, '')), ''),
    'utm_source',   NULLIF(BTRIM(COALESCE(NEW.utm_source, '')), ''),
    'utm_medium',   NULLIF(BTRIM(COALESCE(NEW.utm_medium, '')), ''),
    'utm_campaign', NULLIF(BTRIM(COALESCE(NEW.campanha, '')), ''),
    'utm_content',  NULLIF(BTRIM(COALESCE(NEW.conjunto_anuncio, '')), ''),
    'utm_term',     NULLIF(BTRIM(COALESCE(NEW.anuncio, '')), '')
  ));

  INSERT INTO lead_entries (
    company_id,
    lead_id,
    source,
    origin_channel,
    external_event_id,
    idempotency_key,
    metadata,
    created_at
  ) VALUES (
    NEW.company_id,
    NEW.id,
    v_source,
    NULLIF(BTRIM(NEW.utm_source), ''),
    NULL,
    'init_' || NEW.id::text,
    COALESCE(v_metadata, '{}'::jsonb),
    NEW.created_at
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Paginated unified timeline: lead_entries + visitors for lead.visitor_id (company-scoped)
CREATE OR REPLACE FUNCTION public.get_lead_track_timeline(
  p_company_id uuid,
  p_lead_id integer,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  item_type text,
  item_id text,
  created_at timestamptz,
  source text,
  origin_channel text,
  visitor_id text,
  session_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  device_type text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_offset integer;
  v_visitor_text text;
  v_visitor uuid;
BEGIN
  IF p_company_id IS NULL OR p_lead_id IS NULL THEN
    RETURN;
  END IF;

  -- Ensure lead belongs to company and is not deleted
  SELECT NULLIF(BTRIM(COALESCE(l.visitor_id, '')), '')
    INTO v_visitor_text
  FROM public.leads l
  WHERE l.id = p_lead_id
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  v_visitor := NULL;
  IF v_visitor_text IS NOT NULL THEN
    BEGIN
      v_visitor := v_visitor_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_visitor := NULL;
    END;
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'entry'::text AS item_type,
      le.id::text AS item_id,
      le.created_at,
      le.source,
      le.origin_channel,
      COALESCE(le.metadata->>'visitor_id', v_visitor_text) AS visitor_id,
      le.metadata->>'session_id' AS session_id,
      COALESCE(le.metadata->>'utm_source', le.origin_channel) AS utm_source,
      le.metadata->>'utm_medium' AS utm_medium,
      le.metadata->>'utm_campaign' AS utm_campaign,
      le.metadata->>'utm_content' AS utm_content,
      le.metadata->>'utm_term' AS utm_term,
      le.metadata->>'referrer' AS referrer,
      le.metadata->>'device_type' AS device_type,
      COALESCE(le.metadata, '{}'::jsonb) AS metadata
    FROM public.lead_entries le
    WHERE le.lead_id = p_lead_id
      AND le.company_id = p_company_id

    UNION ALL

    SELECT
      'visit'::text AS item_type,
      v.id::text AS item_id,
      v.created_at,
      'visit'::text AS source,
      v.utm_source AS origin_channel,
      v.visitor_id::text AS visitor_id,
      v.session_id::text AS session_id,
      v.utm_source,
      v.utm_medium,
      v.utm_campaign,
      v.utm_content,
      v.utm_term,
      v.referrer,
      v.device_type::text AS device_type,
      jsonb_build_object(
        'landing_page_id', v.landing_page_id,
        'screen_resolution', v.screen_resolution,
        'timezone', v.timezone,
        'language', v.language
      ) AS metadata
    FROM public.visitors v
    INNER JOIN public.landing_pages lp ON lp.id = v.landing_page_id
    WHERE v_visitor IS NOT NULL
      AND v.visitor_id = v_visitor
      AND lp.company_id = p_company_id
  ) t
  ORDER BY t.created_at DESC, t.item_id DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lead_track_timeline_summary(
  p_company_id uuid,
  p_lead_id integer
)
RETURNS TABLE (
  entry_count bigint,
  visit_count bigint,
  visits_before_conversion bigint,
  first_visit_at timestamptz,
  first_entry_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor_text text;
  v_visitor uuid;
  v_first_entry timestamptz;
BEGIN
  SELECT NULLIF(BTRIM(COALESCE(l.visitor_id, '')), '')
    INTO v_visitor_text
  FROM public.leads l
  WHERE l.id = p_lead_id
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_visitor := NULL;
  IF v_visitor_text IS NOT NULL THEN
    BEGIN
      v_visitor := v_visitor_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_visitor := NULL;
    END;
  END IF;

  SELECT MIN(le.created_at) INTO v_first_entry
  FROM public.lead_entries le
  WHERE le.lead_id = p_lead_id
    AND le.company_id = p_company_id;

  entry_count := (
    SELECT COUNT(*) FROM public.lead_entries le
    WHERE le.lead_id = p_lead_id AND le.company_id = p_company_id
  );

  IF v_visitor IS NULL THEN
    visit_count := 0;
    visits_before_conversion := 0;
    first_visit_at := NULL;
    first_entry_at := v_first_entry;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COUNT(*), MIN(v.created_at)
    INTO visit_count, first_visit_at
  FROM public.visitors v
  INNER JOIN public.landing_pages lp ON lp.id = v.landing_page_id
  WHERE v.visitor_id = v_visitor
    AND lp.company_id = p_company_id;

  IF v_first_entry IS NULL THEN
    visits_before_conversion := visit_count;
  ELSE
    SELECT COUNT(*)
      INTO visits_before_conversion
    FROM public.visitors v
    INNER JOIN public.landing_pages lp ON lp.id = v.landing_page_id
    WHERE v.visitor_id = v_visitor
      AND lp.company_id = p_company_id
      AND v.created_at < v_first_entry;
  END IF;

  first_entry_at := v_first_entry;
  RETURN NEXT;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lead_track_timeline_total(
  p_company_id uuid,
  p_lead_id integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor_text text;
  v_visitor uuid;
  v_entries bigint;
  v_visits bigint;
BEGIN
  SELECT NULLIF(BTRIM(COALESCE(l.visitor_id, '')), '')
    INTO v_visitor_text
  FROM public.leads l
  WHERE l.id = p_lead_id
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_entries
  FROM public.lead_entries le
  WHERE le.lead_id = p_lead_id AND le.company_id = p_company_id;

  v_visitor := NULL;
  IF v_visitor_text IS NOT NULL THEN
    BEGIN
      v_visitor := v_visitor_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_visitor := NULL;
    END;
  END IF;

  IF v_visitor IS NULL THEN
    RETURN v_entries;
  END IF;

  SELECT COUNT(*) INTO v_visits
  FROM public.visitors v
  INNER JOIN public.landing_pages lp ON lp.id = v.landing_page_id
  WHERE v.visitor_id = v_visitor
    AND lp.company_id = p_company_id;

  RETURN COALESCE(v_entries, 0) + COALESCE(v_visits, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_lead_track_timeline(uuid, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline(uuid, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline(uuid, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_track_timeline(uuid, integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.get_lead_track_timeline_summary(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline_summary(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline_summary(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_track_timeline_summary(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.get_lead_track_timeline_total(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline_total(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_lead_track_timeline_total(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_track_timeline_total(uuid, integer) TO service_role;
