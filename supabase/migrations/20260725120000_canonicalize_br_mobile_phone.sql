-- =====================================================
-- MIGRATION: Telefone canônico BR (9º dígito) + RPCs
-- Data: 2026-07-25
-- Objetivo:
--   1) Helper canonicalize_br_mobile_phone(text)
--   2) Dedupe/create/lookup por telefone canônico
--   3) Advisory lock por (company_id + phone_canonico)
--   4) Persistir phone sempre no formato canônico BR
-- =====================================================

-- ── 1. Helper canônico ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.canonicalize_br_mobile_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_digits text;
  v_subscriber text;
  v_first text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_digits := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');
  IF v_digits IS NULL OR v_digits = '' THEN
    RETURN NULL;
  END IF;

  -- Nacional sem DDI: 10 ou 11 dígitos → prefixar 55
  IF LENGTH(v_digits) IN (10, 11) THEN
    v_digits := '55' || v_digits;
  END IF;

  -- Móvel BR sem 9º dígito: 55 + DDD(2) + 8 dígitos (total 12)
  -- Insere 9 após o DDD somente se o 1º dígito do assinante for 6–9
  IF LENGTH(v_digits) = 12 AND LEFT(v_digits, 2) = '55' THEN
    v_subscriber := SUBSTRING(v_digits FROM 5 FOR 8);
    v_first := LEFT(v_subscriber, 1);
    IF v_first IN ('6', '7', '8', '9') THEN
      RETURN LEFT(v_digits, 4) || '9' || v_subscriber;
    END IF;
  END IF;

  -- Já canônico (55+DDD+9+8), fixo, internacional ou inválido: só dígitos
  RETURN v_digits;
END;
$$;

COMMENT ON FUNCTION public.canonicalize_br_mobile_phone(text) IS
  'Normaliza telefone móvel BR para 55+DDD+9+8 dígitos; fixo/internacional retorna só dígitos.';

REVOKE ALL ON FUNCTION public.canonicalize_br_mobile_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonicalize_br_mobile_phone(text) TO anon;
GRANT EXECUTE ON FUNCTION public.canonicalize_br_mobile_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_br_mobile_phone(text) TO service_role;

