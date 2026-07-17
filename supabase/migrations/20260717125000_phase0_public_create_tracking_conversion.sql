-- =============================================================================
-- Fase 0 / Lote 0B.6 — RPC canônica de criação de conversão
-- =============================================================================
-- Função:
--   public.public_create_tracking_conversion
--
-- Schema live/baseline de public.conversions (sem colunas conversion_* / metadata /
-- company_id):
--   visitor_id uuid NOT NULL FK → visitors.id
--   landing_page_id uuid NOT NULL FK → landing_pages.id
--   form_data jsonb NOT NULL DEFAULT '{}'
--   behavior_summary jsonb NOT NULL DEFAULT '{}'
--   engagement_score numeric(4,2) DEFAULT 0
--   time_to_convert integer DEFAULT 0
--   webhook_sent boolean DEFAULT false
--   webhook_response jsonb
--   converted_at timestamptz DEFAULT now()
--
-- Mapeamento do contrato canônico → colunas existentes:
--   form_data := metadata
--                || { conversion_type }                    -- sempre
--                || { conversion_value }                   -- só se NOT NULL
--     (parâmetros explícitos sobrescrevem chaves homônimas em metadata)
--   behavior_summary / engagement_score / time_to_convert → omitidos no INSERT
--     (defaults do schema: '{}', 0, 0)
--   company_id → somente no retorno (derivado do helper; não há coluna)
--
-- conversion_type: schema NÃO possui CHECK/enum — validação = obrigatório,
--   não vazio após trim (sem lista fechada inventada).
-- conversion_value: schema NÃO possui coluna — NULL permitido; se informado,
--   deve ser numeric finito (tipo do parâmetro); gravado em form_data.
--
-- Regras:
--   * IDs text → conversão segura (sem SQLERRM)
--   * visita só via public.resolve_tracking_visit
--   * session_id informado → match exato; NULL/blank → latest_visit
--   * conversions.visitor_id = visit_id (nunca persistent)
--   * landing_page_id só da resolução
--   * SECURITY DEFINER + SET search_path = public
--   * NÃO altera grants (0B.8) / RPCs legadas / schema
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_create_tracking_conversion(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text DEFAULT NULL,
  p_conversion_type text DEFAULT NULL,
  p_conversion_value numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  success boolean,
  error_code text,
  conversion_id uuid,
  visit_id uuid,
  persistent_visitor_id uuid,
  session_id uuid,
  landing_page_id uuid,
  company_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking_code uuid;
  v_persistent_visitor_id uuid;
  v_session_id uuid;
  v_conversion_type text;
  v_metadata jsonb;
  v_form_data jsonb;
  v_resolve record;
  v_conversion_id uuid;
BEGIN
  -- ---- conversão segura: tracking_code ----
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_tracking_code := btrim(p_tracking_code)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_TRACKING_CODE';
      conversion_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- conversão segura: persistent_visitor_id ----
  IF p_persistent_visitor_id IS NULL OR btrim(p_persistent_visitor_id) = '' THEN
    success := false;
    error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_persistent_visitor_id := btrim(p_persistent_visitor_id)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_PERSISTENT_VISITOR_ID';
      conversion_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  -- ---- session_id opcional ----
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    v_session_id := NULL;
  ELSE
    BEGIN
      v_session_id := btrim(p_session_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        success := false;
        error_code := 'INVALID_SESSION_ID';
        conversion_id := NULL;
        visit_id := NULL;
        persistent_visitor_id := NULL;
        session_id := NULL;
        landing_page_id := NULL;
        company_id := NULL;
        RETURN NEXT;
        RETURN;
    END;
  END IF;

  -- ---- conversion_type: obrigatório (sem enum no schema) ----
  v_conversion_type := NULLIF(btrim(p_conversion_type), '');
  IF v_conversion_type IS NULL THEN
    success := false;
    error_code := 'INVALID_CONVERSION_TYPE';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- conversion_value: NULL ok; se informado, rejeitar NaN/Infinity ----
  -- (PostgreSQL numeric raramente carrega NaN; guarda defensiva via text check)
  IF p_conversion_value IS NOT NULL THEN
    IF p_conversion_value::text IN ('NaN', 'Infinity', '-Infinity') THEN
      success := false;
      error_code := 'INVALID_CONVERSION_VALUE';
      conversion_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- ---- metadata: NULL → {}; não-objeto → INVALID_METADATA ----
  IF p_metadata IS NULL THEN
    v_metadata := '{}'::jsonb;
  ELSIF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    success := false;
    error_code := 'INVALID_METADATA';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  ELSE
    v_metadata := p_metadata;
  END IF;

  -- form_data final:
  --   1) todas as chaves de metadata
  --   2) conversion_type (sempre; sobrescreve se já existir em metadata)
  --   3) conversion_value somente se NOT NULL (sobrescreve se já existir)
  v_form_data := v_metadata || jsonb_build_object('conversion_type', v_conversion_type);
  IF p_conversion_value IS NOT NULL THEN
    v_form_data := v_form_data || jsonb_build_object('conversion_value', p_conversion_value);
  END IF;

  -- ---- resolve visita ----
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
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- insert: FK visitor_id = visit_id; landing_page_id da resolução ----
  -- Omitidos (defaults do schema): behavior_summary, engagement_score,
  -- time_to_convert, webhook_sent, converted_at.
  INSERT INTO public.conversions (
    visitor_id,
    landing_page_id,
    form_data
  ) VALUES (
    v_resolve.visit_id,
    v_resolve.landing_page_id,
    v_form_data
  )
  RETURNING id INTO v_conversion_id;

  IF v_conversion_id IS NULL THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  success := true;
  error_code := NULL;
  conversion_id := v_conversion_id;
  visit_id := v_resolve.visit_id;
  persistent_visitor_id := v_resolve.persistent_visitor_id;
  session_id := v_resolve.session_id;
  landing_page_id := v_resolve.landing_page_id;
  company_id := v_resolve.company_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    -- Intencional: não expor SQLERRM
    success := false;
    error_code := 'INTERNAL_ERROR';
    conversion_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_tracking_conversion(
  text, text, text, text, numeric, jsonb
) IS
  'CANONICAL tracking conversion (Fase 0 / 0B.6). Resolves visit via resolve_tracking_visit; conversions.visitor_id=visit_id; form_data=metadata||conversion_type[||conversion_value]; other columns use schema defaults. company_id returned from resolve only. Grants deferred to 0B.8.';

-- Grants: deliberadamente omitidos nesta migration — tratar no Lote 0B.8.
