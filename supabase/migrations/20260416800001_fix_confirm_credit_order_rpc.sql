-- =============================================================================
-- Migration: fix_confirm_credit_order_rpc
--
-- Corrige a RPC confirm_credit_order_payment:
--
-- PROBLEMA 1: balance_after incorreto
--   A versão anterior calculava balance_after = old_extra + credits_snapshot,
--   ignorando plan_credits. O correto é plan_credits + new_extra.
--
-- PROBLEMA 2: plan_balance_after NULL
--   A versão anterior não preenchia plan_balance_after. Para auditoria
--   completa, o campo deve ser preenchido com o valor atual de plan_credits
--   (não alterado por compras — apenas por renovações de plano).
--
-- PROBLEMA 3: race condition no ledger sob concorrência
--   A versão anterior lia company_credits sem FOR UPDATE. Duas confirmações
--   simultâneas de orders diferentes da mesma empresa geravam balance_after
--   impreciso no ledger (embora o saldo final em extra_credits fosse correto).
--
-- SOLUÇÃO:
--   1. SELECT ... FOR UPDATE em company_credits (serializa escritas por empresa)
--   2. UPDATE direto (não ON CONFLICT) — row garantida para toda empresa
--   3. Cálculo correto de todos os campos de balanço
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_credit_order_payment(
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order          public.credit_orders%ROWTYPE;
  v_plan_credits   INTEGER;
  v_old_extra      INTEGER;
  v_new_extra      INTEGER;
  v_total_after    INTEGER;
BEGIN
  -- ── a. Buscar e travar a order ──────────────────────────────────────────────
  SELECT * INTO v_order
  FROM public.credit_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- ── b. Idempotência: já foi paga? ───────────────────────────────────────────
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- ── c. Validar status permitido ─────────────────────────────────────────────
  IF v_order.status NOT IN ('pending_payment', 'checkout_created') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'order_not_confirmable',
      'current_status', v_order.status
    );
  END IF;

  -- ── d. Garantia adicional: paid_at deve ser NULL ────────────────────────────
  IF v_order.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- ── e. Travar e ler saldo atual de company_credits ──────────────────────────
  --
  -- FOR UPDATE em company_credits serializa confirmações concorrentes de orders
  -- diferentes da mesma empresa. Garante que balance_after no ledger seja preciso.
  --
  -- A row existe para toda empresa (inicializada em create_ai_credits_system.sql).
  -- Usamos SELECT ... FOR UPDATE + UPDATE direto (sem ON CONFLICT).

  SELECT
    COALESCE(plan_credits,  0),
    COALESCE(extra_credits, 0)
  INTO v_plan_credits, v_old_extra
  FROM public.company_credits
  WHERE company_id = v_order.company_id
  FOR UPDATE;

  -- Calcular novos saldos
  v_new_extra   := v_old_extra + v_order.credits_snapshot;
  v_total_after := v_plan_credits + v_new_extra;

  -- ── f. Incrementar extra_credits (UPDATE direto — row garantida) ────────────
  UPDATE public.company_credits
  SET extra_credits = v_new_extra
  WHERE company_id  = v_order.company_id;

  -- ── g. Registrar no ledger com todos os saldos corretos ────────────────────
  --
  -- balance_after      = plan_credits + new_extra  (saldo total pós-operação)
  -- plan_balance_after = plan_credits              (inalterado por compra)
  -- extra_balance_after = new_extra               (após adição dos créditos comprados)
  -- metadata contém rastreabilidade completa para reconciliação futura com Stripe

  INSERT INTO public.credit_transactions (
    company_id,
    type,
    credits,
    balance_after,
    plan_balance_after,
    extra_balance_after,
    metadata
  ) VALUES (
    v_order.company_id,
    'purchase',
    v_order.credits_snapshot,
    v_total_after,
    v_plan_credits,
    v_new_extra,
    jsonb_build_object(
      'order_id',         v_order.id,
      'package_id',       v_order.package_id,
      'source',           'credit_order',
      'price_snapshot',   v_order.price_snapshot,
      'credits_snapshot', v_order.credits_snapshot
    )
  );

  -- ── h. Marcar order como paga ───────────────────────────────────────────────
  UPDATE public.credit_orders
  SET
    status  = 'paid',
    paid_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'credits_added', v_order.credits_snapshot);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_credit_order_payment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_credit_order_payment(UUID) TO service_role;

COMMENT ON FUNCTION public.confirm_credit_order_payment IS
  'Confirma um pedido de créditos atomicamente. SECURITY DEFINER. '
  'FOR UPDATE em credit_orders e company_credits garante serialização e ledger preciso. '
  'Único ponto de write para extra_credits e credit_transactions do tipo purchase. '
  'Idempotente: retorna success=true se já pago.';
