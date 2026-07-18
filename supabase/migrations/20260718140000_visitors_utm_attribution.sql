-- Lote UTM-no-track: first-touch UTM na visita + herança no lead via visitor_id
-- Retrocompatível: params UTM opcionais; JSONB sem UTM continua válido.

-- 1) Colunas aditivas em visitors
ALTER TABLE public.visitors
  ADD COLUMN IF NOT EXISTS utm_source character varying(255),
  ADD COLUMN IF NOT EXISTS utm_medium character varying(100),
  ADD COLUMN IF NOT EXISTS utm_campaign character varying(255),
  ADD COLUMN IF NOT EXISTS utm_content character varying(255),
  ADD COLUMN IF NOT EXISTS utm_term character varying(255);

COMMENT ON COLUMN public.visitors.utm_source IS
  'First-touch UTM source captured at visit time by tracking pixel';
COMMENT ON COLUMN public.visitors.utm_medium IS
  'First-touch UTM medium captured at visit time by tracking pixel';
COMMENT ON COLUMN public.visitors.utm_campaign IS
  'First-touch UTM campaign captured at visit time by tracking pixel';
COMMENT ON COLUMN public.visitors.utm_content IS
  'First-touch UTM content captured at visit time by tracking pixel';
COMMENT ON COLUMN public.visitors.utm_term IS
  'First-touch UTM term captured at visit time by tracking pixel';

