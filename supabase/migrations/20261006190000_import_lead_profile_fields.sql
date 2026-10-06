-- Grava os campos padrão do cadastro de lead recebidos pela API de importação.
-- CREATE OR REPLACE mantém a assinatura (uuid, jsonb) e os privilégios atuais.

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
  v_visitor_text       TEXT;
  v_visitor_uuid       UUID;
  v_utm_source         TEXT;
  v_utm_medium         TEXT;
  v_campanha           TEXT;
  v_conjunto_anuncio   TEXT;
  v_anuncio            TEXT;
  v_vis_source         TEXT;
  v_vis_medium         TEXT;
  v_vis_campaign       TEXT;
  v_vis_content        TEXT;
  v_vis_term           TEXT;
  v_lock_key           TEXT;
  v_birth              DATE;
  v_estado             TEXT;
  v_company_estado     TEXT;
BEGIN
  v_phone := NULLIF(BTRIM(lead_data->>'phone'), '');
  v_email := NULLIF(BTRIM(lead_data->>'email'), '');

  IF v_phone IS NOT NULL THEN
    v_phone_norm := public.canonicalize_br_mobile_phone(v_phone);
  END IF;

  v_lock_key := COALESCE(
    NULLIF(v_phone_norm, ''),
    NULLIF(lower(COALESCE(v_email, '')), ''),
    'nokey'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create:' || p_company_id::TEXT || ':' || v_lock_key, 0)
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

  v_utm_source       := NULLIF(BTRIM(lead_data->>'utm_source'), '');
  v_utm_medium       := NULLIF(BTRIM(lead_data->>'utm_medium'), '');
  v_campanha         := NULLIF(BTRIM(lead_data->>'campanha'), '');
  v_conjunto_anuncio := NULLIF(BTRIM(lead_data->>'conjunto_anuncio'), '');
  v_anuncio          := NULLIF(BTRIM(lead_data->>'anuncio'), '');

  v_visitor_text := NULLIF(BTRIM(lead_data->>'visitor_id'), '');
  IF v_visitor_text IS NOT NULL
     AND (
       v_utm_source IS NULL OR v_utm_medium IS NULL OR v_campanha IS NULL
       OR v_conjunto_anuncio IS NULL OR v_anuncio IS NULL
     )
  THEN
    BEGIN
      v_visitor_uuid := v_visitor_text::uuid;
      SELECT v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term
        INTO v_vis_source, v_vis_medium, v_vis_campaign, v_vis_content, v_vis_term
      FROM public.visitors v
      WHERE v.visitor_id = v_visitor_uuid
        AND (
          v.utm_source IS NOT NULL OR v.utm_medium IS NOT NULL OR v.utm_campaign IS NOT NULL
          OR v.utm_content IS NOT NULL OR v.utm_term IS NOT NULL
        )
      ORDER BY v.created_at ASC
      LIMIT 1;

      IF FOUND THEN
        v_utm_source       := COALESCE(v_utm_source, v_vis_source);
        v_utm_medium       := COALESCE(v_utm_medium, v_vis_medium);
        v_campanha         := COALESCE(v_campanha, v_vis_campaign);
        v_conjunto_anuncio := COALESCE(v_conjunto_anuncio, v_vis_content);
        v_anuncio          := COALESCE(v_anuncio, v_vis_term);
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;

  v_birth := NULL;
  IF NULLIF(BTRIM(lead_data->>'data_nascimento'), '') IS NOT NULL THEN
    BEGIN
      v_birth := BTRIM(lead_data->>'data_nascimento')::date;
    EXCEPTION WHEN OTHERS THEN
      v_birth := NULL;
    END;
  END IF;

  v_estado := upper(NULLIF(BTRIM(lead_data->>'estado'), ''));
  IF v_estado IS NULL OR v_estado !~ '^[A-Z]{2}$' THEN
    v_estado := NULL;
  END IF;

  v_company_estado := upper(NULLIF(BTRIM(lead_data->>'company_estado'), ''));
  IF v_company_estado IS NULL OR v_company_estado !~ '^[A-Z]{2}$' THEN
    v_company_estado := NULL;
  END IF;

  IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
    SELECT id INTO v_existing_id
    FROM public.leads
    WHERE company_id = p_company_id
      AND deleted_at IS NULL
      AND phone IS NOT NULL AND trim(phone) != ''
      AND (
        phone_normalized = v_phone_norm
        OR public.canonicalize_br_mobile_phone(phone) = v_phone_norm
      )
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.leads
    WHERE company_id = p_company_id
      AND lower(trim(email)) = lower(v_email)
      AND email IS NOT NULL AND trim(email) != ''
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    IF v_phone_norm IS NOT NULL THEN
      UPDATE public.leads
      SET phone = v_phone_norm,
          updated_at = NOW()
      WHERE id = v_existing_id
        AND company_id = p_company_id
        AND phone IS DISTINCT FROM v_phone_norm;
    END IF;

    IF v_update_on_reentry THEN
      UPDATE public.leads SET
        name = CASE
          WHEN NULLIF(trim(lead_data->>'name'), '') IS NOT NULL
           AND trim(lead_data->>'name') IS DISTINCT FROM 'Lead sem nome'
          THEN trim(lead_data->>'name')
          ELSE name
        END,
        email            = COALESCE(NULLIF(trim(lower(lead_data->>'email')),          ''), email),
        phone            = COALESCE(NULLIF(v_phone_norm, ''), phone),
        interest         = COALESCE(NULLIF(trim(lead_data->>'interest'),              ''), interest),
        company_name     = COALESCE(NULLIF(trim(lead_data->>'company_name'),          ''), company_name),
        company_cnpj     = COALESCE(NULLIF(trim(lead_data->>'company_cnpj'),          ''), company_cnpj),
        company_email    = COALESCE(NULLIF(trim(lower(lead_data->>'company_email')), ''), company_email),
        company_razao_social  = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_razao_social'), 500), ''), company_razao_social),
        company_nome_fantasia = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_nome_fantasia'), 500), ''), company_nome_fantasia),
        company_telefone      = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_telefone'), 15), ''), company_telefone),
        company_site          = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_site'), 500), ''), company_site),
        company_cep           = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_cep'), 9), ''), company_cep),
        company_cidade        = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_cidade'), 255), ''), company_cidade),
        company_estado        = COALESCE(v_company_estado, company_estado),
        company_endereco      = COALESCE(NULLIF(left(BTRIM(lead_data->>'company_endereco'), 500), ''), company_endereco),
        cargo                 = COALESCE(NULLIF(left(BTRIM(lead_data->>'cargo'), 255), ''), cargo),
        instagram             = COALESCE(NULLIF(left(BTRIM(lead_data->>'instagram'), 255), ''), instagram),
        linkedin              = COALESCE(NULLIF(left(BTRIM(lead_data->>'linkedin'), 255), ''), linkedin),
        tiktok                = COALESCE(NULLIF(left(BTRIM(lead_data->>'tiktok'), 255), ''), tiktok),
        poder_investimento    = COALESCE(NULLIF(left(BTRIM(lead_data->>'poder_investimento'), 50), ''), poder_investimento),
        data_nascimento       = COALESCE(v_birth, data_nascimento),
        record_type           = COALESCE(NULLIF(left(BTRIM(lead_data->>'record_type'), 50), ''), record_type),
        cep                   = COALESCE(NULLIF(left(BTRIM(lead_data->>'cep'), 10), ''), cep),
        estado                = COALESCE(v_estado, estado),
        cidade                = COALESCE(NULLIF(left(BTRIM(lead_data->>'cidade'), 255), ''), cidade),
        endereco              = COALESCE(NULLIF(left(BTRIM(lead_data->>'endereco'), 255), ''), endereco),
        numero                = COALESCE(NULLIF(left(BTRIM(lead_data->>'numero'), 20), ''), numero),
        bairro                = COALESCE(NULLIF(left(BTRIM(lead_data->>'bairro'), 255), ''), bairro),
        complemento           = COALESCE(NULLIF(left(BTRIM(lead_data->>'complemento'), 255), ''), complemento),
        campanha         = COALESCE(v_campanha, campanha),
        conjunto_anuncio = COALESCE(v_conjunto_anuncio, conjunto_anuncio),
        anuncio          = COALESCE(v_anuncio, anuncio),
        utm_medium       = COALESCE(v_utm_medium, utm_medium),
        utm_source       = COALESCE(v_utm_source, utm_source),
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
    company_razao_social, company_nome_fantasia, company_telefone, company_site,
    company_cep, company_cidade, company_estado, company_endereco,
    cargo, instagram, linkedin, tiktok, poder_investimento, data_nascimento, record_type,
    cep, estado, cidade, endereco, numero, bairro, complemento,
    status, origin,
    campanha, conjunto_anuncio, anuncio, utm_medium, utm_source,
    created_at
  ) VALUES (
    p_company_id,
    COALESCE(lead_data->>'name', 'Lead sem nome'),
    lead_data->>'email',
    v_phone_norm,
    lead_data->>'interest',
    lead_data->>'company_name',
    lead_data->>'company_cnpj',
    lead_data->>'company_email',
    lead_data->>'visitor_id',
    NULLIF(left(BTRIM(lead_data->>'company_razao_social'), 500), ''),
    NULLIF(left(BTRIM(lead_data->>'company_nome_fantasia'), 500), ''),
    NULLIF(left(BTRIM(lead_data->>'company_telefone'), 15), ''),
    NULLIF(left(BTRIM(lead_data->>'company_site'), 500), ''),
    NULLIF(left(BTRIM(lead_data->>'company_cep'), 9), ''),
    NULLIF(left(BTRIM(lead_data->>'company_cidade'), 255), ''),
    v_company_estado,
    NULLIF(left(BTRIM(lead_data->>'company_endereco'), 500), ''),
    NULLIF(left(BTRIM(lead_data->>'cargo'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'instagram'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'linkedin'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'tiktok'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'poder_investimento'), 50), ''),
    v_birth,
    NULLIF(left(BTRIM(lead_data->>'record_type'), 50), ''),
    NULLIF(left(BTRIM(lead_data->>'cep'), 10), ''),
    v_estado,
    NULLIF(left(BTRIM(lead_data->>'cidade'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'endereco'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'numero'), 20), ''),
    NULLIF(left(BTRIM(lead_data->>'bairro'), 255), ''),
    NULLIF(left(BTRIM(lead_data->>'complemento'), 255), ''),
    'novo',
    'webhook_ultra_simples',
    v_campanha,
    v_conjunto_anuncio,
    v_anuncio,
    v_utm_medium,
    v_utm_source,
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
