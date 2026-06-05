-- =============================================================================
-- Migration: add_free_plan_support
-- Data: 2026-06-05
--
-- O que esta migration faz:
--   1. Adiciona coluna is_free à tabela company_subscriptions
--   2. Cria RPC set_company_free_plan — exclusiva de super_admin
--   3. Reescreve expire_overdue_trials — ignora empresas com is_free = true
--
-- Regras de segurança:
--   - set_company_free_plan recebe p_actor_user_id explicitamente (nunca auth.uid())
--     porque é chamada pelo backend com service_role, que não propaga o JWT do usuário
--   - Toda validação de permissão usa p_actor_user_id contra company_users
--   - Apenas role = 'super_admin' em empresa parent tem acesso (system_admin excluído)
--   - SECURITY DEFINER + SET search_path = public em todas as funções criadas/alteradas
--
-- O que esta migration NÃO faz:
--   ✗ NÃO altera RLS de nenhuma tabela existente
--   ✗ NÃO altera regras multi-tenant
--   ✗ NÃO concede acesso ao system_admin
--   ✗ NÃO toca em Stripe, planos, leads ou qualquer outro fluxo existente
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. COLUNA is_free em company_subscriptions
--
-- is_free = true → empresa dispensada de pagamento; trial nunca expira pelo cron.
-- Default false: nenhum comportamento existente é alterado.
-- NOT NULL: sem ambiguidade de NULL semântico.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_subscriptions.is_free IS
  'Indica que a empresa opera em plano gratuito concedido manualmente por um super_admin. '
  'Quando true: empresa mantém plan_id=Growth, status=active e nunca é expirada pelo cron. '
  'Apenas super_admin pode alterar este campo via set_company_free_plan(). '
  'Não afeta empresas com stripe_subscription_id — guard na RPC impede isso.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC set_company_free_plan
--
-- Concede ou revoga o plano gratuito para uma empresa filha.
--
-- Parâmetros:
--   p_actor_user_id  uuid  — usuário que está executando a ação (validado internamente)
--   p_company_id     uuid  — empresa filha alvo
--   p_is_free        bool  — true = conceder, false = revogar
--
-- Retorna jsonb:
--   { success: true,  is_free: boolean }
--   { success: false, error: '<código>' }
--
-- Códigos de erro:
--   forbidden                — actor não é super_admin ativo em empresa parent
--   company_not_found        — empresa alvo não existe ou está deletada
--   not_a_client_company     — empresa alvo não é do tipo 'client'
--   subscription_not_found   — empresa não possui registro em company_subscriptions
--   has_stripe_subscription  — empresa possui stripe_subscription_id (operação bloqueada)
--   growth_plan_not_found    — plano Growth não existe ou está inativo
--
-- Comportamento ao CONCEDER (p_is_free = true):
--   - company_subscriptions.status     → 'active'
--   - company_subscriptions.is_free    → true
--   - companies.plan_id                → Growth (nunca NULL)
--
-- Comportamento ao REVOGAR (p_is_free = false):
--   - company_subscriptions.is_free    → false
--   - status e plan_id permanecem inalterados
--   - empresa continua operacional até que um administrador tome outra ação
--     (nova assinatura, Stripe, suspensão manual, etc.)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_company_free_plan(
  p_actor_user_id uuid,
  p_company_id    uuid,
  p_is_free       boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company        companies%ROWTYPE;
  v_sub            company_subscriptions%ROWTYPE;
  v_growth_plan_id uuid;
BEGIN

  -- ── 1. Validar que o actor é super_admin ativo em empresa parent ──────────
  --       system_admin é excluído explicitamente (role = 'super_admin' apenas)
  IF NOT EXISTS (
    SELECT 1
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
    WHERE cu.user_id     = p_actor_user_id
      AND cu.role        = 'super_admin'
      AND cu.is_active   = true
      AND c.company_type = 'parent'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- ── 2. Empresa alvo deve existir e não estar deletada ────────────────────
  SELECT * INTO v_company
  FROM public.companies
  WHERE id = p_company_id
    AND deleted_at IS NULL;

  IF v_company.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  -- ── 3. Empresa alvo deve ser do tipo 'client' ────────────────────────────
  IF v_company.company_type <> 'client' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_client_company');
  END IF;

  -- ── 4. Validar que existe registro em company_subscriptions ──────────────
  SELECT * INTO v_sub
  FROM public.company_subscriptions
  WHERE company_id = p_company_id;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found');
  END IF;

  -- ── 5. Bloquear se empresa já tem Stripe ativo ───────────────────────────
  IF v_sub.stripe_subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'has_stripe_subscription');
  END IF;

  -- ── 6. Conceder plano gratuito ───────────────────────────────────────────
  IF p_is_free THEN

    -- Localizar plano Growth ativo (guard: nunca setar plan_id = NULL)
    SELECT id INTO v_growth_plan_id
    FROM public.plans
    WHERE slug      = 'growth'
      AND is_active = true
    LIMIT 1;

    IF v_growth_plan_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'growth_plan_not_found');
    END IF;

    -- Ativar: status = active, is_free = true
    UPDATE public.company_subscriptions
    SET is_free    = true,
        status     = 'active',
        updated_at = now()
    WHERE company_id = p_company_id;

    -- Garantir plan_id = Growth (nunca NULL)
    UPDATE public.companies
    SET plan_id    = v_growth_plan_id,
        updated_at = now()
    WHERE id = p_company_id;

  -- ── 7. Revogar plano gratuito ────────────────────────────────────────────
  ELSE

    -- Apenas remove o flag. Status e plan_id permanecem inalterados.
    -- A empresa continuará operacional até que um administrador tome outra
    -- ação (nova assinatura Stripe, trial manual, suspensão, etc.).
    UPDATE public.company_subscriptions
    SET is_free    = false,
        updated_at = now()
    WHERE company_id = p_company_id;

  END IF;

  RETURN jsonb_build_object('success', true, 'is_free', p_is_free);
