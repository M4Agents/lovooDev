-- =============================================================================
-- Migration: create_credit_orders
--
-- Cria o sistema de pedidos de compra de créditos avulsos de IA.
--
-- Inclui:
--   1. ALTER credit_packages — adicionar is_available_for_sale
--   2. Tabela credit_orders com 6 status e constraints de idempotência
--   3. RLS para credit_orders
--   4. Trigger updated_at em credit_orders
--   5. RPC confirm_credit_order_payment (SECURITY DEFINER, atômica, idempotente)
-- =============================================================================

-- ── 1. Adicionar is_available_for_sale a credit_packages ─────────────────────
--
-- is_active            = pacote válido e gerenciável no sistema
-- is_available_for_sale = pacote disponível para compra pelas empresas filhas

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS is_available_for_sale BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.credit_packages.is_available_for_sale IS
  'Controla se o pacote aparece para compra pelas empresas filhas. Distinto de is_active (que controla visibilidade na governança).';

-- ── 2. Tabela credit_orders ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_orders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id)        ON DELETE CASCADE,
  package_id            UUID        NOT NULL REFERENCES public.credit_packages(id)  ON DELETE RESTRICT,
  credits_snapshot      INTEGER     NOT NULL,
  price_snapshot        NUMERIC(10,2) NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'pending_payment'
                        CONSTRAINT credit_orders_status_check
                          CHECK (status IN (
                            'pending_payment',   -- order criada, nenhuma sessão de checkout ainda
                            'checkout_created',  -- sessão Stripe criada (stripe_session_id preenchido)
                            'paid',             -- pagamento confirmado, créditos creditados
                            'failed',           -- falha no pagamento reportada pelo Stripe
                            'cancelled',        -- cancelada antes do pagamento
                            'expired'           -- sessão Stripe expirou sem pagamento
                          )),
  stripe_session_id     TEXT        UNIQUE,         -- Stripe Checkout Session ID
  stripe_payment_intent TEXT        UNIQUE,         -- PaymentIntent — idempotência pós-webhook
  paid_at               TIMESTAMPTZ,                -- preenchido apenas ao confirmar (status=paid)
  requested_by          UUID        NOT NULL REFERENCES auth.users(id),
  metadata              JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_orders IS 'Pedidos de compra de créditos avulsos de IA pelas empresas filhas. Estrutura Stripe-ready.';
COMMENT ON COLUMN public.credit_orders.credits_snapshot IS 'Créditos do pacote no momento do pedido — imune a alterações posteriores no pacote.';
COMMENT ON COLUMN public.credit_orders.price_snapshot IS 'Preço do pacote no momento do pedido — imune a alterações posteriores no pacote.';
COMMENT ON COLUMN public.credit_orders.stripe_session_id IS 'ID da Checkout Session do Stripe. UNIQUE impede sessões duplicadas. Preenchido ao chamar stripe.checkout.sessions.create().';
COMMENT ON COLUMN public.credit_orders.stripe_payment_intent IS 'ID do PaymentIntent do Stripe. UNIQUE é a linha de defesa em profundidade contra webhooks duplicados.';

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_credit_orders_company_id   ON public.credit_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_credit_orders_status        ON public.credit_orders (status);
CREATE INDEX IF NOT EXISTS idx_credit_orders_company_pkg   ON public.credit_orders (company_id, package_id, status, created_at);

-- ── 3. Trigger updated_at ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_credit_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_orders_updated_at ON public.credit_orders;
CREATE TRIGGER trg_credit_orders_updated_at
  BEFORE UPDATE ON public.credit_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_credit_orders_updated_at();

-- ── 4. RLS para credit_orders ─────────────────────────────────────────────────

ALTER TABLE public.credit_orders ENABLE ROW LEVEL SECURITY;

-- Empresa filha: vê apenas seus próprios pedidos
CREATE POLICY "credit_orders_select_own_company"
  ON public.credit_orders
  FOR SELECT
  USING (
    auth_user_is_company_member(company_id)
  );

-- Admins de plataforma: vêem todos
CREATE POLICY "credit_orders_select_platform_admin"
  ON public.credit_orders
  FOR SELECT
  USING (
    auth_user_is_platform_admin()
  );

-- INSERT: apenas via service_role (backend valida company_id via resolveCreditsContext)
-- Nenhuma policy de INSERT para anon/authenticated — backend usa service_role

-- ── 5. RPC confirm_credit_order_payment ──────────────────────────────────────
--
-- Executa atomicamente:
--   a. SELECT ... FOR UPDATE na order (serializa concorrência)
--   b. Valida status e paid_at (idempotência)
--   c. Incrementa extra_credits em company_credits
--   d. Insere em credit_transactions com metadata completo para rastreabilidade
--   e. Atualiza credit_orders status=paid, paid_at=now()
--
-- SEGURANÇA: SECURITY DEFINER — único ponto de write autorizado para type='purchase'.
-- IDEMPOTÊNCIA: retorna success=true se já estiver pago (sem erro, sem duplicidade).

CREATE OR REPLACE FUNCTION public.confirm_credit_order_payment(
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.credit_orders%ROWTYPE;
  v_balance_before INTEGER;
  v_balance_after  INTEGER;
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

  -- ── e. Obter saldo atual antes do crédito ───────────────────────────────────
  SELECT COALESCE(extra_credits, 0) INTO v_balance_before
  FROM public.company_credits
  WHERE company_id = v_order.company_id;

  v_balance_after := COALESCE(v_balance_before, 0) + v_order.credits_snapshot;

  -- ── f. Incrementar extra_credits ────────────────────────────────────────────
  INSERT INTO public.company_credits (company_id, extra_credits)
  VALUES (v_order.company_id, v_order.credits_snapshot)
  ON CONFLICT (company_id) DO UPDATE
    SET extra_credits = public.company_credits.extra_credits + v_order.credits_snapshot;

  -- ── g. Registrar no ledger com metadata completo ────────────────────────────
  INSERT INTO public.credit_transactions (
    company_id,
    type,
    credits,
    balance_after,
    extra_balance_after,
    metadata
  ) VALUES (
    v_order.company_id,
    'purchase',
    v_order.credits_snapshot,
    v_balance_after,
    v_balance_after,
    jsonb_build_object(
      'order_id',        v_order.id,
      'package_id',      v_order.package_id,
      'source',          'credit_order',
      'price_snapshot',  v_order.price_snapshot,
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
  'Confirma um pedido de créditos atomicamente. SECURITY DEFINER. Único ponto de write para extra_credits e credit_transactions do tipo purchase. Idempotente: retorna success=true se já pago.';
