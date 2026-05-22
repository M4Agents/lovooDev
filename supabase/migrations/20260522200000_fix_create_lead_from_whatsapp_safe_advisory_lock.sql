-- =====================================================================
-- Migration: Adicionar pg_advisory_xact_lock em create_lead_from_whatsapp_safe
-- Data: 2026-05-22
--
-- Problema:
--   A função faz SELECT → INSERT sem lock, permitindo race condition
--   quando múltiplas mensagens chegam simultaneamente do mesmo número:
--   dois processos passam pelo SELECT (nenhum vê lead existente) e ambos
--   fazem INSERT, gerando leads duplicados.
--
-- Correção:
--   Adicionar pg_advisory_xact_lock por (company_id, phone_normalized)
--   — mesmo padrão já usado em create_lead_from_company.
--   O lock é automaticamente liberado ao fim da transação.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp_safe(
  p_company_id uuid,
  p_phone      text,
  p_name       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id           BIGINT;
  v_opportunity_id    UUID;
  v_existing_lead_id  BIGINT;
  v_funnel_id         UUID;
  v_stage_id          UUID;
  v_phone_normalized  TEXT;
  v_max_leads         INTEGER;
  v_current_leads     BIGINT;
  v_is_over_plan      BOOLEAN := FALSE;
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v6: empresa % telefone %', p_company_id, p_phone;

  v_phone_normalized := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- Serializar criação de leads por empresa para evitar race condition
  -- (mesmo padrão de create_lead_from_company)
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create_wa:' || p_company_id::TEXT || ':' || v_phone_normalized, 0)
  );

  -- Verificar se lead já existe (busca normalizada + fallback RIGHT 11)
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
    RAISE LOG 'create_lead_from_whatsapp_safe v6: Lead já existe ID %', v_existing_lead_id;
    RETURN jsonb_build_object(
      'success',      true,
      'lead_id',      v_existing_lead_id,
      'created',      false,
      'is_over_plan', false,
      'source',       'whatsapp',
      'message',      'Lead já existe para este telefone'
    );
  END IF;

  -- Verificar limite do plano
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
      RAISE LOG 'create_lead_from_whatsapp_safe v6: empresa % acima do limite (atual=%, max=%) — lead será criado com is_over_plan=true',
        p_company_id, v_current_leads, v_max_leads;
    END IF;
  END IF;

  INSERT INTO leads (
    company_id, phone, name, origin, status, record_type, is_over_plan, created_at, updated_at
  ) VALUES (
    p_company_id, p_phone, COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp', 'novo', 'Lead', v_is_over_plan, NOW(), NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v6: Lead criado ID % (is_over_plan=%)', v_lead_id, v_is_over_plan;

  -- Adicionar ao funil padrão
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
  RAISE LOG 'create_lead_from_whatsapp_safe v6: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_lead_from_whatsapp_safe IS
'v6 (2026-05-22): Adicionado pg_advisory_xact_lock por (company_id + phone_normalized) '
'para eliminar race condition em mensagens simultâneas do mesmo número. '
'v5 (2026-04-16): Normalização de telefone + fallback RIGHT(11) + controle is_over_plan.';