-- 2) RPC de visita: nova assinatura com UTM opcional (drop + create; grants reafirmados)
DROP FUNCTION IF EXISTS public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.public_create_tracking_visit(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text,
  p_user_agent text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_screen_resolution text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  visit_id uuid,
  persistent_visitor_id uuid,
  session_id uuid,
  landing_page_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking_code uuid;
  v_persistent_visitor_id uuid;
  v_session_id uuid;
  v_lp_ok boolean;
  v_lp_error text;
  v_lp_id uuid;
  v_visit_id uuid;
  v_device text;
  v_utm_source varchar(255);
  v_utm_medium varchar(100);
  v_utm_campaign varchar(255);
  v_utm_content varchar(255);
  v_utm_term varchar(255);
  v_ft_source varchar(255);
  v_ft_medium varchar(100);
  v_ft_campaign varchar(255);
  v_ft_content varchar(255);
  v_ft_term varchar(255);
BEGIN
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false; error_code := 'INVALID_TRACKING_CODE';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    v_tracking_code := btrim(p_tracking_code)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    success := false; error_code := 'INVALID_TRACKING_CODE';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END;

  IF p_persistent_visitor_id IS NULL OR btrim(p_persistent_visitor_id) = '' THEN
    success := false; error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    v_persistent_visitor_id := btrim(p_persistent_visitor_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    success := false; error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    success := false; error_code := 'INVALID_SESSION_ID';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    v_session_id := btrim(p_session_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    success := false; error_code := 'INVALID_SESSION_ID';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END;

  v_device := NULLIF(TRIM(p_device_type), '');
  IF v_device IS NOT NULL AND v_device NOT IN ('desktop', 'mobile', 'tablet') THEN
    success := false; error_code := 'INVALID_DEVICE_TYPE';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT r.success, r.error_code, r.landing_page_id
    INTO v_lp_ok, v_lp_error, v_lp_id
  FROM public.resolve_tracking_landing_page(v_tracking_code) r
  LIMIT 1;

  IF v_lp_ok IS NOT TRUE THEN
    success := false;
    error_code := COALESCE(v_lp_error, 'LANDING_PAGE_NOT_FOUND');
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Incoming UTM (sanitized)
  v_utm_source   := LEFT(NULLIF(BTRIM(p_utm_source), ''), 255);
  v_utm_medium   := LEFT(NULLIF(BTRIM(p_utm_medium), ''), 100);
  v_utm_campaign := LEFT(NULLIF(BTRIM(p_utm_campaign), ''), 255);
  v_utm_content  := LEFT(NULLIF(BTRIM(p_utm_content), ''), 255);
  v_utm_term     := LEFT(NULLIF(BTRIM(p_utm_term), ''), 255);

  -- First-touch: reuse earliest attribution for this persistent visitor when present
  SELECT v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term
    INTO v_ft_source, v_ft_medium, v_ft_campaign, v_ft_content, v_ft_term
  FROM public.visitors v
  WHERE v.visitor_id = v_persistent_visitor_id
    AND (
      v.utm_source IS NOT NULL OR v.utm_medium IS NOT NULL OR v.utm_campaign IS NOT NULL
      OR v.utm_content IS NOT NULL OR v.utm_term IS NOT NULL
    )
  ORDER BY v.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    v_utm_source   := v_ft_source;
    v_utm_medium   := v_ft_medium;
    v_utm_campaign := v_ft_campaign;
    v_utm_content  := v_ft_content;
    v_utm_term     := v_ft_term;
  END IF;

  INSERT INTO public.visitors (
    landing_page_id,
    session_id,
    visitor_id,
    user_agent,
    device_type,
    screen_resolution,
    referrer,
    timezone,
    language,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term
  ) VALUES (
    v_lp_id,
    v_session_id,
    v_persistent_visitor_id,
    p_user_agent,
    v_device,
    p_screen_resolution,
    p_referrer,
    p_timezone,
    p_language,
    v_utm_source,
    v_utm_medium,
    v_utm_campaign,
    v_utm_content,
    v_utm_term
  )
  RETURNING id INTO v_visit_id;

  IF v_visit_id IS NULL THEN
    success := false; error_code := 'INTERNAL_ERROR';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  success := true;
  error_code := NULL;
  visit_id := v_visit_id;
  persistent_visitor_id := v_persistent_visitor_id;
  session_id := v_session_id;
  landing_page_id := v_lp_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    success := false; error_code := 'INTERNAL_ERROR';
    visit_id := NULL; persistent_visitor_id := NULL; session_id := NULL; landing_page_id := NULL;
    RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'Canonical tracking visit create with optional first-touch UTM fields. Prior attribution for the same persistent visitor_id is reused.';

REVOKE EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- 3) Herança UTM visita → lead em create_lead_from_company (mesma assinatura)
CREATE OR REPLACE FUNCTION public.create_lead_from_company(
  p_company_id uuid,
  lead_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_status     TEXT;
  v_max_leads          INTEGER;
  v_current_leads      BIGINT;
  v_phone              TEXT;
  v_email              TEXT;
  v_phone_norm         TEXT;
  v_existing_id        INTEGER;
  v_lead_id            INTEGER;
  v_update_on_reentry  BOOLEAN := false;
  v_visitor_text       TEXT;
  v_visitor_uuid       UUID;
  v_utm_source         TEXT;
  v_utm_medium         TEXT;
  v_campanha           TEXT;
  v_conjunto_anuncio   TEXT;
  v_anuncio            TEXT;
  v_vis_source         TEXT;
  v_vis_medium         TEXT;
  v_vis_campaign       TEXT;
  v_vis_content        TEXT;
  v_vis_term           TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create:' || p_company_id::TEXT, 0)
  );

  SELECT status INTO v_company_status
  FROM public.companies
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  IF v_company_status IN ('suspended', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'company_inactive',
      'status',  v_company_status
    );
  END IF;

  IF v_company_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_inactive');
  END IF;

  SELECT p.max_leads INTO v_max_leads
  FROM public.companies c
  JOIN public.plans p ON p.id = c.plan_id
  WHERE c.id = p_company_id;

  IF v_max_leads IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_leads
    FROM public.leads
    WHERE company_id = p_company_id
      AND deleted_at IS NULL;

    IF v_current_leads >= v_max_leads THEN
      RETURN jsonb_build_object(
        'success',     false,
        'error',       'plan_limit_exceeded',
        'max_allowed', v_max_leads,
        'current',     v_current_leads
      );
    END IF;
  END IF;

  SELECT COALESCE(
    (duplicate_lead_config->>'update_on_reentry')::boolean,
    false
  )
  INTO v_update_on_reentry
  FROM company_lead_config
  WHERE company_id = p_company_id;

  v_update_on_reentry := COALESCE(v_update_on_reentry, false);

  -- Marketing from payload (prefer payload)
  v_utm_source       := NULLIF(BTRIM(lead_data->>'utm_source'), '');
  v_utm_medium       := NULLIF(BTRIM(lead_data->>'utm_medium'), '');
  v_campanha         := NULLIF(BTRIM(lead_data->>'campanha'), '');
  v_conjunto_anuncio := NULLIF(BTRIM(lead_data->>'conjunto_anuncio'), '');
  v_anuncio          := NULLIF(BTRIM(lead_data->>'anuncio'), '');

  -- Fallback: first-touch from visitors by persistent visitor_id
  v_visitor_text := NULLIF(BTRIM(lead_data->>'visitor_id'), '');
  IF v_visitor_text IS NOT NULL
     AND (
       v_utm_source IS NULL OR v_utm_medium IS NULL OR v_campanha IS NULL
       OR v_conjunto_anuncio IS NULL OR v_anuncio IS NULL
     )
  THEN
    BEGIN
      v_visitor_uuid := v_visitor_text::uuid;
      SELECT v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term
        INTO v_vis_source, v_vis_medium, v_vis_campaign, v_vis_content, v_vis_term
      FROM public.visitors v
      WHERE v.visitor_id = v_visitor_uuid
        AND (
          v.utm_source IS NOT NULL OR v.utm_medium IS NOT NULL OR v.utm_campaign IS NOT NULL
          OR v.utm_content IS NOT NULL OR v.utm_term IS NOT NULL
        )
      ORDER BY v.created_at ASC
      LIMIT 1;

      IF FOUND THEN
        v_utm_source       := COALESCE(v_utm_source, v_vis_source);
        v_utm_medium       := COALESCE(v_utm_medium, v_vis_medium);
        v_campanha         := COALESCE(v_campanha, v_vis_campaign);
        v_conjunto_anuncio := COALESCE(v_conjunto_anuncio, v_vis_content);
        v_anuncio          := COALESCE(v_anuncio, v_vis_term);
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;

  v_phone := lead_data->>'phone';
  v_email := lead_data->>'email';

  IF v_phone IS NOT NULL AND trim(v_phone) != '' THEN
    v_phone_norm := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
    IF LENGTH(v_phone_norm) >= 10 THEN
      SELECT id INTO v_existing_id
      FROM public.leads
      WHERE company_id = p_company_id
        AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_norm
        AND phone IS NOT NULL AND trim(phone) != ''
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_existing_id IS NULL AND v_email IS NOT NULL AND trim(v_email) != '' THEN
    SELECT id INTO v_existing_id
    FROM public.leads
    WHERE company_id = p_company_id
      AND lower(trim(email)) = lower(trim(v_email))
      AND email IS NOT NULL AND trim(email) != ''
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    IF v_update_on_reentry THEN
      UPDATE public.leads SET
        name = CASE
          WHEN NULLIF(trim(lead_data->>'name'), '') IS NOT NULL
           AND trim(lead_data->>'name') IS DISTINCT FROM 'Lead sem nome'
          THEN trim(lead_data->>'name')
          ELSE name
        END,
        email            = COALESCE(NULLIF(trim(lower(lead_data->>'email')),          ''), email),
        phone            = COALESCE(NULLIF(trim(lead_data->>'phone'),                 ''), phone),
        interest         = COALESCE(NULLIF(trim(lead_data->>'interest'),              ''), interest),
        company_name     = COALESCE(NULLIF(trim(lead_data->>'company_name'),          ''), company_name),
        company_cnpj     = COALESCE(NULLIF(trim(lead_data->>'company_cnpj'),          ''), company_cnpj),
        company_email    = COALESCE(NULLIF(trim(lower(lead_data->>'company_email')), ''), company_email),
        campanha         = COALESCE(v_campanha, campanha),
        conjunto_anuncio = COALESCE(v_conjunto_anuncio, conjunto_anuncio),
        anuncio          = COALESCE(v_anuncio, anuncio),
        utm_medium       = COALESCE(v_utm_medium, utm_medium),
        utm_source       = COALESCE(v_utm_source, utm_source),
        updated_at = NOW()
      WHERE id          = v_existing_id
        AND company_id  = p_company_id;
    END IF;

    RETURN jsonb_build_object(
      'success',              true,
      'lead_id',              v_existing_id,
      'company_id',           p_company_id,
      'is_duplicate',         true,
      'duplicate_of_lead_id', v_existing_id
    );
  END IF;

  INSERT INTO public.leads (
    company_id, name, email, phone, interest,
    company_name, company_cnpj, company_email, visitor_id,
    status, origin,
    campanha, conjunto_anuncio, anuncio, utm_medium, utm_source,
    created_at
  ) VALUES (
    p_company_id,
    COALESCE(lead_data->>'name', 'Lead sem nome'),
    lead_data->>'email',
    lead_data->>'phone',
    lead_data->>'interest',
    lead_data->>'company_name',
    lead_data->>'company_cnpj',
    lead_data->>'company_email',
    lead_data->>'visitor_id',
    'novo',
    'webhook_ultra_simples',
    v_campanha,
    v_conjunto_anuncio,
    v_anuncio,
    v_utm_medium,
    v_utm_source,
    NOW()
  )
  RETURNING id INTO v_lead_id;

  RETURN jsonb_build_object(
    'success',              true,
    'lead_id',              v_lead_id,
    'company_id',           p_company_id,
    'is_duplicate',         false,
    'duplicate_of_lead_id', NULL
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) TO service_role;
