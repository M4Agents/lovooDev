-- MIGRATION: Atualizar create_lead_from_whatsapp_safe
-- Mudanças:
--   1. Busca lead existente por telefone NORMALIZADO (não comparação exata)
--      - Remove todos os não-dígitos antes de comparar
--      - Fallback: compara os últimos 11 dígitos (número local sem DDI)
--   2. Retorna source='whatsapp' quando lead já existe (created=false)
--      para que o backend registre lead_entry mesmo sem criar novo lead

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
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v3: empresa % telefone %', p_company_id, p_phone;

  -- Normalizar phone de entrada (apenas dígitos)
  v_phone_normalized := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- 1. VERIFICAR SE JÁ EXISTE LEAD (comparação normalizada)
  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      -- Comparação exata de dígitos
      REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_normalized
      -- Ou comparação pelos últimos 11 dígitos (cobre DDI vs sem DDI)
      OR RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 11) = RIGHT(v_phone_normalized, 11)
    )
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL THEN
    RAISE LOG 'create_lead_from_whatsapp_safe v3: Lead já existe ID %', v_existing_lead_id;
    RETURN jsonb_build_object(
      'success',  true,
      'lead_id',  v_existing_lead_id,
      'created',  false,
      'source',   'whatsapp',
      'message',  'Lead já existe para este telefone'
    );
  END IF;

  -- 2. CRIAR NOVO LEAD
  INSERT INTO leads (
    company_id, phone, name, origin, status, record_type, created_at, updated_at
  ) VALUES (
    p_company_id, p_phone, COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp', 'novo', 'Lead', NOW(), NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v3: Lead criado ID %', v_lead_id;

  -- 3. BUSCAR FUNIL PADRÃO
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

  -- 4. CRIAR OPORTUNIDADE E POSIÇÃO (apenas se lead não for duplicata)
  -- O trigger z_add_lead_to_funnel também faz isso para leads não-duplicados,
  -- mas create_lead_from_whatsapp_safe cria explicitamente para garantir opportunity_id no retorno
  IF v_funnel_id IS NOT NULL THEN
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id ORDER BY position ASC LIMIT 1;

    IF v_stage_id IS NOT NULL THEN
      -- Verificar se trigger já criou a opportunity (pode haver race com z_add_lead_to_funnel)
      SELECT id INTO v_opportunity_id FROM opportunities WHERE lead_id = v_lead_id LIMIT 1;

      IF v_opportunity_id IS NULL THEN
        INSERT INTO opportunities (
          company_id, lead_id, title, status, source, created_at, updated_at
        ) VALUES (
          p_company_id, v_lead_id, 'Nova Oportunidade', 'open', 'whatsapp', NOW(), NOW()
        ) RETURNING id INTO v_opportunity_id;

        -- Criar posição no funil (apenas se não existir)
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
  RAISE LOG 'create_lead_from_whatsapp_safe v3: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
