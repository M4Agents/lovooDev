-- =============================================================================
-- Fase 0 / Lote 0B.4 — RPC canônica de criação de visita
-- =============================================================================
-- Função:
--   public.public_create_tracking_visit
--
-- Regras:
--   * IDs de entrada como text → conversão segura para uuid (sem erro nativo)
--   * resolve LP ativa via public.resolve_tracking_landing_page (não confia em
--     landing_page_id do cliente — parâmetro inexistente de propósito)
--   * grava visitors.visitor_id = persistent_visitor_id
--   * grava visitors.session_id = session_id
--   * device_type: NULLIF(TRIM(...), ''); só desktop|mobile|tablet
--   * demais textos: pass-through (NULL ou string, inclusive '')
--   * SECURITY DEFINER + SET search_path = public
--   * tabelas/funções qualificadas com public.
--   * erros estruturados via error_code — nunca SQLERRM
--   * NÃO altera grants (Lote 0B.8)
--   * NÃO modifica RPCs legadas
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_create_tracking_visit(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text,
  p_user_agent text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_screen_resolution text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_language text DEFAULT NULL
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
BEGIN
  -- ---- conversão segura: tracking_code ----
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_tracking_code := btrim(p_tracking_code)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_TRACKING_CODE';
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- conversão segura: persistent_visitor_id ----
  IF p_persistent_visitor_id IS NULL OR btrim(p_persistent_visitor_id) = '' THEN
    success := false;
    error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_persistent_visitor_id := btrim(p_persistent_visitor_id)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_PERSISTENT_VISITOR_ID';
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- conversão segura: session_id ----
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    success := false;
    error_code := 'INVALID_SESSION_ID';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_session_id := btrim(p_session_id)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_SESSION_ID';
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- device_type: vazio → NULL; preenchido → desktop|mobile|tablet ----
  v_device := NULLIF(TRIM(p_device_type), '');
  IF v_device IS NOT NULL
     AND v_device NOT IN ('desktop', 'mobile', 'tablet') THEN
    success := false;
    error_code := 'INVALID_DEVICE_TYPE';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- resolve landing page ativa (tenant via company_id da LP no helper) ----
  -- company_id é resolvido no helper, mas não é retornado ao caller público.
  SELECT r.success, r.error_code, r.landing_page_id
    INTO v_lp_ok, v_lp_error, v_lp_id
  FROM public.resolve_tracking_landing_page(v_tracking_code) r
  LIMIT 1;

  IF v_lp_ok IS NOT TRUE THEN
    success := false;
    -- Propaga INVALID_TRACKING_CODE / LANDING_PAGE_NOT_FOUND / LANDING_PAGE_INACTIVE
    error_code := COALESCE(v_lp_error, 'LANDING_PAGE_NOT_FOUND');
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- insert: landing_page_id só do helper; nunca do cliente ----
  -- Demais textos (user_agent, screen_resolution, referrer, timezone, language):
  -- pass-through sem TRIM/NULLIF — NULL permanece NULL; '' permanece ''.
  INSERT INTO public.visitors (
    landing_page_id,
    session_id,
    visitor_id,
    user_agent,
    device_type,
    screen_resolution,
    referrer,
    timezone,
    language
  ) VALUES (
    v_lp_id,
    v_session_id,
    v_persistent_visitor_id,
    p_user_agent,
    v_device,
    p_screen_resolution,
    p_referrer,
    p_timezone,
    p_language
  )
  RETURNING id INTO v_visit_id;

  IF v_visit_id IS NULL THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
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
    -- Intencional: não expor SQLERRM
    success := false;
    error_code := 'INTERNAL_ERROR';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text
) IS
  'CANONICAL tracking visit create (Fase 0 / 0B.4). IDs as text with safe UUID parse; visitor_id=persistent; session_id set; landing_page from tracking_code only. Grants deferred to 0B.8.';

-- Grants: deliberadamente omitidos nesta migration — tratar no Lote 0B.8.
