-- =============================================================================
-- MIGRATION E3c: create_lead_from_whatsapp_safe v5 — sempre cria, marca is_over_plan
--
-- MUDANÇA EM RELAÇÃO À v4 (E2c):
--   v4 fazia SOFT BLOCK: não criava o lead se a empresa estava acima do limite.
--   v5 SEMPRE cria o lead. Se acima do limite: is_over_plan = true.
--
-- NOVA REGRA DE NEGÓCIO:
--   Lead nunca é bloqueado por plano. A ingestão é sempre permitida.
--   O controle é feito na visibilidade, não na criação.
--
-- RETORNO:
--   success: true    — sempre (a menos que haja EXCEPTION real)
--   created: true    — novo lead criado
--   created: false   — lead já existia para este telefone
--   is_over_plan     — true se foi criado acima do limite do plano
--
-- CALLERS (uazapi-webhook-final.js e webhook/uazapi/[company_id].js):
--   Ambos checam `rpcResult.success` (sempre true agora) e `rpcResult.created`.
--   O campo `is_over_plan` é informativo — callers podem logar ou ignorar.
--   Nenhuma mudança necessária nos callers.
--
-- VERSÃO: v5 (anterior: v4 soft block — 20260416500000)
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
  -- Plan limit check (sem bloqueio — apenas marca)
  v_max_leads         INTEGER;
  v_current_leads     BIGINT;
  v_is_over_plan      BOOLEAN := FALSE;
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v5: empresa % telefone %', p_company_id, p_phone;

  -- Normalizar phone de entrada (apenas dígitos)
  v_phone_normalized := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- 1. VERIFICAR SE JÁ EXISTE LEAD (comparação normalizada)
  --    Lead existente: retorna sem criar nem verificar limite (não é nova ingestão)
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
    RAISE LOG 'create_lead_from_whatsapp_safe v5: Lead já existe ID %', v_existing_lead_id;
    RETURN jsonb_build_object(
      'success',      true,
      'lead_id',      v_existing_lead_id,
      'created',      false,
      'is_over_plan', false,
      'source',       'whatsapp',
      'message',      'Lead já existe para este telefone'
    );
  END IF;

  -- 2. VERIFICAR LIMITE DO PLANO (sem bloqueio — apenas decide is_over_plan)
  --    Busca via companies.plan_id → plans.max_leads.
  --    LEFT JOIN garante NULL quando empresa não tem plan_id (= ilimitado).
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
      v_is_over_plan := TRUE;
      RAISE LOG 'create_lead_from_whatsapp_safe v5: empresa % acima do limite (atual=%, max=%) — lead será criado com is_over_plan=true',
        p_company_id, v_current_leads, v_max_leads;
    END IF;
  END IF;

  -- 3. CRIAR NOVO LEAD (sempre — is_over_plan marca a restrição de visibilidade)
  INSERT INTO leads (
    company_id, phone, name, origin, status, record_type, is_over_plan, created_at, updated_at
  ) VALUES (
    p_company_id, p_phone, COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp', 'novo', 'Lead', v_is_over_plan, NOW(), NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v5: Lead criado ID % (is_over_plan=%)', v_lead_id, v_is_over_plan;

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
    'is_over_plan',   v_is_over_plan,
    'source',         'whatsapp',
    'message',        CASE
                        WHEN v_is_over_plan
                        THEN 'Lead criado via WhatsApp (empresa acima do limite do plano)'
                        ELSE 'Lead criado com sucesso via WhatsApp'
                      END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_lead_from_whatsapp_safe v5: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
