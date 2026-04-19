-- ============================================================
-- MIGRAÇÃO: Billing cycle real para company_credits
-- Data: 2026-04-16
--
-- O que esta migration faz:
--   1. Adiciona billing_cycle_anchor em company_credits
--   2. Remove assinatura antiga de renew_company_credits(UUID, INTEGER)
--   3. Cria nova renew_company_credits(UUID) que:
--        - Busca monthly_ai_credits diretamente do banco (sem parâmetro externo)
--        - Usa last_renewed_at + interval '1 month' como critério de ciclo real
--        - Define billing_cycle_anchor na primeira renovação
--
-- O que NÃO muda:
--   - debit_credits_atomic (não tocado)
--   - Regras plan → extra (não tocadas)
--   - Saldo nunca negativo (não tocado)
--   - Ledger imutável (apenas INSERT em credit_transactions)
--   - Estrutura de qualquer outra tabela
-- ============================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. NOVA COLUNA: billing_cycle_anchor
--
-- Data base do ciclo de cobrança desta empresa.
-- Definida automaticamente na primeira renovação via renew_company_credits.
-- Usada como referência histórica e de auditoria — a lógica de idempotência
-- usa last_renewed_at (mais simples e suficiente para v1).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_credits
  ADD COLUMN IF NOT EXISTS billing_cycle_anchor TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.company_credits.billing_cycle_anchor IS
  'Data base do ciclo de cobrança desta empresa. '
  'Definida na primeira renovação (last_renewed_at era NULL). '
  'Usada como referência histórica/auditoria. '
  'Idempotência de ciclo usa last_renewed_at + 1 month.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. REMOVER assinatura antiga renew_company_credits(UUID, INTEGER)
