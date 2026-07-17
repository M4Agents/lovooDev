-- =============================================================================
-- Fase 0 / Lote 0B.3 — Helpers internos de resolução de tracking
-- =============================================================================
-- Funções INTERNAS (não públicas):
--   public.resolve_tracking_landing_page
--   public.resolve_tracking_visit
--
-- Regras:
--   * SECURITY DEFINER + SET search_path = public
--   * tabelas qualificadas com public.
--   * nunca resolve visita só por UUID global
--   * sempre restringe por landing_page resolvida (tenant via company_id da LP)
--   * NÃO cria/altera visitas
--   * NÃO modifica RPCs legadas
--   * NÃO altera grants nesta migration (Lote 0B.8)
--   * erros estruturados via error_code — nunca SQLERRM
--
-- resolution_method:
--   * 'session'       — match EXATO por persistent + session_id + landing_page
--                       (sem fallback para latest_visit)
--   * 'latest_visit'  — somente quando p_session_id IS NULL
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) resolve_tracking_landing_page
-- ---------------------------------------------------------------------------
-- Fluxo:
--   1) buscar por tracking_code (qualquer status)
--   2) não existe     → LANDING_PAGE_NOT_FOUND
--   3) existe !active → LANDING_PAGE_INACTIVE
--   4) existe active  → success + landing_page_id + company_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tracking_landing_page(
  p_tracking_code uuid
)
RETURNS TABLE (
  success boolean,
  error_code text,
  landing_page_id uuid,
  company_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp_id uuid;
  v_company_id uuid;
  v_status text;
BEGIN
  IF p_tracking_code IS NULL THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 1) Busca primeiro pelo tracking_code (não filtra status aqui)
  SELECT lp.id, lp.company_id, lp.status
    INTO v_lp_id, v_company_id, v_status
  FROM public.landing_pages lp
  WHERE lp.tracking_code = p_tracking_code
  LIMIT 1;

  -- 2) Não existe
  IF v_lp_id IS NULL THEN
    success := false;
    error_code := 'LANDING_PAGE_NOT_FOUND';
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 3) Existe, mas não está ativa
  IF v_status IS DISTINCT FROM 'active' THEN
    success := false;
    error_code := 'LANDING_PAGE_INACTIVE';
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 4) Sucesso somente para landing page ativa
  success := true;
  error_code := NULL;
  landing_page_id := v_lp_id;
  company_id := v_company_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    -- Intencional: não expor SQLERRM
    success := false;
    error_code := 'INTERNAL_ERROR';
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.resolve_tracking_landing_page(uuid) IS
  'INTERNAL (Fase 0 / 0B.3). Resolves tracking_code → active landing_page_id + company_id. Grants deferred to 0B.8.';

-- ---------------------------------------------------------------------------
-- 2) resolve_tracking_visit
-- ---------------------------------------------------------------------------
-- Entrada:
--   p_tracking_code          → resolve LP ativa + company
--   p_persistent_visitor_id  → visitors.visitor_id
--   p_session_id             → opcional; se presente, match EXATO (sem fallback)
--
-- Nunca busca por visitors.id / visitor_id global sem landing_page_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tracking_visit(
  p_tracking_code uuid,
  p_persistent_visitor_id uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  visit_id uuid,
  persistent_visitor_id uuid,
  session_id uuid,
  landing_page_id uuid,
  company_id uuid,
  resolution_method text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp_ok boolean;
  v_lp_error text;
  v_lp_id uuid;
  v_company_id uuid;
  v_visit_id uuid;
  v_session_id uuid;
  v_persistent uuid;
BEGIN
  -- Validação de entrada (sem SQLERRM)
  IF p_tracking_code IS NULL THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    resolution_method := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_persistent_visitor_id IS NULL THEN
    success := false;
    error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    resolution_method := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Resolve LP/company (somente ativa)
  SELECT r.success, r.error_code, r.landing_page_id, r.company_id
    INTO v_lp_ok, v_lp_error, v_lp_id, v_company_id
  FROM public.resolve_tracking_landing_page(p_tracking_code) r
  LIMIT 1;

  IF v_lp_ok IS NOT TRUE THEN
    success := false;
    error_code := COALESCE(v_lp_error, 'LANDING_PAGE_NOT_FOUND');
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    resolution_method := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_session_id IS NOT NULL THEN
    -- Match EXATO: persistent + session + landing_page.
    -- Se falhar: VISIT_NOT_FOUND e RETURN — NUNCA cai em latest_visit.
    SELECT v.id, v.session_id, v.visitor_id
      INTO v_visit_id, v_session_id, v_persistent
    FROM public.visitors v
    WHERE v.visitor_id = p_persistent_visitor_id
      AND v.session_id = p_session_id
      AND v.landing_page_id = v_lp_id
    ORDER BY v.created_at DESC NULLS LAST, v.id DESC
    LIMIT 1;

    IF v_visit_id IS NULL THEN
      success := false;
      error_code := 'VISIT_NOT_FOUND';
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      resolution_method := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    success := true;
    error_code := NULL;
    visit_id := v_visit_id;
    persistent_visitor_id := v_persistent;
    session_id := v_session_id;
    landing_page_id := v_lp_id;
    company_id := v_company_id;
    resolution_method := 'session';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Somente quando p_session_id IS NULL: visita mais recente na mesma LP
  SELECT v.id, v.session_id, v.visitor_id
    INTO v_visit_id, v_session_id, v_persistent
  FROM public.visitors v
  WHERE v.visitor_id = p_persistent_visitor_id
    AND v.landing_page_id = v_lp_id
  ORDER BY v.created_at DESC NULLS LAST, v.id DESC
  LIMIT 1;

  IF v_visit_id IS NULL THEN
    success := false;
    error_code := 'VISIT_NOT_FOUND';
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    resolution_method := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  success := true;
  error_code := NULL;
  visit_id := v_visit_id;
  persistent_visitor_id := v_persistent;
  session_id := v_session_id;
  landing_page_id := v_lp_id;
  company_id := v_company_id;
  resolution_method := 'latest_visit';
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
    company_id := NULL;
    resolution_method := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.resolve_tracking_visit(uuid, uuid, uuid) IS
  'INTERNAL (Fase 0 / 0B.3). Resolves visit by tracking_code + persistent_visitor_id (+ optional session_id) scoped to landing_page/company. session_id requires exact match (no latest_visit fallback). Grants deferred to 0B.8.';

-- Grants: deliberadamente omitidos nesta migration — tratar no Lote 0B.8.