-- ── 2. normalize_lead_phone_digits delega ao canônico (mantém RIGHT(11)) ─────
CREATE OR REPLACE FUNCTION public.normalize_lead_phone_digits(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_canon text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_canon := public.canonicalize_br_mobile_phone(p_phone);
  IF v_canon IS NULL OR v_canon = '' THEN
    RETURN NULL;
  END IF;

  IF LENGTH(v_canon) > 11 THEN
    RETURN RIGHT(v_canon, 11);
  END IF;

  RETURN v_canon;
END;
$$;

-- ── 3. create_lead_from_company ──────────────────────────────────────────────
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
    -- Sempre alinhar phone ao canônico quando disponível
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

-- ── 4. create_lead_from_whatsapp_safe ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp_safe(
  p_company_id  uuid,
  p_phone       text,
  p_name        text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id            BIGINT;
  v_opportunity_id     UUID;
  v_existing_lead_id   BIGINT;
  v_funnel_id          UUID;
  v_stage_id           UUID;
  v_phone_normalized   TEXT;
  v_max_leads          INTEGER;
  v_current_leads      BIGINT;
  v_is_over_plan       BOOLEAN := FALSE;
  v_assigned_user_id   UUID;
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v8: empresa % telefone % instancia %',
    p_company_id, p_phone, p_instance_id;

  v_phone_normalized := public.canonicalize_br_mobile_phone(p_phone);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lead_create_wa:' || p_company_id::TEXT || ':' || COALESCE(v_phone_normalized, ''),
      0
    )
  );

  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
    )
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL THEN
    IF v_phone_normalized IS NOT NULL THEN
      UPDATE leads
      SET phone = v_phone_normalized,
          updated_at = NOW()
      WHERE id = v_existing_lead_id
        AND phone IS DISTINCT FROM v_phone_normalized;
    END IF;

    RAISE LOG 'create_lead_from_whatsapp_safe v8: Lead já existe ID %', v_existing_lead_id;
    RETURN jsonb_build_object(
      'success',      true,
      'lead_id',      v_existing_lead_id,
      'created',      false,
      'is_over_plan', false,
      'source',       'whatsapp',
      'message',      'Lead já existe para este telefone'
    );
  END IF;

  SELECT pl.max_leads
  INTO v_max_leads
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  IF v_max_leads IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_current_leads
    FROM public.leads
    WHERE company_id = p_company_id
      AND deleted_at IS NULL;

    IF v_current_leads >= v_max_leads THEN
      v_is_over_plan := TRUE;
      RAISE LOG 'create_lead_from_whatsapp_safe v8: empresa % acima do limite (atual=%, max=%)',
        p_company_id, v_current_leads, v_max_leads;
    END IF;
  END IF;

  IF p_instance_id IS NOT NULL THEN
    SELECT wli.assigned_user_id
    INTO   v_assigned_user_id
    FROM   whatsapp_life_instances wli
    WHERE  wli.id         = p_instance_id
      AND  wli.company_id = p_company_id
      AND  wli.deleted_at IS NULL
      AND  wli.assigned_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1
             FROM   company_users cu
             WHERE  cu.user_id    = wli.assigned_user_id
               AND  cu.company_id = p_company_id
               AND  cu.is_active  = true
           );
  END IF;

  INSERT INTO leads (
    company_id, phone, name, origin, status, record_type,
    is_over_plan, responsible_user_id, created_at, updated_at
  ) VALUES (
    p_company_id,
    v_phone_normalized,
    COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp',
    'novo',
    'Lead',
    v_is_over_plan,
    v_assigned_user_id,
    NOW(),
    NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v8: Lead criado ID % (is_over_plan=%, responsible_user_id=%)',
    v_lead_id, v_is_over_plan, v_assigned_user_id;

  SELECT id INTO v_funnel_id
  FROM sales_funnels
  WHERE company_id = p_company_id AND is_default = true AND is_active = true
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    SELECT id INTO v_funnel_id
    FROM sales_funnels
    WHERE company_id = p_company_id AND is_active = true
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_funnel_id IS NOT NULL THEN
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id ORDER BY position ASC LIMIT 1;

    IF v_stage_id IS NOT NULL THEN
      SELECT id INTO v_opportunity_id FROM opportunities WHERE lead_id = v_lead_id LIMIT 1;

      IF v_opportunity_id IS NULL THEN
        INSERT INTO opportunities (
          company_id, lead_id, title, status, source, created_at, updated_at
        ) VALUES (
          p_company_id, v_lead_id, 'Nova Oportunidade', 'open', 'whatsapp', NOW(), NOW()
        ) RETURNING id INTO v_opportunity_id;

        INSERT INTO opportunity_funnel_positions (
          lead_id, opportunity_id, funnel_id, stage_id,
          position_in_stage, entered_stage_at, updated_at
        ) VALUES (
          v_lead_id, v_opportunity_id, v_funnel_id, v_stage_id, 0, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',             true,
    'lead_id',             v_lead_id,
    'opportunity_id',      v_opportunity_id,
    'created',             true,
    'is_over_plan',        v_is_over_plan,
    'responsible_user_id', v_assigned_user_id,
    'source',              'whatsapp',
    'message',             CASE
                             WHEN v_is_over_plan
                             THEN 'Lead criado via WhatsApp (empresa acima do limite do plano)'
                             ELSE 'Lead criado com sucesso via WhatsApp'
                           END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_lead_from_whatsapp_safe v8: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 5. public_create_lead_webhook ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_create_lead_webhook(lead_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id        UUID;
  v_lead_id           INTEGER;
  v_api_key           TEXT;
  v_phone             TEXT;
  v_email             TEXT;
  v_phone_normalized  TEXT;
  v_existing_lead_id  INTEGER;
BEGIN
  v_api_key := lead_data->>'api_key';

  IF v_api_key IS NULL OR v_api_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'API key is required');
  END IF;

  SELECT id INTO v_company_id
  FROM companies
  WHERE api_key::text = v_api_key;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid API key');
  END IF;

  v_phone := NULLIF(BTRIM(lead_data->>'phone'), '');
  v_email := NULLIF(BTRIM(lead_data->>'email'), '');

  IF v_phone IS NOT NULL THEN
    v_phone_normalized := public.canonicalize_br_mobile_phone(v_phone);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lead_create_pub:' || v_company_id::TEXT || ':' ||
      COALESCE(NULLIF(v_phone_normalized, ''), NULLIF(lower(COALESCE(v_email, '')), ''), 'nokey'),
      0
    )
  );

  IF v_phone_normalized IS NOT NULL AND LENGTH(v_phone_normalized) >= 10 THEN
    SELECT id INTO v_existing_lead_id
    FROM leads
    WHERE company_id = v_company_id
      AND deleted_at IS NULL
      AND phone IS NOT NULL AND trim(phone) != ''
      AND (
        phone_normalized = v_phone_normalized
        OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
      )
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_lead_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM leads
    WHERE company_id = v_company_id
      AND lower(trim(email)) = lower(v_email)
      AND email IS NOT NULL AND trim(email) != ''
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_lead_id IS NOT NULL THEN
    IF v_phone_normalized IS NOT NULL THEN
      UPDATE leads
      SET phone = v_phone_normalized,
          updated_at = NOW()
      WHERE id = v_existing_lead_id
        AND phone IS DISTINCT FROM v_phone_normalized;
    END IF;

    RETURN jsonb_build_object(
      'success',              true,
      'lead_id',              v_existing_lead_id,
      'company_id',           v_company_id,
      'is_duplicate',         true,
      'duplicate_of_lead_id', v_existing_lead_id
    );
  END IF;

  INSERT INTO leads (
    company_id, name, email, phone, interest,
    company_name, company_cnpj, company_email, visitor_id,
    status, origin,
    campanha, conjunto_anuncio, anuncio, utm_medium,
    created_at
  ) VALUES (
    v_company_id,
    COALESCE(lead_data->>'name', 'Lead sem nome'),
    lead_data->>'email',
    v_phone_normalized,
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
  ) RETURNING id INTO v_lead_id;

  RETURN jsonb_build_object(
    'success',              true,
    'lead_id',              v_lead_id,
    'company_id',           v_company_id,
    'is_duplicate',         false,
    'duplicate_of_lead_id', NULL
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── 6. detect_lead_duplicates ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION detect_lead_duplicates(new_lead_id smallint)
RETURNS TABLE(duplicate_id smallint, reason text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
    lead_record RECORD;
    v_phone_normalized TEXT;
BEGIN
    SELECT * INTO lead_record FROM leads WHERE id = new_lead_id;

    IF lead_record.phone IS NOT NULL AND trim(lead_record.phone) != '' THEN
        v_phone_normalized := public.canonicalize_br_mobile_phone(lead_record.phone);

        IF v_phone_normalized IS NOT NULL AND LENGTH(v_phone_normalized) >= 10 THEN
            FOR duplicate_id, reason IN
                SELECT l.id::SMALLINT, 'phone'::TEXT
                FROM leads l
                WHERE l.company_id = lead_record.company_id
                  AND l.id != new_lead_id
                  AND l.deleted_at IS NULL
                  AND l.phone IS NOT NULL
                  AND trim(l.phone) != ''
                  AND (
                    l.phone_normalized = v_phone_normalized
                    OR public.canonicalize_br_mobile_phone(l.phone) = v_phone_normalized
                  )
                LIMIT 1
            LOOP
                RETURN NEXT;
                RETURN;
            END LOOP;
        END IF;
    END IF;

    IF lead_record.email IS NOT NULL AND trim(lead_record.email) != '' THEN
        FOR duplicate_id, reason IN
            SELECT l.id::SMALLINT, 'email'::TEXT
            FROM leads l
            WHERE lower(trim(l.email)) = lower(trim(lead_record.email))
              AND l.company_id = lead_record.company_id
              AND l.id != new_lead_id
              AND l.deleted_at IS NULL
              AND l.email IS NOT NULL
              AND trim(l.email) != ''
            LIMIT 1
        LOOP
            RETURN NEXT;
            RETURN;
        END LOOP;
    END IF;

    RETURN;
END;
$$;

-- ── 7. chat_create_or_get_conversation (lookup canônico) ─────────────────────
CREATE OR REPLACE FUNCTION public.chat_create_or_get_conversation(
  p_company_id    uuid,
  p_instance_id   uuid,
  p_contact_phone character varying,
  p_contact_name  character varying DEFAULT NULL::character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id     uuid;
  v_conversation        jsonb;
  v_instance_name       varchar;
  v_lead_id             INTEGER;
  v_responsible_user_id uuid;
  v_lead_resolved       BOOLEAN := false;
  v_phone_normalized    text;
BEGIN
  SELECT instance_name INTO v_instance_name
  FROM whatsapp_life_instances
  WHERE id         = p_instance_id
    AND company_id = p_company_id;

  IF v_instance_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Instância não encontrada ou não pertence à empresa'
    );
  END IF;

  v_phone_normalized := public.canonicalize_br_mobile_phone(p_contact_phone);

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id     = p_company_id
    AND deleted_at     IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
    )
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    v_lead_resolved := true;

    SELECT l.responsible_user_id INTO v_responsible_user_id
    FROM   leads l
    WHERE  l.id         = v_lead_id
      AND  l.deleted_at IS NULL
      AND  l.responsible_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1 FROM company_users cu
             WHERE  cu.user_id    = l.responsible_user_id
               AND  cu.company_id = l.company_id
               AND  cu.is_active  = true
           );
  END IF;

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id = p_company_id
    AND status     = 'active'
    AND (
      contact_phone = p_contact_phone
      OR public.canonicalize_br_mobile_phone(contact_phone) = v_phone_normalized
    )
  ORDER BY
    CASE WHEN instance_id = p_instance_id THEN 0 ELSE 1 END,
    CASE WHEN contact_phone = p_contact_phone THEN 0 ELSE 1 END,
    instance_id NULLS LAST
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,
      assigned_to,
      last_instance_id,
      last_instance_name
    ) VALUES (
      p_company_id,
      p_instance_id,
      p_contact_phone,
      p_contact_name,
      v_lead_id,
      v_responsible_user_id,
      p_instance_id,
      v_instance_name
    )
    RETURNING id INTO v_conversation_id;

    INSERT INTO chat_contacts (
      company_id,
      phone_number,
      name,
      first_contact_at,
      last_activity_at
    ) VALUES (
      p_company_id,
      p_contact_phone,
      p_contact_name,
      now(),
      now()
    )
    ON CONFLICT (company_id, phone_number)
    DO UPDATE SET
      name             = COALESCE(EXCLUDED.name, chat_contacts.name),
      last_activity_at = now();
  ELSE
    UPDATE chat_conversations
    SET last_instance_id   = p_instance_id,
        last_instance_name = v_instance_name,
        lead_id            = COALESCE(lead_id, v_lead_id),
        assigned_to        = CASE
                               WHEN v_lead_resolved
                                AND assigned_to IS DISTINCT FROM v_responsible_user_id
                               THEN v_responsible_user_id
                               ELSE assigned_to
                             END,
        updated_at         = NOW()
    WHERE id = v_conversation_id;
  END IF;

  SELECT jsonb_build_object(
    'id',                     cc.id,
    'company_id',             cc.company_id,
    'instance_id',            cc.instance_id,
    'contact_phone',          cc.contact_phone,
    'contact_name',           cc.contact_name,
    'assigned_to',            cc.assigned_to,
    'last_message_at',        cc.last_message_at,
    'last_message_content',   cc.last_message_content,
    'last_message_direction', cc.last_message_direction,
    'unread_count',           cc.unread_count,
    'status',                 cc.status,
    'created_at',             cc.created_at,
    'updated_at',             cc.updated_at
  ) INTO v_conversation
  FROM chat_conversations cc
  WHERE cc.id = v_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'data',    v_conversation
  );
