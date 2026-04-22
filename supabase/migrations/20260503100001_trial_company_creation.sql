-- =============================================================================
-- Migration: trial_company_creation
-- Data: 2026-05-03
--
-- Etapa 2 do módulo de Trial para novas empresas.
--
-- O que esta migration faz:
--   1. Reescreve create_client_company_safe para iniciar trial automaticamente
--      ao criar empresa cliente — na mesma transação, de forma atômica.
--   2. Cria expire_overdue_trials() — RPC para cron de expiração de trials.
--   3. Cria extend_company_trial()  — RPC para extensão de trial por admin.
--
-- Ponto único de criação de trial (backend):
--   create_client_company_safe → único ponto que cria empresas client via plataforma.
--   AuthContext.tsx (signup direto) será centralizado na Etapa 3.
--
-- O que esta migration NÃO faz:
--   ✗ NÃO aplica trial a empresas existentes
--   ✗ NÃO altera companies.plan_id de empresas já criadas
--   ✗ NÃO cria company_subscriptions para empresas existentes
--   ✗ NÃO altera checkout, webhook, change, cancel, customer-portal
--   ✗ NÃO altera RLS da tabela companies ou company_subscriptions
--   ✗ NÃO altera frontend
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. REESCREVER create_client_company_safe
--
-- Adiciona ao fluxo existente:
--   a) Resolução do plano Growth (uuid) no banco
--   b) companies.plan_id = growth_plan_id no INSERT
--   c) INSERT em company_subscriptions com status='trialing', trial de 14 dias
--
-- Assinatura idêntica à versão anterior (backward compatible):
--   (p_parent_company_id, p_name, p_domain, p_plan)
--
-- Garantias:
--   - Toda a operação é transacional (PLPGSQL atomic block)
--   - Se company_subscriptions INSERT falhar, o rollback desfaz o companies INSERT
--   - Aplica-se APENAS a novas empresas client (company_type='client')
--   - Nunca toca em empresas existentes
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_client_company_safe(
  p_parent_company_id uuid,
  p_name              text,
  p_domain            text DEFAULT NULL,
  p_plan              text DEFAULT 'basic'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_caller_role      text;
  v_parent_super_id  uuid;
  v_parent_type      text;
  v_new_company_id   uuid;
  v_is_partner       boolean := false;
  v_growth_plan_id   uuid;
  v_trial_start      timestamptz := now();
  v_trial_end        timestamptz := now() + interval '14 days';
  v_super_perms      jsonb := jsonb_build_object(
    'chat',          true,
    'leads',         true,
    'users',         true,
    'settings',      true,
    'analytics',     true,
    'dashboard',     true,
    'financial',     true,
    'companies',     true,
    'edit_users',    true,
    'create_users',  true,
    'delete_users',  true,
    'impersonate',   true,
    'edit_all_leads',   true,
    'edit_financial',   true,
    'view_all_leads',   true,
    'view_financial',   true
  );
BEGIN
  -- 1. Caller deve estar autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- 2. Empresa parent deve existir e ser do tipo 'parent'
  SELECT company_type INTO v_parent_type
    FROM companies
   WHERE id = p_parent_company_id;

  IF v_parent_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'parent company not found');
  END IF;

  IF v_parent_type <> 'parent' THEN
    RETURN jsonb_build_object('success', false, 'error', 'target is not a parent company');
  END IF;

  -- 3. Validar role do caller na parent company
  SELECT cu.role INTO v_caller_role
    FROM company_users cu
   WHERE cu.user_id = v_caller_id
     AND cu.company_id = p_parent_company_id
     AND cu.is_active = true
   LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'system_admin', 'partner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: only super_admin, system_admin or partner can create client companies');
  END IF;

  -- 4. Identificar o super_admin da parent (para associar à nova empresa)
  SELECT cu.user_id INTO v_parent_super_id
    FROM company_users cu
   WHERE cu.company_id = p_parent_company_id
     AND cu.role = 'super_admin'
     AND cu.is_active = true
   ORDER BY cu.created_at
   LIMIT 1;

  IF v_parent_super_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no active super_admin found in parent company');
  END IF;

  -- 5. Verificar se caller é partner
  v_is_partner := (v_caller_role = 'partner');

  -- ── TRIAL: resolver plano Growth ────────────────────────────────────────────
  -- O plano Growth é a base do trial para novas empresas client.
  -- Se o plano Growth não existir, a empresa ainda é criada mas sem trial
  -- e com plan_id = NULL. Um log de aviso é emitido para investigação.
  SELECT id INTO v_growth_plan_id
    FROM public.plans
   WHERE slug = 'growth'
     AND is_active = true
   LIMIT 1;

  IF v_growth_plan_id IS NULL THEN
    RAISE WARNING 'create_client_company_safe: plano Growth (slug=growth) não encontrado ou inativo. '
                  'Empresa será criada sem trial e sem plan_id. Verificar seed de planos.';
  END IF;
  -- ────────────────────────────────────────────────────────────────────────────

  -- 6. Criar a empresa client
  INSERT INTO public.companies (
    name,
    domain,
    plan,
    plan_id,
    parent_company_id,
    company_type,
    user_id,
    status,
    created_by_partner_id
  )
  VALUES (
    p_name,
    p_domain,
    p_plan,
    v_growth_plan_id,          -- plano Growth como base do trial
    p_parent_company_id,
    'client',
    NULL,
    'active',
    CASE WHEN v_is_partner THEN v_caller_id ELSE NULL END
  )
  RETURNING id INTO v_new_company_id;

  -- 7. Associar super_admin da parent à nova empresa via company_users
  INSERT INTO public.company_users (
    company_id,
    user_id,
    role,
    permissions,
    is_active,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    v_new_company_id,
    v_parent_super_id,
    'super_admin',
    v_super_perms,
    true,
    v_caller_id,
    now(),
    now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role        = 'super_admin',
    permissions = v_super_perms,
    is_active   = true,
    updated_at  = now();

  -- 8. Se caller for partner: criar auto-assignment
  IF v_is_partner THEN
    INSERT INTO public.partner_company_assignments (
      partner_user_id,
      company_id,
      assigned_by,
      is_active
    )
    VALUES (
      v_caller_id,
      v_new_company_id,
      v_caller_id,
      true
    )
    ON CONFLICT (partner_user_id, company_id) DO UPDATE SET
      is_active   = true,
      assigned_at = now();
  END IF;

  -- ── TRIAL: criar registro de subscription ───────────────────────────────────
  -- Inserido apenas se o plano Growth foi encontrado.
  -- trial_extended = false (sem extensão ainda)
  -- stripe_* = NULL (trial interno, sem Stripe)
  -- billing_cycle = 'monthly' (default — irrelevante durante trial)
  IF v_growth_plan_id IS NOT NULL THEN
    INSERT INTO public.company_subscriptions (
      company_id,
      plan_id,
      status,
      trial_start,
      trial_end,
      trial_extended,
      stripe_subscription_id,
      stripe_price_id,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      billing_cycle
    )
    VALUES (
      v_new_company_id,
      v_growth_plan_id,
      'trialing',
      v_trial_start,
      v_trial_end,
      false,
      NULL,   -- sem Stripe durante trial
      NULL,   -- sem price_id Stripe durante trial
      NULL,   -- current_period_start não se aplica durante trial
      NULL,   -- current_period_end não se aplica durante trial
      false,
      'monthly'
    )
    ON CONFLICT (company_id) DO NOTHING;
    -- ON CONFLICT DO NOTHING: se por algum motivo já existir um registro
    -- (ex: retry), não sobrescreve. Seguro.
  END IF;
  -- ────────────────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'success',       true,
    'company_id',    v_new_company_id,
    'auto_assigned', v_is_partner,
    'trial_started', v_growth_plan_id IS NOT NULL,
    'trial_end',     CASE WHEN v_growth_plan_id IS NOT NULL
                       THEN v_trial_end::text
                       ELSE NULL
                     END
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client_company_safe(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_client_company_safe IS
  'Cria empresa client de forma transacional e atômica. '
  'Desde Etapa 2 do módulo de trial: define plan_id=Growth e cria '
  'company_subscriptions com status=trialing e trial_end=NOW()+14d. '
  'Apenas super_admin, system_admin ou partner podem chamar. '
  'Nunca toca em empresas existentes — apenas no INSERT desta execução.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CRIAR expire_overdue_trials()
--
-- Chamada pelo cron job diário (/api/cron/expire-trials).
-- Expira trials vencidos: status='trialing' + trial_end < NOW() + sem Stripe.
-- Para cada empresa expirada:
--   - company_subscriptions.status → 'canceled'
--   - companies.plan_id → plano 'suspended' (via apply_operational_plan_change)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suspended_plan_id  uuid;
  v_company_id         uuid;
  v_expired_count      integer := 0;
  v_error_count        integer := 0;
  v_result             jsonb;
BEGIN
  -- Resolver plano suspended
  SELECT id INTO v_suspended_plan_id
    FROM public.plans
   WHERE slug = 'suspended'
     AND is_active = true
   LIMIT 1;

  IF v_suspended_plan_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'plano suspended não encontrado. Execute a migration de seed de planos.',
      'expired', 0
    );
  END IF;

  -- Processar cada trial expirado
  FOR v_company_id IN
    SELECT cs.company_id
      FROM public.company_subscriptions cs
     WHERE cs.status = 'trialing'
       AND cs.trial_end < now()
       AND cs.stripe_subscription_id IS NULL  -- apenas trial interno
     ORDER BY cs.trial_end                    -- mais antigos primeiro
  LOOP
    BEGIN
      -- Marcar subscription como cancelada
      UPDATE public.company_subscriptions
         SET status     = 'canceled',
             updated_at = now()
       WHERE company_id = v_company_id
         AND status     = 'trialing';         -- guard: só atualiza se ainda trialing

      -- Aplicar plano suspended via RPC já existente
      SELECT public.apply_operational_plan_change(
        v_company_id,
        v_suspended_plan_id,
        NULL,   -- sem plan_change_request_id
        NULL    -- sem stripe_event_id
      ) INTO v_result;

      v_expired_count := v_expired_count + 1;

      RAISE LOG 'expire_overdue_trials: trial expirado | company_id=% | result=%',
        v_company_id, v_result;

    EXCEPTION WHEN others THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'expire_overdue_trials: erro ao expirar company_id=% | %',
        v_company_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',     true,
    'expired',     v_expired_count,
    'errors',      v_error_count,
    'executed_at', now()
  );
