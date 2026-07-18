-- Conversion signals: pixel → Lovoo link without requiring n8n to forward visitor_id

CREATE TABLE IF NOT EXISTS public.lead_conversion_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tracking_code uuid NOT NULL,
  landing_page_id uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL,
  persistent_visitor_id uuid NOT NULL,
  session_id uuid,
  phone_norm text,
  email_norm text,
  name text,
  consumed_at timestamptz,
  lead_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_conversion_signals_contact_chk CHECK (
    phone_norm IS NOT NULL OR email_norm IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_lead_conversion_signals_company_phone_created
  ON public.lead_conversion_signals (company_id, phone_norm, created_at DESC)
  WHERE phone_norm IS NOT NULL AND consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_conversion_signals_company_email_created
  ON public.lead_conversion_signals (company_id, email_norm, created_at DESC)
  WHERE email_norm IS NOT NULL AND consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_conversion_signals_visitor_created
  ON public.lead_conversion_signals (persistent_visitor_id, created_at DESC);

COMMENT ON TABLE public.lead_conversion_signals IS
  'Pixel-emitted conversion intents used to attach visitor_id/UTM to leads without n8n forwarding attribution.';

ALTER TABLE public.lead_conversion_signals ENABLE ROW LEVEL SECURITY;

-- No direct client access; only via SECURITY DEFINER RPCs / service_role
REVOKE ALL ON TABLE public.lead_conversion_signals FROM PUBLIC;
REVOKE ALL ON TABLE public.lead_conversion_signals FROM anon;
REVOKE ALL ON TABLE public.lead_conversion_signals FROM authenticated;
GRANT ALL ON TABLE public.lead_conversion_signals TO service_role;

-- Normalize BR-friendly phone: digits only; keep last 11 when longer
CREATE OR REPLACE FUNCTION public.normalize_lead_phone_digits(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;
  v_digits := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');
  IF v_digits IS NULL OR v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF LENGTH(v_digits) > 11 THEN
    RETURN RIGHT(v_digits, 11);
  END IF;
  RETURN v_digits;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_lead_phone_digits(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_lead_phone_digits(text) TO anon;
GRANT EXECUTE ON FUNCTION public.normalize_lead_phone_digits(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_lead_phone_digits(text) TO service_role;

CREATE OR REPLACE FUNCTION public.public_create_conversion_signal(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  signal_id uuid,
  company_id uuid,
  linked_lead_id integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking_code uuid;
  v_visitor uuid;
  v_session uuid;
  v_lp_ok boolean;
  v_lp_error text;
  v_lp_id uuid;
  v_company_id uuid;
  v_phone_norm text;
  v_email_norm text;
  v_name text;
  v_signal_id uuid;
  v_lead_id integer;
BEGIN
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false; error_code := 'INVALID_TRACKING_CODE';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    v_tracking_code := btrim(p_tracking_code)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    success := false; error_code := 'INVALID_TRACKING_CODE';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END;

  IF p_persistent_visitor_id IS NULL OR btrim(p_persistent_visitor_id) = '' THEN
    success := false; error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    v_visitor := btrim(p_persistent_visitor_id)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    success := false; error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END;

  v_session := NULL;
  IF p_session_id IS NOT NULL AND btrim(p_session_id) <> '' THEN
    BEGIN
      v_session := btrim(p_session_id)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_session := NULL;
    END;
  END IF;

  SELECT r.success, r.error_code, r.landing_page_id, r.company_id
    INTO v_lp_ok, v_lp_error, v_lp_id, v_company_id
  FROM public.resolve_tracking_landing_page(v_tracking_code) r
  LIMIT 1;

  IF v_lp_ok IS NOT TRUE OR v_company_id IS NULL THEN
    success := false;
    error_code := COALESCE(v_lp_error, 'LANDING_PAGE_NOT_FOUND');
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_phone_norm := public.normalize_lead_phone_digits(p_phone);
  v_email_norm := NULLIF(LOWER(BTRIM(COALESCE(p_email, ''))), '');
  v_name := LEFT(NULLIF(BTRIM(COALESCE(p_name, '')), ''), 255);

  IF v_phone_norm IS NULL AND v_email_norm IS NULL THEN
    success := false; error_code := 'MISSING_CONTACT';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.lead_conversion_signals (
    company_id,
    tracking_code,
    landing_page_id,
    persistent_visitor_id,
    session_id,
    phone_norm,
    email_norm,
    name
  ) VALUES (
    v_company_id,
    v_tracking_code,
    v_lp_id,
    v_visitor,
    v_session,
    v_phone_norm,
    v_email_norm,
    v_name
  )
  RETURNING id INTO v_signal_id;

  -- Reverse link: recent lead without visitor_id (signal arrived after lead create)
  SELECT l.id INTO v_lead_id
  FROM public.leads l
  WHERE l.company_id = v_company_id
    AND l.deleted_at IS NULL
    AND (l.visitor_id IS NULL OR BTRIM(l.visitor_id) = '')
    AND (
      (v_phone_norm IS NOT NULL AND public.normalize_lead_phone_digits(l.phone) = v_phone_norm)
      OR (v_email_norm IS NOT NULL AND LOWER(BTRIM(COALESCE(l.email, ''))) = v_email_norm)
    )
    AND l.created_at >= (NOW() - INTERVAL '2 hours')
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET visitor_id = v_visitor::text, updated_at = NOW()
    WHERE id = v_lead_id
      AND company_id = v_company_id
      AND (visitor_id IS NULL OR BTRIM(visitor_id) = '');

    UPDATE public.leads l
    SET
      utm_source = COALESCE(l.utm_source, v.utm_source),
      utm_medium = COALESCE(l.utm_medium, v.utm_medium),
      campanha = COALESCE(l.campanha, v.utm_campaign),
      conjunto_anuncio = COALESCE(l.conjunto_anuncio, v.utm_content),
      anuncio = COALESCE(l.anuncio, v.utm_term),
      updated_at = NOW()
    FROM (
      SELECT vis.utm_source, vis.utm_medium, vis.utm_campaign, vis.utm_content, vis.utm_term
      FROM public.visitors vis
      WHERE vis.visitor_id = v_visitor
        AND (
          vis.utm_source IS NOT NULL OR vis.utm_medium IS NOT NULL OR vis.utm_campaign IS NOT NULL
          OR vis.utm_content IS NOT NULL OR vis.utm_term IS NOT NULL
        )
      ORDER BY vis.created_at ASC
      LIMIT 1
    ) v
    WHERE l.id = v_lead_id
      AND l.company_id = v_company_id;

    UPDATE public.lead_conversion_signals
    SET consumed_at = NOW(), lead_id = v_lead_id
    WHERE id = v_signal_id;
  END IF;

  success := true;
  error_code := NULL;
  signal_id := v_signal_id;
  company_id := v_company_id;
  linked_lead_id := v_lead_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    success := false; error_code := 'INTERNAL_ERROR';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_conversion_signal(text, text, text, text, text, text) IS
  'Pixel conversion signal. Resolves company via tracking code; optionally backfills recent lead.';

REVOKE ALL ON FUNCTION public.public_create_conversion_signal(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(text, text, text, text, text, text) TO service_role;

-- Consume unconsumed signal for a company+contact (used by webhook-lead before create)
CREATE OR REPLACE FUNCTION public.consume_conversion_signal_for_lead(
  p_company_id uuid,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  persistent_visitor_id uuid,
  signal_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_email_norm text;
  v_signal_id uuid;
  v_visitor uuid;
BEGIN
  IF p_company_id IS NULL THEN
    success := false; error_code := 'INVALID_COMPANY';
    persistent_visitor_id := NULL; signal_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_phone_norm := public.normalize_lead_phone_digits(p_phone);
  v_email_norm := NULLIF(LOWER(BTRIM(COALESCE(p_email, ''))), '');

  IF v_phone_norm IS NULL AND v_email_norm IS NULL THEN
    success := false; error_code := 'MISSING_CONTACT';
    persistent_visitor_id := NULL; signal_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT s.id, s.persistent_visitor_id
    INTO v_signal_id, v_visitor
  FROM public.lead_conversion_signals s
  WHERE s.company_id = p_company_id
    AND s.consumed_at IS NULL
    AND s.created_at >= (NOW() - INTERVAL '2 hours')
    AND (
      (v_phone_norm IS NOT NULL AND s.phone_norm = v_phone_norm)
      OR (v_email_norm IS NOT NULL AND s.email_norm = v_email_norm)
    )
  ORDER BY s.created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_signal_id IS NULL THEN
    success := false; error_code := 'SIGNAL_NOT_FOUND';
    persistent_visitor_id := NULL; signal_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.lead_conversion_signals
  SET consumed_at = NOW()
  WHERE id = v_signal_id;

  success := true;
  error_code := NULL;
  persistent_visitor_id := v_visitor;
  signal_id := v_signal_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    success := false; error_code := 'INTERNAL_ERROR';
    persistent_visitor_id := NULL; signal_id := NULL;
    RETURN NEXT; RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_conversion_signal_for_lead(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_conversion_signal_for_lead(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_conversion_signal_for_lead(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_conversion_signal_for_lead(uuid, text, text) TO service_role;