END;
$$;

-- Apenas service_role pode chamar diretamente (o backend usa service_role)
-- authenticated NÃO recebe GRANT — o endpoint valida role antes de chamar
REVOKE ALL ON FUNCTION public.set_company_free_plan(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_company_free_plan(uuid, uuid, boolean) FROM authenticated;

COMMENT ON FUNCTION public.set_company_free_plan IS
  'Concede ou revoga plano gratuito para empresa filha. Exclusivo de super_admin. '
  'Recebe p_actor_user_id explicitamente (backend usa service_role, não propaga JWT). '
  'Ao conceder: status=active, is_free=true, plan_id=Growth. '
  'Ao revogar: apenas is_free=false; status/plan_id permanecem inalterados. '
  'Bloqueia empresas com stripe_subscription_id ativo.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. REESCREVER expire_overdue_trials — ignorar is_free = true
--
-- A única alteração em relação à versão anterior é a adição de:
--   AND cs.is_free = false
-- na query do FOR LOOP, garantindo que empresas gratuitas nunca sejam expiradas.
--
-- Todos os outros comportamentos são preservados identicamente.
-- SECURITY DEFINER + SET search_path = public mantidos.
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
  -- is_free = false: empresas gratuitas nunca são expiradas por este cron
  FOR v_company_id IN
    SELECT cs.company_id
      FROM public.company_subscriptions cs
     WHERE cs.status                 = 'trialing'
       AND cs.trial_end              < now()
       AND cs.stripe_subscription_id IS NULL   -- apenas trial interno
       AND cs.is_free                = false   -- ignorar empresas gratuitas
     ORDER BY cs.trial_end                     -- mais antigos primeiro
  LOOP
    BEGIN
      -- Marcar subscription como cancelada
      UPDATE public.company_subscriptions
         SET status     = 'canceled',
             updated_at = now()
       WHERE company_id = v_company_id
         AND status     = 'trialing';           -- guard: só atualiza se ainda trialing

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

-- Permissões preservadas da versão original
REVOKE ALL ON FUNCTION public.expire_overdue_trials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_overdue_trials() FROM authenticated;

COMMENT ON FUNCTION public.expire_overdue_trials IS
  'Expira trials vencidos: status=trialing + trial_end < NOW() + stripe_subscription_id IS NULL + is_free = false. '
  'Para cada empresa: company_subscriptions.status → canceled e companies.plan_id → suspended. '
  'Empresas com is_free = true são ignoradas — nunca expiradas por este cron. '
  'Chamada pelo cron /api/cron/expire-trials (service_role). '
  'Nunca chamada por usuários autenticados.';


DO $$
BEGIN
  RAISE LOG '=== add_free_plan_support aplicada com sucesso ===';
  RAISE LOG '  company_subscriptions.is_free: coluna adicionada (boolean NOT NULL DEFAULT false)';
  RAISE LOG '  set_company_free_plan:         criada (super_admin exclusivo, p_actor_user_id explícito)';
  RAISE LOG '  expire_overdue_trials:         reescrita com guard AND cs.is_free = false';
  RAISE LOG '  empresas existentes:           NÃO ALTERADAS (is_free = false por padrão)';
END;
$$;
