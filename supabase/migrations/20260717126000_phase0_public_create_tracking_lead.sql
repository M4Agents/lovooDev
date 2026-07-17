-- =============================================================================
-- Fase 0 / Lote 0B.7 — RPC canônica de criação de lead vinculada ao tracking
-- =============================================================================
-- Função:
--   public.public_create_tracking_lead
--
-- Schema live/baseline de public.leads (inventário relevante):
--   id                  smallint NOT NULL DEFAULT nextval('leads_id_seq')
--   company_id          uuid NOT NULL  FK → companies(id)
--   name                text NOT NULL
--   email               text NULL
--     CONSTRAINT valid_email:
--       CHECK ((email IS NULL) OR
--              (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'))
--   phone               text NULL
--   origin              text NULL DEFAULT 'manual'
--   status              text NULL DEFAULT 'novo'
--                       CHECK IN ('novo','em_qualificacao','convertido','perdido')
--   interest            text NULL
--   visitor_id          text NULL   ← persistent_visitor_id (SEM FK; NÃO é visit_id)
--   company_name        text NULL
--   company_cnpj        varchar(18) NULL
--   company_email       text NULL
--   campanha            varchar(255) NULL
--   conjunto_anuncio    varchar(255) NULL
--   anuncio             varchar(255) NULL
--   utm_medium          varchar NULL
--   record_type         varchar(50) NOT NULL DEFAULT 'Lead'
--   is_over_plan        boolean NOT NULL DEFAULT false
--   phone_normalized    text  GENERATED STORED  (não inserir)
--   created_at / updated_at  DEFAULT now()
--
-- Colunas AUSENTES no schema (não inventar / não gravar):
--   visit_id, landing_page_id, persistent_visitor_id, session_id como colunas
--   de leads — existem apenas no RETORNO. company_id do cliente é ignorado
--   (derivado só do helper).
--
-- Normalização:
--   name  → btrim; vazio → INVALID_LEAD_NAME; persiste normalizado
--   email → NULL/vazio após btrim → NULL; preenchido deve satisfazer o mesmo
--           predicado do CHECK valid_email; persiste o valor após btrim
--   demais campos de lead → pass-through (sem trim/lower inventado)
--
-- INSERT (colunas reais; defaults omitidos):
--   company_id, name, visitor_id,
--   email, phone, interest, company_name, company_cnpj, company_email,
--   campanha, conjunto_anuncio, anuncio, utm_medium
--   Omitidos: origin, status, record_type, is_over_plan, timestamps,
--             phone_normalized (GENERATED)
--
-- Regras:
--   * IDs text → conversão segura (sem SQLERRM)
--   * visita só via public.resolve_tracking_visit
--   * session_id informado → match exato; NULL/blank → latest_visit
--   * leads.visitor_id = persistent_visitor_id::text (nunca visit_id)
--   * company_id só da resolução
--   * SECURITY DEFINER + SET search_path = public
--   * NÃO altera grants (0B.8) / RPCs legadas / schema / RLS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_create_tracking_lead(
  p_tracking_code text,
  p_persistent_visitor_id text,
  p_session_id text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_interest text DEFAULT NULL,
  p_company_name text DEFAULT NULL,
  p_company_cnpj text DEFAULT NULL,
  p_company_email text DEFAULT NULL,
  p_campanha text DEFAULT NULL,
  p_conjunto_anuncio text DEFAULT NULL,
  p_anuncio text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error_code text,
  lead_id smallint,
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
  v_name text;
  v_email text;
  v_resolve record;
  v_lead_id smallint;
BEGIN
  -- ---- conversão segura: tracking_code ----
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    lead_id := NULL;
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
      lead_id := NULL;
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
    lead_id := NULL;
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
      lead_id := NULL;
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
        lead_id := NULL;
        visit_id := NULL;
        persistent_visitor_id := NULL;
        session_id := NULL;
        landing_page_id := NULL;
        company_id := NULL;
        RETURN NEXT;
        RETURN;
    END;
  END IF;

  -- ---- name: btrim; vazio → erro; persiste normalizado ----
  v_name := btrim(p_name);
  IF v_name IS NULL OR v_name = '' THEN
    success := false;
    error_code := 'INVALID_LEAD_NAME';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- email: NULL/vazio após btrim → NULL; senão CHECK valid_email exato ----
  -- Constraint live:
  --   CHECK ((email IS NULL) OR
  --          (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'))
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    v_email := NULL;
  ELSE
    v_email := btrim(p_email);
    IF NOT (v_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
      success := false;
      error_code := 'INVALID_LEAD_EMAIL';
      lead_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- ---- resolve visita (tenant / LP / visit / session) ----
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
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- insert: company_id da resolução; visitor_id = persistent (text) ----
  -- Nunca gravar visit_id em leads.visitor_id.
  -- Pass-through nos opcionais (sem trim/lower inventado).
  -- Omitidos (defaults físicos): origin, status, record_type, is_over_plan,
  -- timestamps. phone_normalized é GENERATED STORED — não inserir.
  INSERT INTO public.leads (
    company_id,
    name,
    visitor_id,
    email,
    phone,
    interest,
    company_name,
    company_cnpj,
    company_email,
    campanha,
    conjunto_anuncio,
    anuncio,
    utm_medium
  ) VALUES (
    v_resolve.company_id,
    v_name,
    v_persistent_visitor_id::text,
    v_email,
    p_phone,
    p_interest,
    p_company_name,
    p_company_cnpj,
    p_company_email,
    p_campanha,
    p_conjunto_anuncio,
    p_anuncio,
    p_utm_medium
  )
  RETURNING id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    lead_id := NULL;
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
  lead_id := v_lead_id;
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
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.public_create_tracking_lead(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'CANONICAL tracking lead (Fase 0 / 0B.7). Resolves visit via resolve_tracking_visit; leads.visitor_id=persistent_visitor_id::text (never visit_id); company_id from resolve only; landing_page_id/visit_id/session_id returned only (no columns on leads). Grants deferred to 0B.8.';

-- Grants: deliberadamente omitidos nesta migration — tratar no Lote 0B.8.
