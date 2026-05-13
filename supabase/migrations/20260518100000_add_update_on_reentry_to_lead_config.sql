-- =============================================================================
-- Migration: Adiciona update_on_reentry à configuração de leads duplicados
--
-- Alterações:
--   1. Atualiza DEFAULT da coluna duplicate_lead_config em company_lead_config
--   2. Backfill NULL-safe para linhas existentes sem a nova chave
--   3. Recria create_lead_from_company (CREATE OR REPLACE) com lógica de
--      atualização parcial quando update_on_reentry = true.
--      Preservados: SECURITY DEFINER, search_path, advisory lock, grants,
--      assinatura original e todo o fluxo existente.
-- =============================================================================

-- ── 1. Novo DEFAULT da coluna ──────────────────────────────────────────────
ALTER TABLE company_lead_config
  ALTER COLUMN duplicate_lead_config
  SET DEFAULT '{
    "won": "NEW_OPPORTUNITY",
    "lost": "REOPEN",
    "open": "EVENT_ONLY",
    "update_on_reentry": false
  }';

-- ── 2. Backfill NULL-safe para linhas existentes ────────────────────────────
-- COALESCE garante que linhas com NULL também recebam o campo
UPDATE company_lead_config
SET duplicate_lead_config =
  COALESCE(duplicate_lead_config, '{}'::jsonb)
  || '{"update_on_reentry": false}'::jsonb
WHERE duplicate_lead_config IS NULL
   OR NOT (duplicate_lead_config ? 'update_on_reentry');

-- ── 3. Recriar create_lead_from_company (mudança mínima e retrocompatível) ──
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
  v_company_status     TEXT;
  v_max_leads          INTEGER;
  v_current_leads      BIGINT;
  v_phone              TEXT;
  v_email              TEXT;
  v_phone_norm         TEXT;
  v_existing_id        INTEGER;
  v_lead_id            INTEGER;
  v_update_on_reentry  BOOLEAN := false;
BEGIN
  -- ── 1. Lock por empresa: serializa criações concorrentes ─────────────────
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create:' || p_company_id::TEXT, 0)
  );

  -- ── 2. Validar existência da empresa ─────────────────────────────────────
  SELECT status INTO v_company_status
  FROM public.companies
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  -- ── 3. Validar que a empresa está ativa ───────────────────────────────────
  -- Valores possíveis: 'active', 'suspended', 'cancelled'
  IF v_company_status IN ('suspended', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'company_inactive',
      'status',  v_company_status
    );
  END IF;

  -- Para qualquer status desconhecido além de 'active', bloquear
  IF v_company_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_inactive');
  END IF;

  -- ── 4. Verificação atômica de limite de plano ─────────────────────────────
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

  -- ── 5. Ler configuração de reentrada (fallback conservador: false) ─────────
  -- Caso a empresa não possua linha em company_lead_config, COALESCE garante false
  SELECT COALESCE(
    (duplicate_lead_config->>'update_on_reentry')::boolean,
    false
  )
  INTO v_update_on_reentry
  FROM company_lead_config
  WHERE company_id = p_company_id;

  v_update_on_reentry := COALESCE(v_update_on_reentry, false);

  -- ── 6. Verificação de duplicata por telefone ──────────────────────────────
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

  -- ── 7. Verificação de duplicata por email ─────────────────────────────────
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
    -- Atualização parcial opcional: somente quando update_on_reentry = true.
    -- Nunca altera: status, origin, visitor_id, created_at.
    -- WHERE garante isolamento multi-tenant: id + company_id obrigatórios.
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
        campanha         = COALESCE(NULLIF(trim(lead_data->>'campanha'),              ''), campanha),
        conjunto_anuncio = COALESCE(NULLIF(trim(lead_data->>'conjunto_anuncio'),      ''), conjunto_anuncio),
        anuncio          = COALESCE(NULLIF(trim(lead_data->>'anuncio'),               ''), anuncio),
        utm_medium       = COALESCE(NULLIF(trim(lead_data->>'utm_medium'),            ''), utm_medium),
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

  -- ── 8. Inserção do lead ───────────────────────────────────────────────────
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

-- Permissões mantidas: somente service_role e postgres
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM authenticated;
