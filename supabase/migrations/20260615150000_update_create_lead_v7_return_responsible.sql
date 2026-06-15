-- =============================================================================
-- Fase 3c: create_lead_from_whatsapp_safe v7.1
-- Data: 2026-06-15
--
-- Diff vs v7:
--   [+] Campo 'responsible_user_id' no RETURN jsonb de lead criado (created=true).
--       Valor: v_assigned_user_id (NULL quando instância sem responsável).
--
-- Objetivo:
--   Permitir que o webhook leia responsible_user_id do retorno e chame
--   sync_lead_responsible_to_conversations imediatamente após vincular
--   chat_conversations.lead_id, fechando o gap de assigned_to = NULL
--   no primeiro contato com instância que tem assigned_user_id configurado.
--
-- Retrocompatibilidade:
--   Callers existentes que ignoram campos extras do JSON não são impactados.
--   lead existente (created=false) continua retornando sem responsible_user_id.
--
-- Idempotência: CREATE OR REPLACE — mesma assinatura da v7.
-- =============================================================================

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
  RAISE LOG 'create_lead_from_whatsapp_safe v7.1: empresa % telefone % instancia %',
    p_company_id, p_phone, p_instance_id;

  v_phone_normalized := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- Advisory lock por (company_id + phone_normalized) — evita duplicatas por race condition
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lead_create_wa:' || p_company_id::TEXT || ':' || v_phone_normalized, 0)
  );

  -- Deduplicação: busca normalizada + fallback RIGHT(11)
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
    RAISE LOG 'create_lead_from_whatsapp_safe v7.1: Lead já existe ID %', v_existing_lead_id;
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
      RAISE LOG 'create_lead_from_whatsapp_safe v7.1: empresa % acima do limite (atual=%, max=%) — lead será criado com is_over_plan=true',
        p_company_id, v_current_leads, v_max_leads;
    END IF;
  END IF;

  -- Resolver responsável da instância (v7)
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
    p_phone,
    COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp',
    'novo',
    'Lead',
    v_is_over_plan,
    v_assigned_user_id,
    NOW(),
    NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v7.1: Lead criado ID % (is_over_plan=%, responsible_user_id=%)',
    v_lead_id, v_is_over_plan, v_assigned_user_id;

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

  -- v7.1: responsible_user_id incluído no retorno para permitir sync imediato
  -- de chat_conversations.assigned_to pelo webhook (Fase 3c).
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
  RAISE LOG 'create_lead_from_whatsapp_safe v7.1: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_lead_from_whatsapp_safe(uuid, text, text, uuid) IS
'v7.1 (2026-06-15): Campo responsible_user_id adicionado ao RETURN de lead criado '
'para permitir sync imediato de chat_conversations.assigned_to (Fase 3c). '
'v7 (2026-06-15): Adicionado p_instance_id (DEFAULT NULL) para atribuição automática '
'de responsible_user_id a partir de whatsapp_life_instances.assigned_user_id. '
'Retrocompatível: callers sem p_instance_id recebem responsible_user_id = NULL (= v6). '
'v6 (2026-05-22): pg_advisory_xact_lock por (company_id + phone_normalized). '
'v5 (2026-04-16): Normalização de telefone + fallback RIGHT(11) + controle is_over_plan.';
