-- =============================================================================
-- Migration: consulting_packages_module
-- Timestamp: 20260515100000
--
-- Módulo completo de Pacotes de Consultoria.
--
-- Inclui:
--   1. ALTER credit_packages       — adicionar is_available_for_bonus
--   2. ALTER credit_transactions   — adicionar tipo 'consulting_bonus' ao CHECK
--   3. Tabela consulting_packages  — catálogo de pacotes consultivos
--   4. Tabela consulting_orders    — pedidos com snapshots completos e idempotência Stripe
--   5. Tabela company_consulting_balances — saldo único de horas por empresa (em minutos)
--   6. Tabela consulting_time_entries    — lançamentos operacionais de equipe interna
--   7. RPC confirm_consulting_order_payment — fulfillment atômico e idempotente
--   8. RPC create_consulting_time_entry   — lançamento + débito atômico com guarda de saldo
--   9. RPC delete_consulting_time_entry   — soft delete com restauração do saldo
--  10. Backfill: company_consulting_balances para empresas client existentes
--
-- DESIGN:
--   - Saldo em minutos (armazenado); exibição em horas feita na UI
--   - available_minutes: GENERATED ALWAYS AS STORED (nunca escrita diretamente)
--   - CHECK constraint impede saldo negativo (used > total)
--   - Todas as escritas críticas via RPC SECURITY DEFINER
--   - RLS alinhado com auth_user_is_company_member / auth_user_is_parent_admin
--   - Zero impacto em planos recorrentes e créditos avulsos existentes
-- =============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER credit_packages — adicionar is_available_for_bonus
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS is_available_for_bonus BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.credit_packages.is_available_for_bonus IS
  'Quando true, este pacote pode ser vinculado como bônus de IA em consulting_packages. '
  'Independente de is_available_for_sale — um pacote pode ser apenas bônus, apenas venda, ou ambos.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. ALTER credit_transactions — incluir tipo consulting_bonus no CHECK constraint
--
-- Recriamos o constraint pois PostgreSQL não suporta ALTER CHECK inline.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
    CHECK (type IN ('plan_renewal', 'purchase', 'usage', 'adjustment', 'consulting_bonus'));

