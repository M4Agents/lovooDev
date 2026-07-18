-- Lote B: persist first-touch utm_source on leads + first lead_entry
-- Retrocompatível com webhook/produção ainda sem a chave no JSONB.
-- Não executar backfill. Não alterar policies.

-- 1) Coluna aditiva
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS utm_source character varying(255);

COMMENT ON COLUMN public.leads.utm_source IS
  'First-touch UTM source captured during lead creation';

-- 2) RPC create_lead_from_company — mesma assinatura (uuid, jsonb)
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
        campanha         = COALESCE(NULLIF(trim(lead_data->>'campanha'),              ''), campanha),
        conjunto_anuncio = COALESCE(NULLIF(trim(lead_data->>'conjunto_anuncio'),      ''), conjunto_anuncio),
        anuncio          = COALESCE(NULLIF(trim(lead_data->>'anuncio'),               ''), anuncio),
        utm_medium       = COALESCE(NULLIF(trim(lead_data->>'utm_medium'),            ''), utm_medium),
        utm_source       = COALESCE(NULLIF(trim(lead_data->>'utm_source'),            ''), utm_source),
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
    lead_data->>'campanha',
    lead_data->>'conjunto_anuncio',
    lead_data->>'anuncio',
    lead_data->>'utm_medium',
    NULLIF(BTRIM(lead_data->>'utm_source'), ''),
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

-- Grants: somente service_role (e postgres via ownership). Sem PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_from_company(UUID, JSONB) TO service_role;

-- 3) Primeira lead_entry: origin_channel a partir de NEW.utm_source
CREATE OR REPLACE FUNCTION public.create_initial_lead_entry_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_is_duplicate BOOLEAN;
  v_source       TEXT;
BEGIN
  SELECT is_duplicate INTO v_is_duplicate FROM leads WHERE id = NEW.id;

  IF COALESCE(v_is_duplicate, false) THEN
    RETURN NEW;
  END IF;

  v_source := CASE NEW.origin
    WHEN 'webhook_ultra_simples' THEN 'webhook'
    WHEN 'whatsapp'              THEN 'whatsapp'
    WHEN 'api'                   THEN 'webhook'
    WHEN 'instagram'             THEN 'instagram'
    ELSE                              'manual'
  END;

  INSERT INTO lead_entries (
    company_id,
    lead_id,
    source,
    origin_channel,
    external_event_id,
    idempotency_key,
    metadata,
    created_at
  ) VALUES (
    NEW.company_id,
    NEW.id,
    v_source,
    NULLIF(BTRIM(NEW.utm_source), ''),
    NULL,
    'init_' || NEW.id::text,
    '{}',
    NEW.created_at
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;
