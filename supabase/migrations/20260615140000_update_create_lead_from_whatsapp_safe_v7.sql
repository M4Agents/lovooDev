-- =============================================================================
-- Fase 2b: create_lead_from_whatsapp_safe v7
-- Data: 2026-06-15
--
-- Diff conceitual vs v6:
--   [+] Parâmetro p_instance_id uuid DEFAULT NULL
--   [+] DECLARE v_assigned_user_id UUID
--   [+] Bloco de resolução do responsável (após plan limit, antes do INSERT)
--   [~] INSERT em leads inclui responsible_user_id = v_assigned_user_id
--   [=] Tudo mais idêntico: advisory lock, deduplicação, plan limit,
--       oportunidade, retorno JSON, phone_normalized, EXCEPTION
--
-- Retrocompatibilidade:
--   CREATE OR REPLACE com 4 parâmetros criaria um NOVO overload (PostgreSQL
--   não substitui funções com assinaturas diferentes). Para evitar ambiguidade,
--   a v6 (3 args) é dropada antes de criar a v7 (4 args com DEFAULT NULL).
--   Callers sem p_instance_id continuam funcionando: PostgreSQL usa DEFAULT NULL
--   quando o 4º argumento não é fornecido por nome.
--
-- Segurança da resolução:
--   Single-query com AND wli.company_id = p_company_id evita cross-tenant.
--   EXISTS em company_users valida is_active = true em runtime.
--   Qualquer falha resulta silenciosamente em NULL (sem erro, sem log ruidoso).
--
-- Idempotência: DROP IF EXISTS + CREATE OR REPLACE.
-- =============================================================================

-- Drop da v6 (3 args) para evitar overload ambíguo.
-- Callers com 3 args continuam funcionando via DEFAULT NULL na v7.
DROP FUNCTION IF EXISTS public.create_lead_from_whatsapp_safe(uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp_safe(
  p_company_id  uuid,
  p_phone       text,
  p_name        text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL   -- v7: instância de origem; NULL = sem atribuição automática
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
  v_assigned_user_id   UUID;                -- v7: responsável resolvido da instância
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v7: empresa % telefone % instancia %',
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
    RAISE LOG 'create_lead_from_whatsapp_safe v7: Lead já existe ID %', v_existing_lead_id;
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
      RAISE LOG 'create_lead_from_whatsapp_safe v7: empresa % acima do limite (atual=%, max=%) — lead será criado com is_over_plan=true',
        p_company_id, v_current_leads, v_max_leads;
    END IF;
  END IF;

  -- ── v7: Resolver responsável da instância ─────────────────────────────────
  -- Single-query: busca assigned_user_id somente quando todas as condições
  -- são satisfeitas simultaneamente:
  --   • instância existe e pertence à empresa (anti cross-tenant)
  --   • instância não está soft-deleted
  --   • instância tem assigned_user_id preenchido
  --   • esse usuário é membro ativo da mesma empresa (is_active = true)
  -- Qualquer condição falha → SELECT não retorna linha → v_assigned_user_id = NULL.
  IF p_instance_id IS NOT NULL THEN
    SELECT wli.assigned_user_id
    INTO   v_assigned_user_id
    FROM   whatsapp_life_instances wli
    WHERE  wli.id         = p_instance_id
      AND  wli.company_id = p_company_id       -- validação cross-tenant obrigatória
      AND  wli.deleted_at IS NULL
      AND  wli.assigned_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1
             FROM   company_users cu
             WHERE  cu.user_id    = wli.assigned_user_id
               AND  cu.company_id = p_company_id
               AND  cu.is_active  = true
           );
    -- v_assigned_user_id = NULL quando: instância sem responsável, responsável
    -- inativo, ou company_id divergente — lead criado sem responsável (= v6).
  END IF;
  -- ── fim do bloco v7 ───────────────────────────────────────────────────────

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
    v_assigned_user_id,     -- v7: NULL quando instância sem responsável ativo
    NOW(),
    NOW()
  ) RETURNING id INTO v_lead_id;

  RAISE LOG 'create_lead_from_whatsapp_safe v7: Lead criado ID % (is_over_plan=%, responsible_user_id=%)',
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
  RAISE LOG 'create_lead_from_whatsapp_safe v7: ERRO - %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_lead_from_whatsapp_safe(uuid, text, text, uuid) IS
'v7 (2026-06-15): Adicionado p_instance_id (DEFAULT NULL) para atribuição automática '
'de responsible_user_id a partir de whatsapp_life_instances.assigned_user_id. '
'Retrocompatível: callers sem p_instance_id recebem responsible_user_id = NULL (= v6). '
'v6 (2026-05-22): pg_advisory_xact_lock por (company_id + phone_normalized). '
'v5 (2026-04-16): Normalização de telefone + fallback RIGHT(11) + controle is_over_plan.';
