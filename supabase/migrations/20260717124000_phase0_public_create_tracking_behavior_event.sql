-- =============================================================================
-- Fase 0 / Lote 0B.5 — RPC canônica de criação de behavior event
-- =============================================================================
-- Função:
--   public.public_create_tracking_behavior_event
--
-- Regras:
--   * IDs text → conversão segura para uuid (sem erro nativo / SQLERRM)
--   * resolve visita via public.resolve_tracking_visit (escopo LP/tenant)
--   * session_id informado → match exato (sem fallback); NULL/blank → latest_visit
--   * behavior_events.visitor_id = visit_id (NUNCA persistent_visitor_id)
--   * sem parâmetros landing_page_id / company_id do cliente
--   * event_type: exatamente o CHECK baseline
--       ('click','scroll','hover','form_interaction','page_view','section_view')
--   * event_data:
--       NULL → {}; jsonb object → preservar; não-objeto → INVALID_EVENT_DATA
--   * page_url: NULL/vazio não adiciona chave; preenchido grava/sobrescreve
--       event_data.page_url (parâmetro explícito tem precedência)
--   * SECURITY DEFINER + SET search_path = public
--   * NÃO altera grants (Lote 0B.8)
--   * NÃO modifica RPCs legadas
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_create_tracking_behavior_event(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_event_data jsonb DEFAULT '{}'::jsonb,
  p_page_url text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  event_id uuid,
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
  v_event_type text;
  v_event_data jsonb;
  v_resolve record;
  v_event_id uuid;
BEGIN
  -- ---- conversão segura: tracking_code ----
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    event_id := NULL;
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
      event_id := NULL;
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
    event_id := NULL;
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
      event_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- session_id opcional: blank → NULL; malformado → INVALID_SESSION_ID ----
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    v_session_id := NULL;
  ELSE
    BEGIN
      v_session_id := btrim(p_session_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        success := false;
        error_code := 'INVALID_SESSION_ID';
        event_id := NULL;
        visit_id := NULL;
        persistent_visitor_id := NULL;
        session_id := NULL;
        landing_page_id := NULL;
        RETURN NEXT;
        RETURN;
    END;
  END IF;

  -- ---- event_type: obrigatório; lista = CHECK baseline (sem ampliar/reduzir) ----
  -- CHECK: event_type IN ('click','scroll','hover','form_interaction','page_view','section_view')
  v_event_type := NULLIF(btrim(p_event_type), '');
  IF v_event_type IS NULL
     OR v_event_type NOT IN (
       'click',
       'scroll',
       'hover',
       'form_interaction',
       'page_view',
       'section_view'
     ) THEN
    success := false;
    error_code := 'INVALID_EVENT_TYPE';
    event_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- event_data determinístico ----
  -- NULL → {}; object → preservar; array/string/number/boolean/null-json → INVALID_EVENT_DATA
  IF p_event_data IS NULL THEN
    v_event_data := '{}'::jsonb;
  ELSIF jsonb_typeof(p_event_data) IS DISTINCT FROM 'object' THEN
    success := false;
    error_code := 'INVALID_EVENT_DATA';
    event_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  ELSE
    v_event_data := p_event_data;
  END IF;

  -- ---- page_url: NULL/vazio não adiciona; preenchido sobrescreve chave existente ----
  IF p_page_url IS NOT NULL AND btrim(p_page_url) <> '' THEN
    -- operador || em jsonb object: chaves da direita sobrescrevem as da esquerda
    v_event_data := v_event_data || jsonb_build_object('page_url', btrim(p_page_url));
  END IF;

  -- ---- resolve visita (LP ativa + persistent [+ session exato se informado]) ----
  SELECT r.*
    INTO v_resolve
  FROM public.resolve_tracking_visit(
    v_tracking_code,
    v_persistent_visitor_id,
    v_session_id
  ) r
  LIMIT 1;

  IF v_resolve.success IS NOT TRUE THEN
    success := false;
    error_code := COALESCE(v_resolve.error_code, 'VISIT_NOT_FOUND');
    event_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- insert: FK = visit_id (visitors.id), nunca persistent ----
  INSERT INTO public.behavior_events (
    visitor_id,
    event_type,
    event_data
  ) VALUES (
    v_resolve.visit_id,
    v_event_type,
    v_event_data
  )
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    event_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  success := true;
  error_code := NULL;
  event_id := v_event_id;
  visit_id := v_resolve.visit_id;
  persistent_visitor_id := v_resolve.persistent_visitor_id;
  session_id := v_resolve.session_id;
  landing_page_id := v_resolve.landing_page_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    -- Intencional: não expor SQLERRM
    success := false;
    error_code := 'INTERNAL_ERROR';
    event_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_tracking_behavior_event(
  text, text, text, text, jsonb, text
) IS
  'CANONICAL tracking behavior event (Fase 0 / 0B.5). Resolves visit via resolve_tracking_visit; FK visitor_id=visit_id. event_data must be JSON object (NULL→{}); page_url param overwrites event_data.page_url. Grants deferred to 0B.8.';

-- Grants: deliberadamente omitidos nesta migration — tratar no Lote 0B.8.