END;
$function$;

-- ── 8. process_webhook_message_safe (lookup canônico) ────────────────────────
CREATE OR REPLACE FUNCTION public.process_webhook_message_safe(
  p_company_id                uuid,
  p_instance_id               uuid,
  p_phone_number              text,
  p_sender_name               text,
  p_content                   text,
  p_message_type              text,
  p_direction                 text,
  p_uazapi_message_id         text DEFAULT NULL::text,
  p_profile_picture_url       text DEFAULT NULL::text,
  p_media_url                 text DEFAULT NULL::text,
  p_reply_to_uazapi_message_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id          uuid;
  v_conversation_id     uuid;
  v_message_id          uuid;
  v_lead_id             INTEGER;
  v_responsible_user_id uuid;
  v_lead_resolved       BOOLEAN := false;
  v_lead_created        BOOLEAN := false;
  v_reply_message_id    uuid    := NULL;
  v_phone_normalized    text;
  v_result              jsonb;
  v_current_photo_url   text;
  v_is_cdn_photo        boolean;
BEGIN
  RAISE LOG 'process_webhook_message_safe: Iniciando processamento para empresa % telefone %', p_company_id, p_phone_number;

  IF p_uazapi_message_id IS NOT NULL THEN
    SELECT cm.id, cc.id, cc.lead_id
    INTO v_message_id, v_conversation_id, v_lead_id
    FROM chat_messages cm
    JOIN chat_conversations cc ON cc.id = cm.conversation_id
    WHERE cm.uazapi_message_id = p_uazapi_message_id
      AND cm.company_id        = p_company_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RAISE LOG 'process_webhook_message_safe: Mensagem duplicata detectada (uazapi_message_id=%) — retornando existente %', p_uazapi_message_id, v_message_id;

      UPDATE chat_conversations
      SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = v_conversation_id;

      RETURN jsonb_build_object(
        'success',         true,
        'message',         'Mensagem já registrada (deduplicada)',
        'contact_id',      NULL,
        'conversation_id', v_conversation_id,
        'message_id',      v_message_id,
        'lead_id',         v_lead_id,
        'lead_created',    false,
        'media_url',       p_media_url,
        'deduplicated',    true
      );
    END IF;
  END IF;

  IF p_reply_to_uazapi_message_id IS NOT NULL THEN
    SELECT id INTO v_reply_message_id
    FROM chat_messages
    WHERE uazapi_message_id = p_reply_to_uazapi_message_id
      AND company_id        = p_company_id
    LIMIT 1;
    RAISE LOG 'process_webhook_message_safe: reply_to resolvido: % → %', p_reply_to_uazapi_message_id, v_reply_message_id;
  END IF;

  SELECT id, profile_picture_url
  INTO v_contact_id, v_current_photo_url
  FROM chat_contacts
  WHERE phone_number = p_phone_number
    AND company_id   = p_company_id;

  IF v_contact_id IS NULL THEN
    INSERT INTO chat_contacts (
      company_id, phone_number, name, profile_picture_url,
      total_messages, tags, custom_fields, created_at, updated_at
    ) VALUES (
      p_company_id, p_phone_number, p_sender_name, p_profile_picture_url,
      0, '{}', '{}', NOW(), NOW()
    ) RETURNING id INTO v_contact_id;
    RAISE LOG 'process_webhook_message_safe: Contato criado com ID %', v_contact_id;
  ELSE
    v_is_cdn_photo := (
      v_current_photo_url IS NULL
      OR v_current_photo_url LIKE '%pps.whatsapp.net%'
      OR v_current_photo_url LIKE '%mmg.whatsapp.net%'
    );

    UPDATE chat_contacts
    SET
      name                = COALESCE(NULLIF(p_sender_name, ''), name),
      profile_picture_url = CASE
                              WHEN v_is_cdn_photo THEN COALESCE(p_profile_picture_url, profile_picture_url)
                              ELSE profile_picture_url
                            END,
      updated_at          = NOW()
    WHERE id = v_contact_id;
    RAISE LOG 'process_webhook_message_safe: Contato atualizado com ID % (photo_protected=%)', v_contact_id, (NOT v_is_cdn_photo);
  END IF;

  v_phone_normalized := public.canonicalize_br_mobile_phone(p_phone_number);

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
    )
  LIMIT 1;

  RAISE LOG 'process_webhook_message_safe: Lead encontrado para telefone % → id=%', p_phone_number, COALESCE(v_lead_id::text, 'NULL');

  IF v_lead_id IS NOT NULL THEN
    v_lead_resolved := true;

    SELECT l.responsible_user_id INTO v_responsible_user_id
    FROM   leads l
    WHERE  l.id         = v_lead_id
      AND  l.deleted_at IS NULL
      AND  l.responsible_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1
             FROM   company_users cu
             WHERE  cu.user_id    = l.responsible_user_id
               AND  cu.company_id = l.company_id
               AND  cu.is_active  = true
           );
  END IF;

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id  = p_company_id
    AND instance_id = p_instance_id
    AND (
      contact_phone = p_phone_number
      OR public.canonicalize_br_mobile_phone(contact_phone) = v_phone_normalized
    )
  ORDER BY
    CASE WHEN contact_phone = p_phone_number THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id, instance_id, contact_phone, contact_name, lead_id,
      assigned_to,
      last_message_at, unread_count, status, created_at, updated_at
    ) VALUES (
      p_company_id, p_instance_id, p_phone_number, p_sender_name, v_lead_id,
      v_responsible_user_id,
      NOW(), CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
      'active', NOW(), NOW()
    ) RETURNING id INTO v_conversation_id;
    RAISE LOG 'process_webhook_message_safe: Conversa criada com ID % lead_id % assigned_to %',
      v_conversation_id,
      COALESCE(v_lead_id::text, 'NULL'),
      COALESCE(v_responsible_user_id::text, 'NULL');
  ELSE
    UPDATE chat_conversations
    SET
      contact_name    = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id         = COALESCE(lead_id, v_lead_id),
      assigned_to     = CASE
                          WHEN v_lead_resolved
                           AND assigned_to IS DISTINCT FROM v_responsible_user_id
                          THEN v_responsible_user_id
                          ELSE assigned_to
                        END,
      last_message_at = NOW(),
      unread_count    = CASE
        WHEN p_direction = 'inbound' THEN unread_count + 1
        ELSE unread_count
      END,
      updated_at      = NOW()
    WHERE id = v_conversation_id;
    RAISE LOG 'process_webhook_message_safe: Conversa atualizada ID % lead_id % lead_resolved % assigned_to %',
      v_conversation_id,
      COALESCE(v_lead_id::text, 'NULL'),
      v_lead_resolved,
      COALESCE(v_responsible_user_id::text, 'NULL');
  END IF;

  INSERT INTO chat_messages (
    conversation_id, company_id, instance_id, message_type, content, media_url,
    direction, status, uazapi_message_id, reply_to_message_id, timestamp, created_at, updated_at
  ) VALUES (
    v_conversation_id, p_company_id, p_instance_id, p_message_type, p_content, p_media_url,
    p_direction, 'sent', p_uazapi_message_id, v_reply_message_id, NOW(), NOW(), NOW()
  ) RETURNING id INTO v_message_id;

  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID % reply_to=%', v_message_id, COALESCE(v_reply_message_id::text, 'NULL');

  v_result := jsonb_build_object(
    'success',         true,
    'message',         'Mensagem processada com sucesso via webhook seguro',
    'contact_id',      v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id,
    'lead_id',         v_lead_id,
    'lead_created',    v_lead_created,
    'media_url',       p_media_url
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'process_webhook_message_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM,
      'message', 'Erro ao processar mensagem via webhook seguro'
    );
