-- =============================================================================
-- Migration: add_admin_set_company_plan
-- Data: 2026-06-12
--
-- O que esta migration faz:
--   1. Cria RPC admin_set_company_plan — atribuição direta de plano por super_admin
--      sem fluxo Stripe (para empresas is_free = true gerenciadas pela plataforma)
--
-- Regras de segurança:
--   - Recebe p_actor_user_id explicitamente (backend usa service_role, não propaga JWT)
--   - Apenas role = 'super_admin' em empresa parent tem acesso (system_admin excluído)
--   - Bloqueia se a empresa tiver stripe_subscription_id ativo (esses são gerenciados pelo Stripe)
--   - SECURITY DEFINER + SET search_path = public
--
-- O que esta migration NÃO faz:
--   ✗ NÃO altera is_free (preserva estado atual da empresa)
--   ✗ NÃO toca em stripe_subscription_id, status ou trial_end
--   ✗ NÃO altera RLS de nenhuma tabela existente
--   ✗ NÃO concede acesso ao system_admin
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. RPC admin_set_company_plan
--
-- Atribui um plano diretamente a uma empresa filha, sem fluxo Stripe.
-- Exclusiva de super_admin — para gerenciamento direto de empresas is_free.
--
-- Parâmetros:
--   p_actor_user_id  uuid  — usuário que está executando a ação
--   p_company_id     uuid  — empresa filha alvo
--   p_plan_id        uuid  — plano a ser atribuído
--
-- Retorna jsonb:
--   { success: true,  plan_id: uuid, plan_name: text }
--   { success: false, error: '<código>' }
--
-- Códigos de erro:
--   forbidden                — actor não é super_admin ativo em empresa parent
--   company_not_found        — empresa alvo não existe ou está deletada
--   not_a_client_company     — empresa alvo não é do tipo 'client'
--   subscription_not_found   — empresa não possui registro em company_subscriptions
--   has_stripe_subscription  — empresa possui stripe_subscription_id ativo (use Stripe)
--   plan_not_found           — plano não existe ou está inativo
--
-- Comportamento:
--   - company_subscriptions.plan_id → p_plan_id
--   - companies.plan_id             → p_plan_id
--   - is_free, status, stripe_*     → inalterados
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_set_company_plan(
  p_actor_user_id uuid,
  p_company_id    uuid,
  p_plan_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company   companies%ROWTYPE;
  v_sub       company_subscriptions%ROWTYPE;
  v_plan_name text;
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

  -- ── 5. Bloquear se empresa tem Stripe ativo ───────────────────────────────
  --       Empresas com Stripe devem ser gerenciadas pelo portal do Stripe.
  IF v_sub.stripe_subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'has_stripe_subscription');
  END IF;

  -- ── 6. Validar que o plano existe e está ativo ────────────────────────────
  SELECT name INTO v_plan_name
  FROM public.plans
  WHERE id        = p_plan_id
    AND is_active = true;

  IF v_plan_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  -- ── 7. Atualizar plan_id nas duas tabelas ─────────────────────────────────
  UPDATE public.company_subscriptions
  SET plan_id    = p_plan_id,
      updated_at = now()
  WHERE company_id = p_company_id;

  UPDATE public.companies
  SET plan_id    = p_plan_id,
      updated_at = now()
  WHERE id = p_company_id;

  RETURN jsonb_build_object(
    'success',   true,
    'plan_id',   p_plan_id,
    'plan_name', v_plan_name
  );
END;
$$;

-- Apenas service_role pode chamar diretamente (o backend usa service_role)
REVOKE ALL ON FUNCTION public.admin_set_company_plan(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_company_plan(uuid, uuid, uuid) FROM authenticated;

COMMENT ON FUNCTION public.admin_set_company_plan IS
  'Atribui um plano diretamente a uma empresa filha sem fluxo Stripe. '
  'Exclusivo de super_admin. Recebe p_actor_user_id explicitamente. '
  'Atualiza companies.plan_id e company_subscriptions.plan_id. '
  'Não altera is_free, status ou campos Stripe. '
  'Bloqueia empresas com stripe_subscription_id ativo.';


DO $$
BEGIN
  RAISE LOG '=== add_admin_set_company_plan aplicada com sucesso ===';
  RAISE LOG '  admin_set_company_plan: criada (super_admin exclusivo, p_actor_user_id explícito)';
END;
$$;
