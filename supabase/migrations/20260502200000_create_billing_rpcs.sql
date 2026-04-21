-- =============================================================================
-- Migration: create_billing_rpcs
-- Data: 2026-05-02
--
-- Cria a infraestrutura de RPCs de billing para integração Stripe.
--
-- O que esta migration faz:
--   1. Adiciona last_stripe_event_id em company_subscriptions (idempotência)
--   2. Cria RPC sync_subscription_billing_state (sincronização contratual pura)
--   3. Cria RPC apply_operational_plan_change (aplicação operacional do plano)
--
-- SEPARAÇÃO CRÍTICA (não misturar):
--   sync_subscription_billing_state → atualiza APENAS company_subscriptions
--   apply_operational_plan_change   → atualiza companies.plan_id
--
-- SEGURANÇA:
--   Ambas as RPCs são SECURITY DEFINER.
--   REVOKE FROM PUBLIC + GRANT TO service_role → apenas backend pode chamar.
--   Jamais chamar do frontend.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Adicionar last_stripe_event_id em company_subscriptions
--
-- Armazena o ID do último evento Stripe processado para esta empresa.
-- Usado como camada de idempotência primária dentro de sync_subscription_billing_state.
-- Retries do mesmo evento são detectados e ignorados com segurança.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_id TEXT;

COMMENT ON COLUMN public.company_subscriptions.last_stripe_event_id IS
  'ID do último evento Stripe (evt_XXXX) processado para esta empresa. '
  'Usado por sync_subscription_billing_state para detectar retries idempotentes. '
  'Não é o mecanismo definitivo de deduplicação — apenas uma primeira linha de defesa.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC sync_subscription_billing_state