--
-- A assinatura antiga recebia p_plan_credits como parâmetro externo.
-- A nova função busca o valor internamente — sem dependência do caller.
-- DROP necessário pois CREATE OR REPLACE não muda assinatura.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.renew_company_credits(UUID, INTEGER);


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. FUNÇÃO: renew_company_credits(p_company_id UUID)
--
-- MUDANÇAS em relação à versão anterior:
--
--   a) Assinatura: (UUID) em vez de (UUID, INTEGER)
--      A cota mensal é buscada internamente via companies.plan → plans.monthly_ai_credits.
--      O caller (cron) não precisa conhecer nem passar o valor do plano.
--
--   b) Idempotência por billing cycle real:
--      ANTES: date_trunc('month', last_renewed_at) = date_trunc('month', now())
--        → renovava só 1x por mês calendário (ex: mês de março)
--        → empresa que assinou dia 20 era renovada em 01/abr antes do vencimento
--      AGORA: now() < last_renewed_at + interval '1 month'
--        → renovação só ocorre quando 1 mês completo tiver passado desde a última
--        → empresa que renovou em 20/jan só renova novamente em 20/fev ou depois
--
--   c) billing_cycle_anchor:
--      Definido automaticamente na primeira renovação (last_renewed_at IS NULL).
--      Registra o início real do ciclo desta empresa.
--
--   d) Empresa sem plano configurado:
--      Se companies.plan for NULL ou não encontrado em plans,
--      usa monthly_ai_credits = 0 (empresa continua sem créditos de plano).
--      Renovação é registrada normalmente no ledger.
--
-- GARANTIAS MANTIDAS:
--   - extra_credits NÃO é tocado (ausente do UPDATE intencionalmente)
--   - plan_credits é SUBSTITUÍDO (não somado) — saldo anterior descartado
--   - Ledger registrado apenas quando renovação de fato ocorre
--   - SELECT FOR UPDATE garante serialização contra chamadas concorrentes
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.renew_company_credits(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row            public.company_credits%ROWTYPE;
  v_plan_credits   INTEGER;
  v_extra          INTEGER;
  v_bal_after      INTEGER;
  v_next_renewal   TIMESTAMPTZ;
BEGIN

  -- ── 1. Buscar cota mensal do plano da empresa ──────────────────────────────
  --
  -- Junta companies.plan (slug) com plans.monthly_ai_credits.
  -- Se a empresa não tiver plano ou o plano não existir: usa 0.
  -- Isso evita que o cron precise conhecer detalhes de plano de cada empresa.

  SELECT COALESCE(pl.monthly_ai_credits, 0)
  INTO   v_plan_credits
  FROM   public.companies c
  LEFT JOIN public.plans pl ON pl.slug = c.plan AND pl.is_active = true
  WHERE  c.id = p_company_id;

  -- Se a empresa não existir, encerrar
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  -- Garantir >= 0 mesmo que a coluna retorne NULL
  v_plan_credits := GREATEST(COALESCE(v_plan_credits, 0), 0);

  -- ── 2. Buscar e travar registro de créditos da empresa ────────────────────
  --
  -- FOR UPDATE serializa chamadas concorrentes para a mesma empresa.

  SELECT * INTO v_row
  FROM   public.company_credits
  WHERE  company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Primeira vez: criar linha com saldo zero e re-buscar com lock
    INSERT INTO public.company_credits (company_id, plan_credits, extra_credits, plan_credits_total)
    VALUES (p_company_id, 0, 0, 0)
    ON CONFLICT (company_id) DO NOTHING;

    SELECT * INTO v_row
    FROM   public.company_credits
    WHERE  company_id = p_company_id
    FOR UPDATE;
  END IF;

  -- ── 3. Idempotência: verificar se o ciclo atual já foi renovado ───────────
  --
  -- Lógica de billing cycle real:
  --   Se last_renewed_at NÃO é NULL:
  --     next_renewal = last_renewed_at + 1 mês
  --     Se now() < next_renewal → ciclo ainda ativo → NÃO renovar
  --   Se last_renewed_at IS NULL:
  --     Primeira renovação → sempre renovar

  IF v_row.last_renewed_at IS NOT NULL THEN
    v_next_renewal := v_row.last_renewed_at + INTERVAL '1 month';
    IF now() < v_next_renewal THEN
      RETURN jsonb_build_object(
        'ok',             true,
        'renewed',        false,
        'reason',         'already_renewed_this_cycle',
        'next_renewal_at', v_next_renewal
      );
    END IF;
  END IF;

  -- ── 4. Aplicar renovação ──────────────────────────────────────────────────
  --
  -- plan_credits é SUBSTITUÍDO — saldo anterior descartado (regra de negócio).
  -- extra_credits está AUSENTE do SET intencionalmente — nunca alterado.
  -- billing_cycle_anchor: definido apenas na primeira renovação (COALESCE).

  UPDATE public.company_credits
  SET
    plan_credits         = v_plan_credits,
    plan_credits_total   = v_plan_credits,
    last_renewed_at      = now(),
    billing_cycle_anchor = COALESCE(billing_cycle_anchor, now()),
    updated_at           = now()
    -- extra_credits: ausente intencionalmente — preservado intacto
  WHERE company_id = p_company_id;

  -- Ler extra_credits atualizado para calcular balance_after correto
  SELECT extra_credits INTO v_extra
  FROM   public.company_credits
  WHERE  company_id = p_company_id;

  v_bal_after := v_plan_credits + COALESCE(v_extra, 0);

  -- ── 5. Registrar renovação no ledger ──────────────────────────────────────

  INSERT INTO public.credit_transactions (
    company_id,
    type,
    credits,
    balance_after,
    plan_balance_after,
    extra_balance_after,
    feature_type,
    metadata
  ) VALUES (
    p_company_id,
    'plan_renewal',
    v_plan_credits,
    v_bal_after,
    v_plan_credits,
    COALESCE(v_extra, 0),
    NULL,
    jsonb_build_object(
      'plan_credits_total', v_plan_credits,
      'renewed_at',         now(),
      'next_renewal_at',    now() + INTERVAL '1 month',
      'cycle_type',         'billing_cycle_anchor'
    )
  );

  -- ── 6. Retorno de sucesso ─────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'ok',             true,
    'renewed',        true,
    'plan_credits',   v_plan_credits,
    'extra_credits',  COALESCE(v_extra, 0),
    'balance_after',  v_bal_after,
    'next_renewal_at', now() + INTERVAL '1 month'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.renew_company_credits(UUID) IS
  'Renova o ciclo de créditos do plano de uma empresa baseado em billing cycle real. '
  'Busca monthly_ai_credits internamente via companies.plan → plans.monthly_ai_credits. '
  'Idempotência: now() < last_renewed_at + 1 month → skip. '
  'plan_credits é SUBSTITUÍDO — saldo anterior descartado. '
  'extra_credits nunca é tocado. '
  'billing_cycle_anchor definido na primeira renovação. '
  'Seguro para chamadas em lote pelo cron (cada empresa decide por si mesma).';
