-- =============================================================================
-- Migration: billing_layer_pre_stripe
-- Data: 2026-05-02
--
-- Camada mínima obrigatória para preparar a arquitetura de planos para
-- integração futura com Stripe. NÃO cria endpoints nem webhooks Stripe.
--
-- O que esta migration faz:
--   1. ALTER companies    → adiciona stripe_customer_id
--   2. ALTER plans        → adiciona stripe_price_id_monthly
--   3. CREATE company_subscriptions → tabela de estado contratual/billing
--   4. ALTER plan_change_requests → adiciona origin, stripe_event_id,
--                                   stripe_checkout_session_id
--
-- Separação de responsabilidades (CRÍTICO — não misturar):
--   companies.plan_id          = estado operacional vigente (enforcement)
--   company_subscriptions      = estado contratual/billing (Stripe)
--   plan_change_requests       = trilha de auditoria de todas as mudanças
--
-- A mudança de companies.plan_id NUNCA ocorre diretamente por webhook.
-- Sempre passa por RPC controlada no backend.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER companies — stripe_customer_id
--
-- Associa cada empresa pagante a um Customer do Stripe.
-- UNIQUE: cada empresa tem exatamente 1 customer Stripe.
-- NULL permitido: empresas que ainda não passaram pelo billing Stripe.
-- Preenchido pelo backend quando o primeiro Checkout é criado.
-- NUNCA vem do frontend.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Constraint UNIQUE separada (IF NOT EXISTS não suporta UNIQUE inline em ALTER)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_stripe_customer_id_unique'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_stripe_customer_id_unique
      UNIQUE (stripe_customer_id);
  END IF;
END;
$$;

COMMENT ON COLUMN public.companies.stripe_customer_id IS
  'ID do Customer no Stripe (cus_XXXX). '
  'UNIQUE: 1 empresa = 1 customer Stripe. '
  'NULL para empresas sem billing Stripe ativo. '
  'Preenchido pelo backend na criação do primeiro Checkout. '
  'NUNCA receber do frontend.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. ALTER plans — stripe_price_id_monthly
--
-- Associa cada plano vendável ao Price mensal correspondente no Stripe.
-- Planos custom (Elite, planos internos) ficam com NULL → não vendáveis via Stripe.
-- is_publicly_listed = true + stripe_price_id_monthly IS NOT NULL = vendável via self-service.
-- yearly reservado para fase futura (stripe_price_id_yearly).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_stripe_price_id_monthly_unique'
      AND conrelid = 'public.plans'::regclass
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_stripe_price_id_monthly_unique
      UNIQUE (stripe_price_id_monthly);
  END IF;
END;
$$;

COMMENT ON COLUMN public.plans.stripe_price_id_monthly IS
  'Price ID do Stripe para cobrança mensal (price_XXXX). '
  'UNIQUE: cada Price Stripe pertence a exatamente 1 plano. '
  'NULL para planos custom/Elite que não são vendidos via Stripe self-service. '
  'Fonte de verdade para criação de Checkout Sessions e Subscriptions. '
  'Não confundir com plans.price (referência interna, não enforçada pelo Stripe).';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE company_subscriptions