END;
$$;

-- ── 9. Instagram create/link: phone canônico ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_or_link_instagram_lead(
  p_conversation_id UUID,
  p_name            TEXT,
  p_performed_by    UUID,
  p_phone           TEXT    DEFAULT NULL,
  p_email           TEXT    DEFAULT NULL,
  p_ip_address      TEXT    DEFAULT NULL,
  p_user_agent      TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv                 public.instagram_conversations%ROWTYPE;
  v_responsible_user_id  UUID;
  v_phone_norm           TEXT;
  v_email_norm           TEXT;
  v_existing_lead_id     SMALLINT;
  v_lead_id              SMALLINT;
  v_matched_by           TEXT;
  v_is_duplicate         BOOLEAN := false;
  v_action               TEXT;
  v_social_profile_id    UUID;
  v_max_leads            INTEGER;
  v_current_leads        BIGINT;
  v_metadata             JSONB;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_conv
  FROM public.instagram_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found');
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'validation_error',
      'detail',  'name é obrigatório'
    );
  END IF;

  IF (p_phone IS NULL OR trim(p_phone) = '')
     AND (p_email IS NULL OR trim(p_email) = '') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'validation_error',
      'detail',  'phone ou email é obrigatório'
    );
  END IF;

  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_phone_norm := public.canonicalize_br_mobile_phone(p_phone);
    IF v_phone_norm IS NULL OR LENGTH(v_phone_norm) < 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'validation_error',
        'detail',  'telefone deve ter pelo menos 10 dígitos'
      );
    END IF;
  END IF;

  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_email_norm := lower(trim(p_email));
    IF v_email_norm !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'validation_error',
        'detail',  'email com formato inválido'
      );
    END IF;
  END IF;

  IF v_conv.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_social_profiles (
      lead_id, company_id, provider, provider_user_id,
      username, display_name, avatar_url,
      created_at, updated_at
    ) VALUES (
      v_conv.lead_id,
      v_conv.company_id,
      'instagram',
      v_conv.ig_participant_id,
      v_conv.participant_username,
      COALESCE(v_conv.participant_name, trim(p_name)),
      v_conv.participant_avatar,
      NOW(),
      NOW()
    )
    ON CONFLICT (company_id, provider, provider_user_id) DO NOTHING;

    INSERT INTO public.instagram_audit_logs (
      company_id, connection_id, action, performed_by,
      ip_address, user_agent, metadata
    ) VALUES (
      v_conv.company_id,
      v_conv.connection_id,
      'lead_already_linked',
      p_performed_by,
      p_ip_address,
      p_user_agent,
      jsonb_build_object(
        'conversation_id',    p_conversation_id,
        'lead_id',            v_conv.lead_id,
        'ig_participant_id',  v_conv.ig_participant_id,
        'participant_username', v_conv.participant_username
      )
    );

    RETURN jsonb_build_object(
      'success',         true,
      'action',          'already_linked',
      'lead_id',         v_conv.lead_id,
      'conversation_id', p_conversation_id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'ig_lead:' || v_conv.company_id::TEXT || ':' ||
      COALESCE(NULLIF(v_phone_norm, ''), v_conv.ig_participant_id),
      0
    )
  );

  SELECT lead_id INTO v_conv.lead_id
  FROM public.instagram_conversations
  WHERE id = p_conversation_id;

  IF v_conv.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',         true,
      'action',          'already_linked',
      'lead_id',         v_conv.lead_id,
      'conversation_id', p_conversation_id
    );
  END IF;

  IF v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id  = v_conv.company_id
      AND deleted_at  IS NULL
      AND (
        phone_normalized = v_phone_norm
        OR public.canonicalize_br_mobile_phone(phone) = v_phone_norm
      )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  IF v_existing_lead_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id          = v_conv.company_id
      AND deleted_at          IS NULL
      AND lower(trim(email))  = v_email_norm
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  IF v_existing_lead_id IS NULL THEN
    SELECT lead_id INTO v_existing_lead_id
    FROM public.lead_social_profiles
    WHERE company_id       = v_conv.company_id
      AND provider         = 'instagram'
      AND provider_user_id = v_conv.ig_participant_id
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'social_profile';
    END IF;
  END IF;

  SELECT COALESCE(v_conv.assigned_to, s.default_assignee)
  INTO   v_responsible_user_id
  FROM   public.instagram_company_settings s
  WHERE  s.company_id = v_conv.company_id;

  IF NOT FOUND THEN
    v_responsible_user_id := v_conv.assigned_to;
  END IF;

  IF v_existing_lead_id IS NOT NULL THEN
    v_lead_id      := v_existing_lead_id;
    v_is_duplicate := true;
    v_action       := 'lead_linked';

    IF v_phone_norm IS NOT NULL THEN
      UPDATE public.leads
      SET phone = v_phone_norm,
          updated_at = NOW()
      WHERE id = v_lead_id
        AND phone IS DISTINCT FROM v_phone_norm;
    END IF;
  ELSE
    SELECT pl.max_leads INTO v_max_leads
    FROM   public.companies  c
    LEFT JOIN public.plans   pl ON pl.id = c.plan_id AND pl.is_active = true
    WHERE  c.id = v_conv.company_id;

    IF v_max_leads IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_leads
      FROM   public.leads
      WHERE  company_id = v_conv.company_id
        AND  deleted_at IS NULL;

      IF v_current_leads >= v_max_leads THEN
        RETURN jsonb_build_object(
          'success',     false,
          'error',       'plan_limit_exceeded',
          'max_allowed', v_max_leads,
          'current',     v_current_leads
        );
      END IF;
    END IF;

    INSERT INTO public.leads (
      company_id,
      name,
      phone,
      email,
      origin,
      status,
      responsible_user_id,
      record_type,
      is_over_plan,
      created_at,
      updated_at
    ) VALUES (
      v_conv.company_id,
      trim(p_name),
      v_phone_norm,
      NULLIF(trim(COALESCE(p_email, '')), ''),
      'instagram',
      'novo',
      v_responsible_user_id,
      'Lead',
      false,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_lead_id;

    v_is_duplicate := false;
    v_action       := 'lead_created';
  END IF;

  INSERT INTO public.lead_social_profiles (
    lead_id,
    company_id,
    provider,
    provider_user_id,
    username,
    display_name,
    avatar_url,
    created_at,
    updated_at
  ) VALUES (
    v_lead_id,
    v_conv.company_id,
    'instagram',
    v_conv.ig_participant_id,
    v_conv.participant_username,
    COALESCE(v_conv.participant_name, trim(p_name)),
    v_conv.participant_avatar,
    NOW(),
    NOW()
  )
  ON CONFLICT (company_id, provider, provider_user_id) DO UPDATE SET
    lead_id      = EXCLUDED.lead_id,
    username     = COALESCE(EXCLUDED.username,     lead_social_profiles.username),
    display_name = COALESCE(EXCLUDED.display_name, lead_social_profiles.display_name),
    avatar_url   = COALESCE(EXCLUDED.avatar_url,   lead_social_profiles.avatar_url),
    updated_at   = NOW()
  RETURNING id INTO v_social_profile_id;

  UPDATE public.instagram_conversations
  SET    lead_id    = v_lead_id,
         updated_at = NOW()
  WHERE  id = p_conversation_id;

  v_metadata := jsonb_build_object(
    'conversation_id',     p_conversation_id,
    'lead_id',             v_lead_id,
    'matched_by',          v_matched_by,
    'is_duplicate',        v_is_duplicate,
    'ig_participant_id',   v_conv.ig_participant_id,
    'participant_username', v_conv.participant_username,
    'action',              v_action
  );

  IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 4 THEN
    v_metadata := v_metadata || jsonb_build_object('phone_last4', RIGHT(v_phone_norm, 4));
  END IF;

  IF v_email_norm IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('email_domain', SPLIT_PART(v_email_norm, '@', 2));
  END IF;

  INSERT INTO public.instagram_audit_logs (
    company_id, connection_id, action, performed_by,
    ip_address, user_agent, metadata
  ) VALUES (
    v_conv.company_id,
    v_conv.connection_id,
    v_action,
    p_performed_by,
    p_ip_address,
    p_user_agent,
    v_metadata
  );

  RETURN jsonb_build_object(
    'success',           true,
    'action',            v_action,
    'lead_id',           v_lead_id,
    'conversation_id',   p_conversation_id,
    'social_profile_id', v_social_profile_id,
    'matched_by',        v_matched_by,
    'is_duplicate',      v_is_duplicate
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_lead_from_instagram_comment(
  p_comment_id   UUID,
  p_name         TEXT,
  p_performed_by UUID,
  p_phone        TEXT    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL,
  p_ip_address   TEXT    DEFAULT NULL,
  p_user_agent   TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment              public.instagram_comments%ROWTYPE;
  v_phone_norm           TEXT;
  v_email_norm           TEXT;
  v_existing_lead_id     INTEGER;
  v_lead_id              INTEGER;
  v_matched_by           TEXT;
  v_is_duplicate         BOOLEAN := false;
  v_action               TEXT;
  v_social_profile_id    UUID;
  v_max_leads            INTEGER;
  v_current_leads        BIGINT;
  v_responsible_user_id  UUID;
  v_metadata             JSONB;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_comment
  FROM public.instagram_comments
  WHERE id = p_comment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'comment_not_found');
  END IF;

  IF v_comment.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action',  'already_linked',
      'lead_id', v_comment.lead_id
    );
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'name é obrigatório');
  END IF;

  IF (p_phone IS NULL OR trim(p_phone) = '') AND (p_email IS NULL OR trim(p_email) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'phone ou email é obrigatório');
  END IF;

  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_phone_norm := public.canonicalize_br_mobile_phone(p_phone);
    IF v_phone_norm IS NULL OR LENGTH(v_phone_norm) < 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'telefone deve ter pelo menos 10 dígitos');
    END IF;
  END IF;

  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_email_norm := lower(trim(p_email));
    IF v_email_norm !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'email com formato inválido');
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'ig_comment_lead:' || v_comment.company_id::TEXT || ':' ||
      COALESCE(NULLIF(v_phone_norm, ''), v_comment.ig_user_id),
      0
    )
  );

  SELECT lead_id INTO v_comment.lead_id
  FROM public.instagram_comments
  WHERE id = p_comment_id;

  IF v_comment.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'action', 'already_linked', 'lead_id', v_comment.lead_id);
  END IF;

  IF v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id = v_comment.company_id
      AND deleted_at IS NULL
      AND (
        phone_normalized = v_phone_norm
        OR public.canonicalize_br_mobile_phone(phone) = v_phone_norm
      )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  IF v_existing_lead_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id        = v_comment.company_id
      AND deleted_at        IS NULL
      AND lower(trim(email)) = v_email_norm
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  IF v_existing_lead_id IS NULL THEN
    SELECT lead_id INTO v_existing_lead_id
    FROM public.lead_social_profiles
    WHERE company_id       = v_comment.company_id
      AND provider         = 'instagram'
      AND provider_user_id = v_comment.ig_user_id
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'social_profile';
    END IF;
  END IF;

  IF v_existing_lead_id IS NOT NULL THEN
    v_lead_id      := v_existing_lead_id;
    v_is_duplicate := true;
    v_action       := 'lead_linked';

    IF v_phone_norm IS NOT NULL THEN
      UPDATE public.leads
      SET phone = v_phone_norm,
          updated_at = NOW()
      WHERE id = v_lead_id
        AND phone IS DISTINCT FROM v_phone_norm;
    END IF;
  ELSE
    SELECT pl.max_leads INTO v_max_leads
    FROM   public.companies  c
    LEFT JOIN public.plans   pl ON pl.id = c.plan_id AND pl.is_active = true
    WHERE  c.id = v_comment.company_id;

    IF v_max_leads IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_leads
      FROM   public.leads
      WHERE  company_id = v_comment.company_id
        AND  deleted_at IS NULL;

      IF v_current_leads >= v_max_leads THEN
        RETURN jsonb_build_object(
          'success',     false,
          'error',       'plan_limit_exceeded',
          'max_allowed', v_max_leads,
          'current',     v_current_leads
        );
      END IF;
    END IF;

    INSERT INTO public.leads (
      company_id, name, phone, email, origin, status,
      responsible_user_id, record_type, is_over_plan, created_at, updated_at
    ) VALUES (
      v_comment.company_id,
      trim(p_name),
      v_phone_norm,
      NULLIF(trim(COALESCE(p_email, '')), ''),
      'instagram',
      'novo',
      NULL,
      'Lead',
      false,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_lead_id;

    v_is_duplicate := false;
    v_action       := 'lead_created';
  END IF;

  INSERT INTO public.lead_social_profiles (
    lead_id, company_id, provider, provider_user_id,
    username, display_name, avatar_url, created_at, updated_at
  ) VALUES (
    v_lead_id,
    v_comment.company_id,
    'instagram',
    v_comment.ig_user_id,
    v_comment.ig_username,
    trim(p_name),
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (company_id, provider, provider_user_id) DO UPDATE SET
    lead_id      = EXCLUDED.lead_id,
    username     = COALESCE(EXCLUDED.username,     lead_social_profiles.username),
    display_name = COALESCE(EXCLUDED.display_name, lead_social_profiles.display_name),
    updated_at   = NOW()
  RETURNING id INTO v_social_profile_id;

  UPDATE public.instagram_comments
  SET    lead_id    = v_lead_id,
         status     = 'converted_to_lead',
         updated_at = NOW()
  WHERE  id = p_comment_id;

  IF v_comment.conversation_id IS NOT NULL THEN
    UPDATE public.instagram_conversations
    SET    lead_id    = v_lead_id,
           updated_at = NOW()
    WHERE  id = v_comment.conversation_id;
  END IF;

  v_metadata := jsonb_build_object(
    'comment_id',     p_comment_id,
    'lead_id',        v_lead_id,
    'matched_by',     v_matched_by,
    'is_duplicate',   v_is_duplicate,
    'ig_user_id',     v_comment.ig_user_id,
    'ig_username',    v_comment.ig_username,
    'action',         v_action
  );

  IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 4 THEN
    v_metadata := v_metadata || jsonb_build_object('phone_last4', RIGHT(v_phone_norm, 4));
  END IF;

  IF v_email_norm IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('email_domain', SPLIT_PART(v_email_norm, '@', 2));
  END IF;

  INSERT INTO public.instagram_audit_logs (
    company_id, connection_id, action, performed_by,
    ip_address, user_agent, metadata
  ) VALUES (
    v_comment.company_id,
    v_comment.connection_id,
    v_action,
    p_performed_by,
    p_ip_address,
    p_user_agent,
    v_metadata
  );

  RETURN jsonb_build_object(
    'success',           true,
    'action',            v_action,
    'lead_id',           v_lead_id,
    'social_profile_id', v_social_profile_id,
    'matched_by',        v_matched_by,
    'is_duplicate',      v_is_duplicate
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