END;
$$;

-- Apenas service_role pode chamar diretamente (o cron usa service_role)
-- authenticated NÃO recebe GRANT — endpoint de cron valida via CRON_SECRET
REVOKE ALL ON FUNCTION public.expire_overdue_trials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_overdue_trials() FROM authenticated;

COMMENT ON FUNCTION public.expire_overdue_trials IS
  'Expira trials vencidos: status=trialing + trial_end < NOW() + stripe_subscription_id IS NULL. '
  'Para cada empresa: company_subscriptions.status → canceled e companies.plan_id → suspended. '
  'Chamada pelo cron /api/cron/expire-trials (service_role). '
  'Nunca chamada por usuários autenticados.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CRIAR extend_company_trial()
--
-- Concede extensão de +14 dias ao trial de uma empresa client.
-- Validações:
--   - Caller deve ser super_admin ou system_admin em empresa parent
--   - Empresa alvo deve ser client com parent_company_id = empresa do caller
--   - trial_extended deve ser false (máximo 1 extensão)
--   - stripe_subscription_id IS NULL (não estender se já converteu para Stripe)
-- Também reativa trial se havia expirado (status='canceled', sem Stripe).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.extend_company_trial(
  p_company_id    uuid,
  p_requester_id  uuid,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id          uuid := auth.uid();
  v_caller_role        text;
  v_caller_company_id  uuid;
  v_caller_company_type text;
  v_target_type        text;
  v_target_parent_id   uuid;
  v_growth_plan_id     uuid;
  v_sub                record;
  v_original_end       timestamptz;
  v_new_end            timestamptz;
BEGIN
  -- 1. Caller autenticado e corresponde ao p_requester_id
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF v_caller_id <> p_requester_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'requester_id mismatch');
  END IF;

  -- 2. Validar role do caller: deve ser super_admin ou system_admin em empresa parent
  SELECT cu.role, cu.company_id, c.company_type
    INTO v_caller_role, v_caller_company_id, v_caller_company_type
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
   WHERE cu.user_id   = v_caller_id
     AND cu.is_active = true
     AND c.company_type = 'parent'
     AND cu.role IN ('super_admin', 'system_admin')
   ORDER BY cu.created_at
   LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden: apenas super_admin ou system_admin de empresa parent podem estender trials'
    );
  END IF;

  -- 3. Validar empresa alvo: deve ser client e filha da parent do caller
  SELECT company_type, parent_company_id
    INTO v_target_type, v_target_parent_id
    FROM public.companies
   WHERE id = p_company_id;

  IF v_target_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'target company not found');
  END IF;

  IF v_target_type <> 'client' THEN
    RETURN jsonb_build_object('success', false, 'error', 'target is not a client company');
  END IF;

  IF v_target_parent_id <> v_caller_company_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden: empresa alvo não pertence à sua parent company'
    );
  END IF;

  -- 4. Buscar subscription atual da empresa alvo
  SELECT *
    INTO v_sub
    FROM public.company_subscriptions
   WHERE company_id = p_company_id;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa não possui subscription — trial não iniciado'
    );
  END IF;

  -- 5. Verificar que não há Stripe ativo (trial interno apenas)
  IF v_sub.stripe_subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa já possui subscription Stripe ativa — extensão de trial não aplicável'
    );
  END IF;

  -- 6. Verificar limite de 1 extensão por empresa
  IF v_sub.trial_extended = true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'trial já foi estendido — apenas 1 extensão permitida por empresa'
    );
  END IF;

  -- 7. Verificar que empresa está em trial ou trial expirado (candidata a extensão)
  IF v_sub.status NOT IN ('trialing', 'canceled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa não está em estado de trial — extensão não aplicável (status: ' || v_sub.status || ')'
    );
  END IF;

  -- 8. Calcular nova data de trial_end
  --    Se ainda em trial: trial_end atual + 14 dias
  --    Se expirado (canceled): agora + 14 dias (reativa trial)
  v_original_end := v_sub.trial_end;
  v_new_end := GREATEST(v_sub.trial_end, now()) + interval '14 days';

  -- 9. Se trial havia expirado, resolver Growth plan para reativar
  IF v_sub.status = 'canceled' THEN
    SELECT id INTO v_growth_plan_id
      FROM public.plans
     WHERE slug = 'growth'
       AND is_active = true
     LIMIT 1;

    IF v_growth_plan_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'plano Growth não encontrado — não é possível reativar trial'
      );
    END IF;
  END IF;

  -- 10. Atualizar company_subscriptions
  UPDATE public.company_subscriptions
     SET trial_end      = v_new_end,
         trial_extended = true,
         status         = 'trialing',    -- reativa se estava canceled
         updated_at     = now()
   WHERE company_id = p_company_id;

  -- 11. Se trial havia expirado: reativar plan_id para Growth
  IF v_sub.status = 'canceled' AND v_growth_plan_id IS NOT NULL THEN
    PERFORM public.apply_operational_plan_change(
      p_company_id,
      v_growth_plan_id,
      NULL,
      NULL
    );
  END IF;

  -- 12. Registrar na auditoria
  INSERT INTO public.trial_extensions (
    company_id,
    extended_by,
    extended_at,
    original_end,
    new_end,
    notes
  )
  VALUES (
    p_company_id,
    v_caller_id,
    now(),
    v_original_end,
    v_new_end,
    p_notes
  );

  RETURN jsonb_build_object(
    'success',       true,
    'company_id',    p_company_id,
    'original_end',  v_original_end,
    'new_end',       v_new_end,
    'reactivated',   v_sub.status = 'canceled'
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Apenas authenticated pode chamar (o endpoint backend valida role antes)
GRANT EXECUTE ON FUNCTION public.extend_company_trial(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.extend_company_trial IS
  'Estende trial de empresa client por +14 dias. Máximo 1 extensão por empresa. '
  'Apenas super_admin/system_admin de empresa parent pode chamar. '
  'Valida hierarquia parent→client no banco — nunca confia no frontend. '
  'Registra auditoria em trial_extensions. '
  'Reativa trial se havia expirado (status=canceled + stripe IS NULL).';


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO FINAL
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE LOG '=== trial_company_creation aplicada com sucesso ===';
  RAISE LOG '  create_client_company_safe: atualizada com trial automático (plan_id=Growth, trialing, 14 dias)';
  RAISE LOG '  expire_overdue_trials:      criada (cron de expiração)';
  RAISE LOG '  extend_company_trial:       criada (extensão por admin, max 1x, +14 dias fixo)';
  RAISE LOG '  retroativo:                 NENHUM registro criado ou alterado';
  RAISE LOG '  empresas existentes:        NÃO ALTERADAS';
END;
$$;
