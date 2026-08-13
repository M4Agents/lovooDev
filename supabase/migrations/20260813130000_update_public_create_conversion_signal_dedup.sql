-- =============================================================================
-- Migration: public_create_conversion_signal — idempotência por checkout_id
--
-- Problema: adicionar p_checkout_id com CREATE OR REPLACE criaria um overload
-- de 7 params coexistindo com o OID original de 6 params → ambiguidade no
-- PostgreSQL para chamadas com named parameters → quebra de callers legados.
--
-- Solução: DROP explícito da assinatura de 6 params antes do CREATE, garantindo
-- UMA ÚNICA assinatura após a migration.
--
-- Compatibilidade legada:
--   p_checkout_id DEFAULT NULL → callers sem esse param continuam funcionando
--   sem nenhuma modificação (api/conversion-signal.js).
--
-- Acréscimos funcionais (únicos):
--   1. p_checkout_id text DEFAULT NULL
--   2. Dedup rápido (SELECT) antes do INSERT quando checkout_id IS NOT NULL
--   3. Handler específico de unique_violation no INSERT para concorrência
--
-- Toda a lógica original é preservada fielmente:
--   resolve_tracking_landing_page, validações, normalização, INSERT,
--   reverse-link lead <2h, first-touch UTM via COALESCE, consumed_at,
--   lead_id, EXCEPTION WHEN OTHERS.
-- =============================================================================

-- PASSO 1: remover overload de 6 params para evitar ambiguidade.
-- Assinatura exata com os tipos reais (text×6), ignorando defaults.
-- IF EXISTS garante idempotência da própria migration.
DROP FUNCTION IF EXISTS public.public_create_conversion_signal(
  text, text, text, text, text, text
);