--
-- Tabela de estado contratual/billing por empresa.
-- Uma linha por empresa (UNIQUE company_id).
-- Espelha o estado da Subscription no Stripe após integração.
-- Antes do Stripe: pode ser criada manualmente pelo admin ou via RPC de aprovação.
--
-- SEPARAÇÃO CRÍTICA:
--   Esta tabela representa o CONTRATO (billing).
--   companies.plan_id representa o ENFORCEMENT (operacional).
--   A mudança de companies.plan_id dispara o enforcement existente (triggers, limits).
--   company_subscriptions.plan_id e companies.plan_id devem estar em sincronia,
--   mas são atualizados por caminhos distintos: companies.plan_id pela RPC de aprovação,
--   company_subscriptions pela RPC de billing.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK para a empresa — 1:1 (UNIQUE)
  company_id            UUID        NOT NULL UNIQUE
                        REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Plano contratado atualmente (billing reference).
  -- Deve ser mantido em sincronia com companies.plan_id.
  -- ON DELETE RESTRICT: não se pode remover um plano com assinaturas ativas.
  plan_id               UUID        NOT NULL
                        REFERENCES public.plans(id) ON DELETE RESTRICT,

  -- ──────────────────────────────────────────────────────────────────────────
  -- STATUS DA ASSINATURA
  -- Espelha os status possíveis do Stripe (+ 'active' para assinaturas manuais).
  --
  -- trialing          → em período de trial
  -- active            → assinatura ativa e paga (padrão para assinaturas manuais)
  -- past_due          → pagamento falhou mas período ainda vigente (retentativa)
  -- canceled          → assinatura cancelada (pode ter acesso até period_end)
  -- unpaid            → falha definitiva sem retentativa
  -- incomplete        → checkout iniciado mas não finalizado
  -- incomplete_expired→ checkout expirou
  -- paused            → assinatura pausada pelo admin
  -- ──────────────────────────────────────────────────────────────────────────
  status                TEXT        NOT NULL DEFAULT 'active'
                        CONSTRAINT cs_status_check
                        CHECK (status IN (
                          'trialing',
                          'active',
                          'past_due',
                          'canceled',
                          'unpaid',
                          'incomplete',
                          'incomplete_expired',
                          'paused'
                        )),

  -- ──────────────────────────────────────────────────────────────────────────
  -- IDs DO STRIPE (preenchidos após integração)
  -- ──────────────────────────────────────────────────────────────────────────

  -- Stripe Subscription ID (sub_XXXX). NULL antes do Stripe.
  stripe_subscription_id TEXT       UNIQUE,

  -- Stripe Price ID ativo na subscription. Pode divergir de plans.stripe_price_id_monthly
  -- em casos de override ou transição de preço.
  stripe_price_id       TEXT,

  -- ──────────────────────────────────────────────────────────────────────────
  -- VIGÊNCIA DO CICLO ATUAL
  -- current_period_end = "próxima cobrança" exibida no frontend.
  -- NULL antes do Stripe ou para assinaturas manuais sem ciclo definido.
  -- ──────────────────────────────────────────────────────────────────────────
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,

  -- ──────────────────────────────────────────────────────────────────────────
  -- TRIAL
  -- NULL se empresa nunca teve trial ou trial já expirou.
  -- ──────────────────────────────────────────────────────────────────────────
  trial_start           TIMESTAMPTZ,
  trial_end             TIMESTAMPTZ,

  -- ──────────────────────────────────────────────────────────────────────────
  -- CANCELAMENTO E DOWNGRADE AGENDADO
  --
  -- cancel_at_period_end = true → assinatura não renova; cancela em period_end.
  -- scheduled_plan_id = downgrade agendado para o próximo ciclo.
  --   Quando Stripe processar o webhook de renovação, backend aplica o plano
  --   agendado e zera scheduled_plan_id.
  -- canceled_at = timestamp exato do cancelamento (preenchido pelo webhook).
  -- ──────────────────────────────────────────────────────────────────────────
  cancel_at_period_end  BOOLEAN     NOT NULL DEFAULT false,
  scheduled_plan_id     UUID        REFERENCES public.plans(id) ON DELETE SET NULL,
  canceled_at           TIMESTAMPTZ,

  -- ──────────────────────────────────────────────────────────────────────────
  -- CICLO DE COBRANÇA DA EMPRESA (pode diferir do plans.billing_cycle default)
  -- ──────────────────────────────────────────────────────────────────────────
  billing_cycle         TEXT        NOT NULL DEFAULT 'monthly'
                        CONSTRAINT cs_billing_cycle_check
                        CHECK (billing_cycle IN ('monthly', 'yearly')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Comentários ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.company_subscriptions IS
  'Estado contratual/billing por empresa. Uma linha por empresa (1:1). '
  'Espelha o estado da Subscription no Stripe após integração. '
  'SEPARAÇÃO: esta tabela = billing. companies.plan_id = enforcement. '
  'Ambos devem estar em sincronia, mas são atualizados por caminhos distintos.';

COMMENT ON COLUMN public.company_subscriptions.plan_id IS
  'Plano contratado no billing. Deve espelhar companies.plan_id. '
  'Atualizado pela RPC de billing ao aprovar/processar mudança de plano.';

COMMENT ON COLUMN public.company_subscriptions.status IS
  'Status da assinatura espelhando os status possíveis do Stripe. '
  '''active'' para assinaturas manuais (antes do Stripe).';

COMMENT ON COLUMN public.company_subscriptions.stripe_subscription_id IS
  'ID da Subscription no Stripe (sub_XXXX). UNIQUE. '
  'NULL antes da integração Stripe.';

COMMENT ON COLUMN public.company_subscriptions.current_period_end IS
  'Fim do ciclo atual = "próxima cobrança". '
  'NULL para assinaturas manuais sem ciclo definido.';

COMMENT ON COLUMN public.company_subscriptions.scheduled_plan_id IS
  'Plano agendado para o próximo ciclo (downgrade futuro). '
  'Backend aplica este plano no webhook de renovação do Stripe e zera o campo. '
  'NULL = nenhum plano agendado.';

COMMENT ON COLUMN public.company_subscriptions.cancel_at_period_end IS
  'true = assinatura não renova; cancela em current_period_end. '
  'Atualizado pelo webhook customer.subscription.updated do Stripe.';

-- ── Índices ───────────────────────────────────────────────────────────────────

-- company_id já tem UNIQUE index implícito; índice explícito para FK lookups
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_plan_id
  ON public.company_subscriptions (plan_id);

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status
  ON public.company_subscriptions (status);

-- Índice parcial: encontrar assinaturas com downgrade agendado
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_scheduled_plan
  ON public.company_subscriptions (scheduled_plan_id)
  WHERE scheduled_plan_id IS NOT NULL;

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE TRIGGER set_updated_at_company_subscriptions
  BEFORE UPDATE ON public.company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Política mínima e segura:
--   SELECT: membro ativo da própria empresa (Trilha 1) OU admin empresa pai (Trilha 2)
--   INSERT/UPDATE/DELETE: apenas service_role (backend via RPC SECURITY DEFINER)
--     Nenhuma política de DML para authenticated → apenas service_role bypassa RLS
--
-- Justificativa: mudanças de billing são operações financeiras críticas.
-- Nunca devem ser feitas diretamente por código cliente.

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_select_member_or_parent_admin"
  ON public.company_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- Platform admin (super_admin/system_admin em empresa parent) vê todas
CREATE POLICY "cs_select_platform_admin"
  ON public.company_subscriptions
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

COMMENT ON POLICY "cs_select_member_or_parent_admin" ON public.company_subscriptions IS
  'Membro ativo da empresa vê a própria assinatura (Trilha 1). '
  'Admin da empresa pai vê assinatura de filhas (Trilha 2).';

COMMENT ON POLICY "cs_select_platform_admin" ON public.company_subscriptions IS
  'Platform admin (super_admin/system_admin em parent) vê todas as assinaturas. '
  'Para suporte e gestão interna.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. ALTER plan_change_requests — origin, stripe_event_id, stripe_checkout_session_id
--
-- origin: rastreia de onde veio a solicitação de mudança.
--   self_service    → empresa solicitou via UI (padrão atual)
--   admin           → platform admin alterou diretamente
--   stripe_webhook  → mudança processada via webhook do Stripe
--   system          → renovação automática, trial expiry, etc.
--
-- stripe_event_id: ID do evento Stripe que gerou esta entrada.
--   UNIQUE (parcial, apenas quando NOT NULL) — garante idempotência de webhook.
--   Se o mesmo evento chegar duas vezes, o segundo INSERT falha com conflict.
--
-- stripe_checkout_session_id: ID da Checkout Session que originou a mudança.
--   Permite reconciliar pedido com pagamento para suporte e contabilidade.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plan_change_requests
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'self_service'
    CONSTRAINT pcr_origin_check
    CHECK (origin IN ('self_service', 'admin', 'stripe_webhook', 'system')),

  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT,

  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

-- UNIQUE parcial em stripe_event_id (apenas quando preenchido)
-- Garante que o mesmo evento Stripe não gera duas entradas no ledger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pcr_stripe_event_id_unique
  ON public.plan_change_requests(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

COMMENT ON COLUMN public.plan_change_requests.origin IS
  'Origem da solicitação de mudança de plano. '
  'self_service: empresa via UI. admin: plataforma manualmente. '
  'stripe_webhook: evento do Stripe. system: automação interna.';

COMMENT ON COLUMN public.plan_change_requests.stripe_event_id IS
  'ID do evento Stripe que gerou esta entrada (evt_XXXX). '
  'UNIQUE parcial (quando NOT NULL) — garante idempotência de webhook. '
  'Segundo processamento do mesmo evento falha com unique_violation (tratável).';

COMMENT ON COLUMN public.plan_change_requests.stripe_checkout_session_id IS
  'ID da Checkout Session Stripe (cs_XXXX) que originou esta mudança. '
  'Permite reconciliar pedido de plano com pagamento para suporte e contabilidade.';

-- ══════════════════════════════════════════════════════════════════════════════
-- LOG
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE LOG 'billing_layer_pre_stripe aplicada:';
  RAISE LOG '  companies.stripe_customer_id adicionado (TEXT UNIQUE)';
  RAISE LOG '  plans.stripe_price_id_monthly adicionado (TEXT UNIQUE)';
  RAISE LOG '  company_subscriptions criada (RLS, índices, trigger updated_at)';
  RAISE LOG '  plan_change_requests: origin, stripe_event_id, stripe_checkout_session_id adicionados';
END;
$$;
