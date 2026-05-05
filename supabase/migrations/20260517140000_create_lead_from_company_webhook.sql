-- =============================================================================
-- Migration: Fase 2 — RPC create_lead_from_company
--
-- Substitui public_create_lead_webhook (que aceitava api_key + resolvia empresa)
-- por uma RPC que recebe p_company_id já resolvido e validado pelo backend.
--
-- Segurança:
--   • Restrita a service_role/postgres — REVOKE de anon e authenticated
--   • p_company_id nunca vem do payload externo; vem do lookup seguro via
--     service_role (companies.api_key → id) no handler webhook-lead.js
--
-- Atomicidade:
--   • pg_advisory_xact_lock('lead_create:' + company_id) serializa requisições
--     concorrentes da mesma empresa dentro desta transação
--   • Verificação de max_leads + INSERT acontecem na mesma transação — sem TOCTOU
--   • Chave de lock distinta do rate limiting ('lead_create:' prefix)
--
-- Compatibilidade:
--   • public_create_lead_webhook permanece intocada (outros paths podem usá-la)
--   • output idêntico: { success, lead_id, company_id, is_duplicate, duplicate_of_lead_id }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_lead_from_company(
  p_company_id  UUID,
  lead_data     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_status  TEXT;
  v_max_leads       INTEGER;
  v_current_leads   BIGINT;
  v_phone           TEXT;
  v_email           TEXT;
  v_phone_norm      TEXT;
  v_existing_id     INTEGER;
  v_lead_id         INTEGER;
BEGIN
  -- ── 1. Lock por empresa: serializa criações concorrentes ─────────────────
  -- Chave com prefix 'lead_create:' para não colidir com locks de rate limit
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create:' || p_company_id::TEXT, 0)
  );

  -- ── 2. Validar que a empresa existe e está ativa ──────────────────────────
  SELECT status INTO v_company_status
  FROM public.companies
  WHERE id = p_company_id;

  IF NOT FOUND OR v_company_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'company_not_found'
    );
  END IF;

  -- ── 3. Verificação atômica de limite de plano ─────────────────────────────
  -- NULL = ilimitado → prossegue sem contagem
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

  -- ── 4. Verificação de duplicata por telefone ──────────────────────────────
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

  -- ── 5. Verificação de duplicata por email ─────────────────────────────────
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
    RETURN jsonb_build_object(
      'success',              true,
      'lead_id',              v_existing_id,
      'company_id',           p_company_id,
      'is_duplicate',         true,
      'duplicate_of_lead_id', v_existing_id
    );
  END IF;

  -- ── 6. Inserção do lead ───────────────────────────────────────────────────
  INSERT INTO public.leads (
    company_id, name, email, phone, interest,
    company_name, company_cnpj, company_email, visitor_id,
    status, origin,
    campanha, conjunto_anuncio, anuncio, utm_medium,
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
    lead_data->>'campanha',
    lead_data->>'conjunto_anuncio',
    lead_data->>'anuncio',
    lead_data->>'utm_medium',
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
$$;

-- ── Permissões: somente service_role e postgres ───────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM authenticated;
-- service_role e postgres mantêm acesso via privilege padrão de superuser/service_role