-- PASSO 2: criar a função de 7 params — única versão após a migration.
CREATE OR REPLACE FUNCTION public.public_create_conversion_signal(
  p_tracking_code          text,
  p_persistent_visitor_id  text,
  p_session_id             text DEFAULT NULL,
  p_phone                  text DEFAULT NULL,
  p_email                  text DEFAULT NULL,
  p_name                   text DEFAULT NULL,
  p_checkout_id            text DEFAULT NULL   -- NOVO: chave de idempotência Nuvemshop
)
RETURNS TABLE (
  success         boolean,
  error_code      text,
  signal_id       uuid,
  company_id      uuid,
  linked_lead_id  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tracking_code uuid;
  v_visitor       uuid;
  v_session       uuid;
  v_lp_ok         boolean;
  v_lp_error      text;
  v_lp_id         uuid;
  v_company_id    uuid;
  v_phone_norm    text;
  v_email_norm    text;
  v_name          text;
  v_signal_id     uuid;
  v_lead_id       integer;
  v_checkout_id   text;
BEGIN
  -- ── Validação: tracking_code ──────────────────────────────────────────────
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

  -- ── Validação: persistent_visitor_id ─────────────────────────────────────
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

  -- ── session_id (opcional) ─────────────────────────────────────────────────
  v_session := NULL;
  IF p_session_id IS NOT NULL AND btrim(p_session_id) <> '' THEN
    BEGIN
      v_session := btrim(p_session_id)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_session := NULL;
    END;
  END IF;

  -- ── Resolver landing page e company_id ────────────────────────────────────
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

  -- ── Normalizar checkout_id (NULL para signals sem contexto Nuvemshop) ─────
  v_checkout_id := NULLIF(BTRIM(COALESCE(p_checkout_id, '')), '');

  -- ── Dedup rápido por checkout (caminho rápido, não garante atomicidade) ───
  -- A garantia definitiva é a constraint UNIQUE parcial + handler de
  -- unique_violation no INSERT abaixo.
  -- Só executado quando checkout_id está presente (signals legados não entram).
  IF v_checkout_id IS NOT NULL THEN
    SELECT lcs.id, lcs.lead_id
      INTO v_signal_id, v_lead_id
    FROM public.lead_conversion_signals lcs
    WHERE lcs.company_id  = v_company_id
      AND lcs.checkout_id = v_checkout_id
    LIMIT 1;

    IF v_signal_id IS NOT NULL THEN
      -- Signal já existe para este checkout — retorno idempotente
      success := true; error_code := NULL;
      signal_id := v_signal_id; company_id := v_company_id; linked_lead_id := v_lead_id;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- ── Normalização de contato ───────────────────────────────────────────────
  v_phone_norm := public.normalize_lead_phone_digits(p_phone);
  v_email_norm := NULLIF(LOWER(BTRIM(COALESCE(p_email, ''))), '');
  v_name       := LEFT(NULLIF(BTRIM(COALESCE(p_name, '')), ''), 255);

  IF v_phone_norm IS NULL AND v_email_norm IS NULL THEN
    success := false; error_code := 'MISSING_CONTACT';
    signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- ── INSERT do signal com handler específico de concorrência ───────────────
  -- O bloco BEGIN...EXCEPTION interno captura apenas unique_violation (23505),
  -- que ocorre quando dois requests concorrentes passam pelo SELECT de dedup
  -- sem encontrar o registro e ambos tentam INSERT.
  -- unique_violation SÓ pode ser gerado aqui quando v_checkout_id IS NOT NULL
  -- (o índice UNIQUE é parcial: WHERE checkout_id IS NOT NULL).
  -- Para signals com checkout_id NULL, o INSERT nunca viola a constraint.
  BEGIN
    INSERT INTO public.lead_conversion_signals (
      company_id, tracking_code, landing_page_id, persistent_visitor_id,
      session_id, phone_norm, email_norm, name, checkout_id
    ) VALUES (
      v_company_id, v_tracking_code, v_lp_id, v_visitor,
      v_session, v_phone_norm, v_email_norm, v_name, v_checkout_id
    )
    RETURNING id INTO v_signal_id;

  EXCEPTION WHEN unique_violation THEN
    -- Concorrência: outro request chegou primeiro para o mesmo checkout.
    -- Recuperar o signal vencedor e retornar como idempotente.
    SELECT lcs.id, lcs.lead_id
      INTO v_signal_id, v_lead_id
    FROM public.lead_conversion_signals lcs
    WHERE lcs.company_id  = v_company_id
      AND lcs.checkout_id = v_checkout_id
    LIMIT 1;

    success := true; error_code := NULL;
    signal_id := v_signal_id; company_id := v_company_id; linked_lead_id := v_lead_id;
    RETURN NEXT; RETURN;
  END;

  -- ── Reverse-link: lead recente (<2h) sem visitor_id ──────────────────────
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
    -- Atribuir visitor_id ao lead (somente se ainda não preenchido)
    UPDATE public.leads
    SET visitor_id = v_visitor::text, updated_at = NOW()
    WHERE id = v_lead_id AND company_id = v_company_id
      AND (visitor_id IS NULL OR BTRIM(visitor_id) = '');

    -- First-touch UTM via COALESCE (não sobrescreve valores já presentes)
    UPDATE public.leads l
    SET
      utm_source       = COALESCE(l.utm_source,       v.utm_source),
      utm_medium       = COALESCE(l.utm_medium,       v.utm_medium),
      campanha         = COALESCE(l.campanha,         v.utm_campaign),
      conjunto_anuncio = COALESCE(l.conjunto_anuncio, v.utm_content),
      anuncio          = COALESCE(l.anuncio,          v.utm_term),
      updated_at       = NOW()
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
    WHERE l.id = v_lead_id AND l.company_id = v_company_id;

    -- Marcar signal como consumido e vincular ao lead
    UPDATE public.lead_conversion_signals
    SET consumed_at = NOW(), lead_id = v_lead_id
    WHERE id = v_signal_id;
  END IF;

  success := true; error_code := NULL;
  signal_id := v_signal_id; company_id := v_company_id; linked_lead_id := v_lead_id;
  RETURN NEXT; RETURN;

EXCEPTION WHEN OTHERS THEN
  -- Handler genérico para erros não previstos (não unique_violation,
  -- pois esse já é tratado no bloco interno do INSERT).
  success := false; error_code := 'INTERNAL_ERROR';
  signal_id := NULL; company_id := NULL; linked_lead_id := NULL;
  RETURN NEXT; RETURN;
END;
$$;

-- PASSO 3: reaplicar grants (DROP removeu os grants do OID antigo).
-- Reproduzindo exatamente o conjunto de grants da versão de 6 params:
--   anon, authenticated, service_role.
REVOKE ALL ON FUNCTION public.public_create_conversion_signal(
  text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(
  text, text, text, text, text, text, text
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(
  text, text, text, text, text, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.public_create_conversion_signal(
  text, text, text, text, text, text, text
) TO service_role;