COMMENT ON COLUMN public.credit_transactions.type IS
  'Tipo de movimentação: '
  'plan_renewal = renovação mensal do plano; '
  'purchase = compra avulsa via credit_orders; '
  'usage = consumo de IA (debit_credits_atomic); '
  'adjustment = ajuste manual de administrador; '
  'consulting_bonus = créditos de bônus concedidos ao comprar pacote consultivo.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Tabela consulting_packages — catálogo global (gerenciado pela empresa pai)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.consulting_packages (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT           NOT NULL,
  description             TEXT           NULL,

  package_type            TEXT           NOT NULL
    CONSTRAINT consulting_packages_type_check
      CHECK (package_type IN ('implementation', 'training', 'consulting')),

  hours                   NUMERIC(10, 2) NOT NULL CHECK (hours > 0),
  price                   NUMERIC(10, 2) NOT NULL CHECK (price >= 0),

  is_active               BOOLEAN        NOT NULL DEFAULT true,
  is_available_for_sale   BOOLEAN        NOT NULL DEFAULT true,

  -- Bônus de IA opcional. ON DELETE SET NULL preserva o consulting_package
  -- se o credit_package for removido; snapshots em orders ficam intactos.
  bonus_credit_package_id UUID           NULL
    REFERENCES public.credit_packages(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consulting_packages IS
  'Catálogo global de pacotes consultivos (implementação, treinamento, consultoria). '
  'Gerenciado exclusivamente pela empresa pai (platform admin). '
  'bonus_credit_package_id: pacote de IA concedido como bônus ao comprar este pacote consultivo.';

COMMENT ON COLUMN public.consulting_packages.hours IS
  'Horas do pacote em decimal (ex: 2.5 = 2h30min). '
  'Convertido para minutos no fulfillment: ROUND(hours * 60)::INTEGER.';

CREATE INDEX IF NOT EXISTS idx_consulting_packages_active_sale
  ON public.consulting_packages (is_active, is_available_for_sale);

CREATE OR REPLACE FUNCTION public.set_consulting_packages_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_consulting_packages_updated_at ON public.consulting_packages;
CREATE TRIGGER trg_consulting_packages_updated_at
  BEFORE UPDATE ON public.consulting_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_consulting_packages_updated_at();

-- RLS
ALTER TABLE public.consulting_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csp_select_authenticated" ON public.consulting_packages;
CREATE POLICY "csp_select_authenticated"
  ON public.consulting_packages
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "csp_all_platform_admin" ON public.consulting_packages;
CREATE POLICY "csp_all_platform_admin"
  ON public.consulting_packages
  FOR ALL
  TO authenticated
  USING (auth_user_is_platform_admin())
  WITH CHECK (auth_user_is_platform_admin());

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Tabela consulting_orders — pedidos de compra com snapshots imutáveis
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.consulting_orders (
  id                               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                       UUID           NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  consulting_package_id            UUID           NOT NULL REFERENCES public.consulting_packages(id) ON DELETE RESTRICT,

  -- Snapshots imutáveis: imunes a alterações posteriores no catálogo
  hours_snapshot                   NUMERIC(10, 2) NOT NULL,
  price_snapshot                   NUMERIC(10, 2) NOT NULL,
  package_name_snapshot            TEXT           NOT NULL,
  package_type_snapshot            TEXT           NOT NULL,

  -- Snapshots do bônus no momento da compra (NULL = sem bônus)
  bonus_credit_package_id_snapshot UUID           NULL,
  bonus_credits_snapshot           INTEGER        NULL,
  bonus_credit_name_snapshot       TEXT           NULL,

  -- Stripe
  stripe_session_id                TEXT           UNIQUE,
  stripe_payment_intent            TEXT           UNIQUE,

  -- Status do pedido
  status                           TEXT           NOT NULL DEFAULT 'pending_payment'
    CONSTRAINT consulting_orders_status_check
      CHECK (status IN (
        'pending_payment',
        'checkout_created',
        'paid',
        'failed',
        'cancelled',
        'expired'
      )),

  -- Auditoria
  requested_by                     UUID           NOT NULL REFERENCES auth.users(id),
  paid_at                          TIMESTAMPTZ    NULL,
  metadata                         JSONB          NOT NULL DEFAULT '{}',
  created_at                       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consulting_orders IS
  'Pedidos de compra de pacotes consultivos. Contém snapshots completos do pacote e bônus '
  'no momento da compra — imunes a alterações do catálogo. '
  'stripe_payment_intent UNIQUE: defesa final contra webhooks duplicados.';

CREATE INDEX IF NOT EXISTS idx_consulting_orders_company_id
  ON public.consulting_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_consulting_orders_status
  ON public.consulting_orders (status);
CREATE INDEX IF NOT EXISTS idx_consulting_orders_company_pkg
  ON public.consulting_orders (company_id, consulting_package_id, status, created_at);

CREATE OR REPLACE FUNCTION public.set_consulting_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_consulting_orders_updated_at ON public.consulting_orders;
CREATE TRIGGER trg_consulting_orders_updated_at
  BEFORE UPDATE ON public.consulting_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_consulting_orders_updated_at();

-- RLS
ALTER TABLE public.consulting_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cso_select_member_or_parent_admin" ON public.consulting_orders;
CREATE POLICY "cso_select_member_or_parent_admin"
  ON public.consulting_orders
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Tabela company_consulting_balances — saldo único por empresa (em minutos)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_consulting_balances (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  total_credited_minutes  INTEGER     NOT NULL DEFAULT 0,
  used_minutes            INTEGER     NOT NULL DEFAULT 0,

  -- Coluna gerada: nunca escrever diretamente
  available_minutes       INTEGER GENERATED ALWAYS AS (total_credited_minutes - used_minutes) STORED,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT company_consulting_balances_unique_company UNIQUE (company_id),

  CONSTRAINT company_consulting_balances_no_negative
    CHECK (
      total_credited_minutes >= 0
      AND used_minutes >= 0
      AND used_minutes <= total_credited_minutes
    )
);

COMMENT ON TABLE public.company_consulting_balances IS
  'Saldo consultivo único por empresa em minutos. '
  'available_minutes = total_credited_minutes - used_minutes (coluna gerada, nunca escrita). '
  'CHECK constraint impede saldo negativo. '
  'Todas as mutações via RPC SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.set_ccb_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_company_consulting_balances_updated_at ON public.company_consulting_balances;
CREATE TRIGGER trg_company_consulting_balances_updated_at
  BEFORE UPDATE ON public.company_consulting_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_ccb_updated_at();

-- RLS
ALTER TABLE public.company_consulting_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ccb_select_member_or_parent_admin" ON public.company_consulting_balances;
CREATE POLICY "ccb_select_member_or_parent_admin"
  ON public.company_consulting_balances
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Tabela consulting_time_entries — lançamentos operacionais
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.consulting_time_entries (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  entry_date            DATE        NOT NULL,
  start_time            TIME        NOT NULL,
  end_time              TIME        NOT NULL,

  -- Calculado pela RPC — nunca aceito do frontend
  duration_minutes      INTEGER     NOT NULL CHECK (duration_minutes > 0),

  description           TEXT        NOT NULL,

  entry_type            TEXT        NOT NULL
    CONSTRAINT consulting_time_entries_type_check
      CHECK (entry_type IN ('implementation', 'training', 'consulting')),

  performed_by_user_id  UUID        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by            UUID        NOT NULL REFERENCES auth.users(id),

  -- Soft delete
  deleted_at            TIMESTAMPTZ NULL,
  deleted_by            UUID        NULL REFERENCES auth.users(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT consulting_time_entries_time_order
    CHECK (end_time > start_time)
);

COMMENT ON TABLE public.consulting_time_entries IS
  'Lançamentos operacionais de horas consultivas por empresa. '
  'Inseridos apenas pela equipe interna (platform admin). '
  'Cliente possui SELECT para visualizar seus lançamentos. '
  'duration_minutes calculado pela RPC — nunca aceito do frontend. '
  'deleted_at: soft delete com restauração de used_minutes via RPC.';

CREATE INDEX IF NOT EXISTS idx_cte_company_date
  ON public.consulting_time_entries (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_cte_company_active
  ON public.consulting_time_entries (company_id, deleted_at)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_cte_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_consulting_time_entries_updated_at ON public.consulting_time_entries;
CREATE TRIGGER trg_consulting_time_entries_updated_at
  BEFORE UPDATE ON public.consulting_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_cte_updated_at();

-- RLS
ALTER TABLE public.consulting_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cte_select_member_or_parent_admin" ON public.consulting_time_entries;
CREATE POLICY "cte_select_member_or_parent_admin"
  ON public.consulting_time_entries
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS "cte_write_platform_admin" ON public.consulting_time_entries;
CREATE POLICY "cte_write_platform_admin"
  ON public.consulting_time_entries
  FOR ALL
  TO authenticated
  USING (auth_user_is_platform_admin())
  WITH CHECK (auth_user_is_platform_admin());

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. RPC confirm_consulting_order_payment
--    Fulfillment atômico e idempotente para pagamento confirmado.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirm_consulting_order_payment(
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order               public.consulting_orders%ROWTYPE;
  v_minutes_to_credit   INTEGER;
  v_old_credited        INTEGER;
  v_new_credited        INTEGER;
  v_plan_credits        INTEGER;
  v_old_extra           INTEGER;
  v_new_extra           INTEGER;
  v_total_credits_after INTEGER;
BEGIN
  -- a. Buscar e travar a order (FOR UPDATE serializa concorrência por pedido)
  SELECT * INTO v_order
  FROM public.consulting_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- b. Idempotência: já foi paga?
  IF v_order.status = 'paid' OR v_order.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- c. Validar status permitido
  IF v_order.status NOT IN ('pending_payment', 'checkout_created') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'order_not_confirmable',
      'current_status', v_order.status
    );
  END IF;

  -- d. Calcular minutos a creditar (ROUND para evitar frações)
  v_minutes_to_credit := ROUND(v_order.hours_snapshot * 60)::INTEGER;

  -- e. Travar e ler saldo de horas (FOR UPDATE serializa por empresa)
  SELECT total_credited_minutes
  INTO v_old_credited
  FROM public.company_consulting_balances
  WHERE company_id = v_order.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Inicializar saldo se ausente (não deve ocorrer após backfill, mas por segurança)
    INSERT INTO public.company_consulting_balances (company_id, total_credited_minutes, used_minutes)
    VALUES (v_order.company_id, 0, 0)
    ON CONFLICT (company_id) DO NOTHING;

    SELECT total_credited_minutes
    INTO v_old_credited
    FROM public.company_consulting_balances
    WHERE company_id = v_order.company_id
    FOR UPDATE;
  END IF;

  v_new_credited := COALESCE(v_old_credited, 0) + v_minutes_to_credit;

  -- f. Creditar minutos no saldo
  UPDATE public.company_consulting_balances
  SET total_credited_minutes = v_new_credited
  WHERE company_id = v_order.company_id;

  -- g. Processar bônus de IA (se existir no snapshot)
  IF v_order.bonus_credits_snapshot IS NOT NULL AND v_order.bonus_credits_snapshot > 0 THEN

    SELECT
      COALESCE(plan_credits,  0),
      COALESCE(extra_credits, 0)
    INTO v_plan_credits, v_old_extra
    FROM public.company_credits
    WHERE company_id = v_order.company_id
    FOR UPDATE;

    v_new_extra           := v_old_extra + v_order.bonus_credits_snapshot;
    v_total_credits_after := v_plan_credits + v_new_extra;

    UPDATE public.company_credits
    SET extra_credits = v_new_extra
    WHERE company_id = v_order.company_id;

    -- Registrar no ledger com tipo 'consulting_bonus' (rastreabilidade distinta de 'purchase')
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
      'consulting_bonus',
      v_order.bonus_credits_snapshot,
      v_total_credits_after,
      v_plan_credits,
      v_new_extra,
      jsonb_build_object(
        'consulting_order_id',          v_order.id,
        'bonus_credit_package_id',      v_order.bonus_credit_package_id_snapshot,
        'bonus_credit_name',            v_order.bonus_credit_name_snapshot,
        'source',                       'consulting_purchase',
        'hours_snapshot',               v_order.hours_snapshot,
        'package_name',                 v_order.package_name_snapshot
      )
    );
  END IF;

  -- h. Marcar order como paga
  UPDATE public.consulting_orders
  SET
    status  = 'paid',
    paid_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success',          true,
    'minutes_credited', v_minutes_to_credit,
    'bonus_credits',    COALESCE(v_order.bonus_credits_snapshot, 0)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_consulting_order_payment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_consulting_order_payment(UUID) TO service_role;

COMMENT ON FUNCTION public.confirm_consulting_order_payment IS
  'Fulfillment atômico e idempotente de pedido consultivo pago. SECURITY DEFINER. '
  'Credita horas (total_credited_minutes) e bônus de IA (extra_credits + credit_transactions '
  'com type=consulting_bonus) em uma única transação. '
  'FOR UPDATE serializa concorrência. Idempotente: retorna already_paid se já processado.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. RPC create_consulting_time_entry
--    Lança horas e debita saldo atomicamente.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_consulting_time_entry(
  p_company_id           UUID,
  p_entry_date           DATE,
  p_start_time           TIME,
  p_end_time             TIME,
  p_description          TEXT,
  p_entry_type           TEXT,
  p_performed_by_user_id UUID,
  p_created_by           UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration_minutes INTEGER;
  v_available        INTEGER;
  v_entry_id         UUID;
BEGIN
  -- a. Validar tipo
  IF p_entry_type NOT IN ('implementation', 'training', 'consulting') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_entry_type');
  END IF;

  -- b. Validar ordenação dos horários
  IF p_end_time <= p_start_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'end_time_must_be_after_start_time');
  END IF;

  -- c. Calcular duração em minutos (sempre no servidor)
  v_duration_minutes := ROUND(
    EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60
  )::INTEGER;

  IF v_duration_minutes <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'duration_must_be_positive');
  END IF;

  -- d. Travar e ler saldo disponível
  SELECT available_minutes
  INTO v_available
  FROM public.company_consulting_balances
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'balance_not_found');
  END IF;

  -- e. Validar saldo suficiente
  IF v_available < v_duration_minutes THEN
    RETURN jsonb_build_object(
      'success',           false,
      'error',             'insufficient_balance',
      'available_minutes', v_available,
      'required_minutes',  v_duration_minutes
    );
  END IF;

  -- f. Inserir lançamento
  INSERT INTO public.consulting_time_entries (
    company_id,
    entry_date,
    start_time,
    end_time,
    duration_minutes,
    description,
    entry_type,
    performed_by_user_id,
    created_by
  ) VALUES (
    p_company_id,
    p_entry_date,
    p_start_time,
    p_end_time,
    v_duration_minutes,
    p_description,
    p_entry_type,
    p_performed_by_user_id,
    p_created_by
  )
  RETURNING id INTO v_entry_id;

  -- g. Debitar used_minutes
  UPDATE public.company_consulting_balances
  SET used_minutes = used_minutes + v_duration_minutes
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'success',          true,
    'entry_id',         v_entry_id,
    'duration_minutes', v_duration_minutes
  );