--
-- RESPONSABILIDADE EXCLUSIVA: sincronização contratual.
--   Atualiza company_subscriptions com o estado recebido do webhook Stripe.
--   NUNCA altera companies.plan_id.
--
-- CHAMADA POR: webhook handler (planWebhookHandler.js) via service_role.
--   Praticamente todos os eventos relevantes chamam esta função.
--
-- IDEMPOTÊNCIA:
--   Se p_stripe_event_id = last_stripe_event_id → retorna already_applied: true.
--   FOR UPDATE serializa chamadas concorrentes para a mesma empresa.
--
-- PARÂMETROS:
--   p_company_id              — empresa alvo (multi-tenant obrigatório)
--   p_plan_id                 — plano que o backend resolveu para o stripe_price_id
--   p_stripe_subscription_id  — ID da subscription Stripe (sub_XXXX)
--   p_stripe_price_id         — Price ID ativo (price_XXXX)
--   p_status                  — status da subscription (active, trialing, etc.)
--   p_current_period_start    — início do ciclo vigente
--   p_current_period_end      — fim do ciclo vigente (= próxima cobrança)
--   p_cancel_at_period_end    — true se assinatura não renova
--   p_billing_cycle           — monthly | yearly
--   p_stripe_event_id         — ID do evento Stripe (evt_XXXX) para idempotência
--   p_trial_start             — início do trial (NULL se não aplicável)
--   p_trial_end               — fim do trial (NULL se não aplicável)
--   p_canceled_at             — timestamp do cancelamento (NULL se não cancelada)
--   p_scheduled_plan_id       — plano agendado para downgrade (NULL = nenhum)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_subscription_billing_state(
  p_company_id              UUID,
  p_plan_id                 UUID,
  p_stripe_subscription_id  TEXT,
  p_stripe_price_id         TEXT,
  p_status                  TEXT,
  p_current_period_start    TIMESTAMPTZ,
  p_current_period_end      TIMESTAMPTZ,
  p_cancel_at_period_end    BOOLEAN,
  p_billing_cycle           TEXT,
  p_stripe_event_id         TEXT,
  p_trial_start             TIMESTAMPTZ DEFAULT NULL,
  p_trial_end               TIMESTAMPTZ DEFAULT NULL,
  p_canceled_at             TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_plan_id       UUID        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_event_id TEXT;
  v_billing_cycle     TEXT;
BEGIN

  -- ── 1. Validar company_id ────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  -- ── 2. Validar plan_id ───────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  -- ── 3. Normalizar billing_cycle (aceitar apenas valores válidos) ─────────────
  v_billing_cycle := CASE
    WHEN p_billing_cycle IN ('monthly', 'yearly') THEN p_billing_cycle
    ELSE 'monthly'
  END;

  -- ── 4. Idempotência: verificar se este evento já foi processado ──────────────
  --    FOR UPDATE serializa chamadas concorrentes para a mesma empresa.
  SELECT last_stripe_event_id
  INTO v_existing_event_id
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF FOUND AND v_existing_event_id IS NOT NULL AND v_existing_event_id = p_stripe_event_id THEN
    RETURN jsonb_build_object(
      'success',       true,
      'already_applied', true,
      'event_id',      p_stripe_event_id
    );
  END IF;

  -- ── 5. UPSERT em company_subscriptions ──────────────────────────────────────
  --    INSERT se não existe linha para a empresa.
  --    UPDATE se já existe (atualiza tudo com dados do evento).
  INSERT INTO public.company_subscriptions (
    company_id,
    plan_id,
    stripe_subscription_id,
    stripe_price_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    billing_cycle,
    trial_start,
    trial_end,
    canceled_at,
    scheduled_plan_id,
    last_stripe_event_id
  ) VALUES (
    p_company_id,
    p_plan_id,
    p_stripe_subscription_id,
    p_stripe_price_id,
    p_status,
    p_current_period_start,
    p_current_period_end,
    COALESCE(p_cancel_at_period_end, false),
    v_billing_cycle,
    p_trial_start,
    p_trial_end,
    p_canceled_at,
    p_scheduled_plan_id,
    p_stripe_event_id
  )
  ON CONFLICT (company_id) DO UPDATE SET
    plan_id                = EXCLUDED.plan_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    stripe_price_id        = EXCLUDED.stripe_price_id,
    status                 = EXCLUDED.status,
    current_period_start   = EXCLUDED.current_period_start,
    current_period_end     = EXCLUDED.current_period_end,
    cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
    billing_cycle          = EXCLUDED.billing_cycle,
    trial_start            = EXCLUDED.trial_start,
    trial_end              = EXCLUDED.trial_end,
    canceled_at            = EXCLUDED.canceled_at,
    -- scheduled_plan_id: só limpa se passou NULL explicitamente via parâmetro
    -- O handler passa NULL quando quer zerar (ex: após downgrade aplicado)
    scheduled_plan_id      = EXCLUDED.scheduled_plan_id,
    last_stripe_event_id   = EXCLUDED.last_stripe_event_id,
    updated_at             = now();

  RETURN jsonb_build_object(
    'success',  true,
    'event_id', p_stripe_event_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Segurança: apenas service_role (backend) pode chamar esta função.
REVOKE ALL ON FUNCTION public.sync_subscription_billing_state(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_subscription_billing_state(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) TO service_role;

COMMENT ON FUNCTION public.sync_subscription_billing_state IS
  'Sincronização contratual pura: atualiza company_subscriptions com dados do webhook Stripe. '
  'NUNCA altera companies.plan_id. '
  'Idempotente: retorna already_applied=true se mesmo stripe_event_id já foi processado. '
  'FOR UPDATE serializa chamadas concorrentes por empresa. '
  'Apenas service_role (backend) pode executar.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RPC apply_operational_plan_change
--
-- RESPONSABILIDADE EXCLUSIVA: aplicação operacional do plano.
--   Atualiza companies.plan_id → dispara enforcement existente (triggers, limits).
--   Opcionalmente fecha um plan_change_request como approved.
--   NUNCA atualiza company_subscriptions (responsabilidade de sync_subscription_billing_state).
--
-- CHAMADA POR: webhook handler apenas quando lógica de negócio confirma mudança.
--   Não é chamada para todos os eventos — apenas quando o plano operacional muda.
--
-- IDEMPOTÊNCIA:
--   Se companies.plan_id já é p_to_plan_id → retorna already_applied: true.
--   FOR UPDATE em companies serializa mudanças concorrentes de plano.
--   UNIQUE parcial em plan_change_requests(stripe_event_id) previne dupla inserção.
--
-- PARÂMETROS:
--   p_company_id              — empresa alvo (multi-tenant obrigatório)
--   p_to_plan_id              — plano a ser aplicado operacionalmente
--   p_plan_change_request_id  — UUID do PCR a aprovar (NULL = mudança automática sem PCR)
--   p_stripe_event_id         — ID do evento que gerou a mudança (para auditoria)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_operational_plan_change(
  p_company_id             UUID,
  p_to_plan_id             UUID,
  p_plan_change_request_id UUID DEFAULT NULL,
  p_stripe_event_id        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_plan_id UUID;
BEGIN

  -- ── 1. Travar e ler plano atual da empresa ───────────────────────────────────
  --    FOR UPDATE serializa mudanças concorrentes de plan_id para a mesma empresa.
  SELECT plan_id
  INTO v_current_plan_id
  FROM public.companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  -- ── 2. Validar plano destino ─────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_to_plan_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  -- ── 3. Idempotência: plano já está aplicado? ─────────────────────────────────
  --    Se companies.plan_id já é o plano destino → mudança já ocorreu.
  --    Retorna sucesso sem aplicar novamente.
  IF v_current_plan_id = p_to_plan_id THEN
    RETURN jsonb_build_object(
      'success',         true,
      'already_applied', true,
      'plan_id',         p_to_plan_id
    );
  END IF;

  -- ── 4. Aplicar mudança de plano operacional ──────────────────────────────────
  --    Triggers existentes disparam enforcement (limits, leads count, etc.)
  UPDATE public.companies
  SET plan_id = p_to_plan_id
  WHERE id    = p_company_id;

  -- ── 5. Fechar plan_change_request como approved (se fornecido) ───────────────
  --    Atualiza apenas se o PCR ainda está pendente — evita sobrescrever estados finais.
  IF p_plan_change_request_id IS NOT NULL THEN
    UPDATE public.plan_change_requests
    SET
      status          = 'approved',
      reviewed_by     = NULL,
      stripe_event_id = p_stripe_event_id,
      origin          = COALESCE(
        CASE WHEN p_stripe_event_id IS NOT NULL THEN 'stripe_webhook' END,
        origin,
        'system'
      ),
      updated_at      = now()
    WHERE id     = p_plan_change_request_id
      AND status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'success',  true,
    'plan_id',  p_to_plan_id,
    'event_id', p_stripe_event_id
  );

EXCEPTION
  WHEN unique_violation THEN
    -- stripe_event_id duplicado em plan_change_requests → evento já processado
    RETURN jsonb_build_object(
      'success',         true,
      'already_applied', true,
      'reason',          'duplicate_stripe_event_id'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Segurança: apenas service_role (backend) pode chamar esta função.
REVOKE ALL ON FUNCTION public.apply_operational_plan_change(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_operational_plan_change(UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.apply_operational_plan_change IS
  'Aplicação operacional do plano: atualiza companies.plan_id. '
  'FOR UPDATE em companies serializa mudanças concorrentes. '
  'Dispara triggers existentes de enforcement (limits, leads, etc.). '
  'Opcionalmente aprova plan_change_request relacionado. '
  'Idempotente: se plan_id já é o destino, retorna already_applied=true. '
  'NUNCA atualiza company_subscriptions (separação de responsabilidade). '
  'Apenas service_role (backend) pode executar.';


-- ══════════════════════════════════════════════════════════════════════════════
-- LOG
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE LOG 'create_billing_rpcs aplicada:';
  RAISE LOG '  company_subscriptions.last_stripe_event_id adicionado';
  RAISE LOG '  sync_subscription_billing_state criada (service_role only)';
  RAISE LOG '  apply_operational_plan_change criada (service_role only)';
END;
$$;
