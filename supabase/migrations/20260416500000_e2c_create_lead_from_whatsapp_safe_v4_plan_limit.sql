-- =============================================================================
-- MIGRATION E2c: Soft block de max_leads em create_lead_from_whatsapp_safe
--
-- OBJETIVO:
--   Impedir criação de novos leads via WhatsApp quando a empresa atingiu
--   o limite de leads do plano (plans.max_leads).
--
-- SOFT BLOCK (não é um erro de sistema):
--   - NÃO lança EXCEPTION — não quebra o webhook nem causa retry
--   - Retorna { success: false, created: false, reason: 'plan_lead_limit_reached' }
--   - Os callers (uazapi-webhook-final.js e webhook/uazapi/[company_id].js)
--     checam `rpcResult.success` antes de usar o lead_id. Se false, o bloco
--     de criação de lead é ignorado e o processamento da mensagem continua
--     normalmente (chat_messages e chat_conversations não são afetados).
--
-- COMPORTAMENTO:
--   NULL em plans.max_leads = ilimitado → prossegue sem restrição
--   Empresa sem plan_id = sem limite configurado → prossegue sem restrição
--   COUNT considera apenas leads com deleted_at IS NULL
--
-- VERSÃO: v4 (anterior: v3 normalize_phone — 20260415260000)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_lead_from_whatsapp_safe(
  p_company_id UUID,
  p_phone      TEXT,
  p_name       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_lead_id           BIGINT;
  v_opportunity_id    UUID;
  v_existing_lead_id  BIGINT;
  v_funnel_id         UUID;
  v_stage_id          UUID;
  v_phone_normalized  TEXT;
  -- Plan limit check
  v_max_leads         INTEGER;
  v_current_leads     BIGINT;
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v4: empresa % telefone %', p_company_id, p_phone;

  -- Normalizar phone de entrada (apenas dígitos)
  v_phone_normalized := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- 1. VERIFICAR SE JÁ EXISTE LEAD (comparação normalizada)
  --    Lead existente não conta como nova criação → não aplica soft block
  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_normalized
      OR RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 11) = RIGHT(v_phone_normalized, 11)
    )
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL THEN
    RAISE LOG 'create_lead_from_whatsapp_safe v4: Lead já existe ID %', v_existing_lead_id;
    RETURN jsonb_build_object(
      'success',  true,
      'lead_id',  v_existing_lead_id,
      'created',  false,
      'source',   'whatsapp',
      'message',  'Lead já existe para este telefone'
    );
  END IF;

  -- 2. SOFT BLOCK: verificar max_leads do plano antes de criar novo lead
  --
  --    Busca via companies.plan_id → plans.max_leads (nunca via slug legado).
  --    LEFT JOIN garante que empresa sem plan_id retorna NULL (= ilimitado).
  --    is_active = true evita usar plano desativado.
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
      RAISE LOG 'create_lead_from_whatsapp_safe v4: SOFT BLOCK — limite de leads atingido para empresa % (atual=%, max=%)',
        p_company_id, v_current_leads, v_max_leads;

      -- Retorna success=false com reason específico.
      -- O webhook interpreta success=false e NÃO tenta usar o lead_id.
      -- A mensagem WhatsApp continua sendo processada normalmente.
      RETURN jsonb_build_object(
        'success', false,
        'created', false,
        'reason',  'plan_lead_limit_reached',
        'lead_id', NULL,
        'message', format(
          'Limite de leads do plano atingido (%s/%s). Lead não criado.',
          v_current_leads, v_max_leads
        )
      );
    END IF;
  END IF;

  -- 3. CRIAR NOVO LEAD
  INSERT INTO leads (
    company_id, phone, name, origin, status, record_type, created_at, updated_at
  ) VALUES (
    p_company_id, p_phone, COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp', 'novo', 'Lead', NOW(), NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v4: Lead criado ID %', v_lead_id;

  -- 4. BUSCAR FUNIL PADRÃO
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

  -- 5. CRIAR OPORTUNIDADE E POSIÇÃO NO FUNIL
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
    'success',        true,
    'lead_id',        v_lead_id,
    'opportunity_id', v_opportunity_id,
    'created',        true,
    'source',         'whatsapp',
    'message',        'Lead criado com sucesso via WhatsApp'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_lead_from_whatsapp_safe v4: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