EXCEPTION
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance_constraint');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.create_consulting_time_entry(UUID, DATE, TIME, TIME, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_consulting_time_entry(UUID, DATE, TIME, TIME, TEXT, TEXT, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.create_consulting_time_entry IS
  'Insere lançamento de horas e debita used_minutes atomicamente. SECURITY DEFINER. '
  'duration_minutes calculado no servidor — nunca aceito do caller. '
  'Recusa se saldo disponível for insuficiente.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. RPC delete_consulting_time_entry — soft delete + restauração do saldo
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_consulting_time_entry(
  p_entry_id   UUID,
  p_deleted_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.consulting_time_entries%ROWTYPE;
BEGIN
  -- a. Buscar e travar entry ativa
  SELECT * INTO v_entry
  FROM public.consulting_time_entries
  WHERE id = p_entry_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_not_found_or_already_deleted');
  END IF;

  -- b. Soft delete
  UPDATE public.consulting_time_entries
  SET
    deleted_at = now(),
    deleted_by = p_deleted_by
  WHERE id = p_entry_id;

  -- c. Restaurar used_minutes (GREATEST(0,...) como safety — constraint já protege)
  UPDATE public.company_consulting_balances
  SET used_minutes = GREATEST(0, used_minutes - v_entry.duration_minutes)
  WHERE company_id = v_entry.company_id;

  RETURN jsonb_build_object(
    'success',          true,
    'minutes_restored', v_entry.duration_minutes
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_consulting_time_entry(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_consulting_time_entry(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.delete_consulting_time_entry IS
  'Soft delete de lançamento com restauração de used_minutes no saldo. '
  'SECURITY DEFINER. Atômico: soft delete + restore em uma transação.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. Backfill: linha em company_consulting_balances para empresas client existentes
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.company_consulting_balances (company_id, total_credited_minutes, used_minutes)
SELECT id, 0, 0
FROM public.companies
WHERE company_type = 'client'
ON CONFLICT (company_id) DO NOTHING;
