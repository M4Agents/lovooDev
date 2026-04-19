-- =====================================================
-- Sistema de Créditos de IA — Ajustes de Robustez (RPC)
--
-- Dependências:
--   20260424100000_create_ai_credits_system.sql  (Etapa 1)
--   20260424110000_create_ai_credits_rpc.sql      (Etapa 2)
--
-- O que esta migration altera:
--
--   1. credit_transactions — nova coluna execution_log_id (UUID própria)
--      e índice único parcial para enforcement de idempotência no banco.
--
--   2. debit_credits_atomic — duplo check de idempotência (pré-lock + pós-lock),
--      consulta via coluna indexada em vez de JSONB cast, INSERT com a nova
--      coluna e exception handler como última linha de defesa.
--
-- O que NÃO muda:
--   - renew_company_credits (não usa execution_log_id)
--   - regras de negócio (plan → extra, saldo mínimo zero)
--   - UPSERT em ai_usage_daily (já estava correto com incremento relativo)
--   - contratos de retorno JSONB
--   - RLS, triggers e demais tabelas
-- =====================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. SCHEMA: adicionar execution_log_id como coluna própria em credit_transactions
--
-- Motivação: consulta por JSONB cast não é indexável de forma eficiente e
-- não garante unicidade no banco. Coluna própria + índice único parcial
-- resolve ambos os problemas.
--
-- Compatibilidade: ADD COLUMN IF NOT EXISTS com NULL — registros existentes
-- (renovações, compras, ajustes) ficam com NULL, o que é correto porque
-- o campo só se aplica a type = 'usage'. O índice é parcial (WHERE NOT NULL),
-- então não exige preenchimento em registros sem execution_log_id.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS execution_log_id UUID NULL;

COMMENT ON COLUMN public.credit_transactions.execution_log_id IS
  'UUID do ai_agent_execution_logs que originou este débito. '
  'Preenchido apenas para type = usage. NULL para renovações, compras e ajustes. '
  'Usado para garantia de idempotência em debit_credits_atomic. '
  'Sem FK intencional — ledger deve sobreviver à remoção do log.';

-- Índice único parcial: enforcement de idempotência no nível do banco.
-- WHERE NOT NULL garante que o índice não afeta registros sem execution_log_id
-- (renovações, compras, ajustes) e que dois NULL diferentes são permitidos.
-- Essa é a última linha de defesa — os checks na função já devem prevenir
-- inserções duplicadas, mas este índice garante mesmo em caso de bug no caller.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_unique_execution_log
  ON public.credit_transactions (company_id, execution_log_id)
  WHERE execution_log_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FUNÇÃO: debit_credits_atomic (versão atualizada)
--
-- Alterações em relação à versão anterior:
--
--   a) Duplo check de idempotência:
--      - Check 1 (pré-lock): consulta rápida via índice, evita adquirir lock
--        desnecessariamente no caminho feliz de replay.
--      - Check 2 (pós-lock): reconfirma após adquirir FOR UPDATE. Cobre o
--        cenário onde duas chamadas simultâneas passaram no Check 1 (janela
--        entre a leitura e a aquisição do lock).
--
--   b) Idempotência via coluna indexada:
--      Ambos os checks consultam credit_transactions.execution_log_id
--      (coluna UUID com índice único) em vez de fazer cast em JSONB.
--      Resultado: O(log n) vs O(n) + cast de string por linha.
--
--   c) INSERT com execution_log_id como coluna própria:
--      O valor agora é persistido tanto na coluna dedicada quanto no metadata
--      (para auditoria completa e backward compatibility).
--
--   d) Exception handler para unique_violation:
--      Caso os dois checks falhem por algum bug inesperado no caller, o índice
--      único no banco levantará unique_violation. O handler captura e retorna
--      { ok: true, idempotent: true } em vez de propagar o erro.
--
-- O restante da função é idêntico à versão anterior.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.debit_credits_atomic(
  p_company_id       UUID,
  p_credits          INTEGER,
  p_feature_type     TEXT,
  p_total_tokens     INTEGER  DEFAULT 0,
  p_model            TEXT     DEFAULT NULL,
  p_execution_log_id UUID     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row          public.company_credits%ROWTYPE;
  v_total        INTEGER;
  v_plan_debit   INTEGER;
  v_extra_debit  INTEGER;
  v_plan_after   INTEGER;
  v_extra_after  INTEGER;
  v_bal_after    INTEGER;
BEGIN

  -- ── Validações de entrada ─────────────────────────────────────────────────

  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credits');
  END IF;

  IF p_feature_type NOT IN ('whatsapp', 'insights') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_feature_type');
  END IF;

  -- ── CHECK 1: idempotência pré-lock (caminho rápido) ───────────────────────
  --
  -- Consulta o índice único idx_ct_unique_execution_log antes de adquirir
  -- qualquer lock. Se o débito já existe, retorna imediatamente sem tocar
  -- company_credits — evita contenção desnecessária em replays.
  --
  -- Risco residual: duas chamadas simultâneas podem ambas passar aqui se o
  -- registro ainda não existir. Esse caso é tratado pelo CHECK 2 (pós-lock).

  IF p_execution_log_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE company_id      = p_company_id
        AND execution_log_id = p_execution_log_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
  END IF;

  -- ── Adquirir lock exclusivo na linha da empresa ───────────────────────────
  --
  -- FOR UPDATE serializa débitos concorrentes para a mesma empresa.
  -- A segunda chamada fica bloqueada aqui até a primeira comitar ou reverter.

  SELECT * INTO v_row
  FROM public.company_credits
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  -- ── CHECK 2: idempotência pós-lock (segurança contra concorrência) ────────
  --
  -- Reconfirma após adquirir o lock. Cobre o cenário onde duas chamadas
  -- simultâneas passaram ambas no CHECK 1 e ficaram na fila do FOR UPDATE.
  -- Quando a segunda acordar do lock, o registro já terá sido inserido pela
  -- primeira — e este check a intercepta antes de qualquer escrita.

  IF p_execution_log_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE company_id      = p_company_id
        AND execution_log_id = p_execution_log_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
  END IF;

  -- ── Validação de saldo (dentro da transação, após o lock) ─────────────────

  v_total := COALESCE(v_row.plan_credits, 0) + COALESCE(v_row.extra_credits, 0);

  IF v_total < p_credits THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_credits',
      'balance', v_total
    );
  END IF;

  -- ── Prioridade de consumo: plan → extra (DO NOT CHANGE) ───────────────────

  v_plan_debit  := LEAST(p_credits, v_row.plan_credits);
  v_extra_debit := p_credits - v_plan_debit;

  v_plan_after  := v_row.plan_credits  - v_plan_debit;
  v_extra_after := v_row.extra_credits - v_extra_debit;
  v_bal_after   := v_plan_after + v_extra_after;

  -- ── Atualizar saldo ───────────────────────────────────────────────────────

  UPDATE public.company_credits
  SET
    plan_credits  = v_plan_after,
    extra_credits = v_extra_after,
    updated_at    = now()
  WHERE company_id = p_company_id;

  -- ── Registrar no ledger com execution_log_id como coluna própria ──────────
  --
  -- execution_log_id persiste tanto na coluna dedicada (para idempotência e
  -- performance) quanto no metadata (para auditoria completa).
  -- O índice único idx_ct_unique_execution_log é a última linha de defesa —
  -- qualquer insert duplicado levantará unique_violation, capturado abaixo.

  INSERT INTO public.credit_transactions (
    company_id,
    type,
    credits,
    balance_after,
    plan_balance_after,
    extra_balance_after,
    feature_type,
    execution_log_id,
    metadata
  ) VALUES (
    p_company_id,
    'usage',
    -p_credits,
    v_bal_after,
    v_plan_after,
    v_extra_after,
    p_feature_type,
    p_execution_log_id,
    jsonb_build_object(
      'execution_log_id', p_execution_log_id,
      'total_tokens',     COALESCE(p_total_tokens, 0),
      'model',            p_model,
      'plan_debit',       v_plan_debit,
      'extra_debit',      v_extra_debit
    )
  );

  -- ── Atualizar log de execução ─────────────────────────────────────────────

  IF p_execution_log_id IS NOT NULL THEN
    UPDATE public.ai_agent_execution_logs
    SET
      credits_used = p_credits,
      feature_type = p_feature_type
    WHERE id = p_execution_log_id;
  END IF;

  -- ── Agregado diário incremental (UPSERT com incremento relativo) ──────────
  --
  -- Sempre soma ao valor existente — nunca sobrescreve.
  -- ai_usage_daily.col + EXCLUDED.col é o padrão correto para incremento
  -- em UPSERT do PostgreSQL.

  INSERT INTO public.ai_usage_daily (
    company_id,
    date,
    feature_type,
    total_tokens,
    total_credits_used,
    executions_count
  ) VALUES (
    p_company_id,
    CURRENT_DATE,
    p_feature_type,
    COALESCE(p_total_tokens, 0),
    p_credits,
    1
  )
  ON CONFLICT (company_id, date, feature_type) DO UPDATE
    SET
      total_tokens       = ai_usage_daily.total_tokens       + EXCLUDED.total_tokens,
      total_credits_used = ai_usage_daily.total_credits_used + EXCLUDED.total_credits_used,
      executions_count   = ai_usage_daily.executions_count   + 1,
      updated_at         = now();

  RETURN jsonb_build_object(
    'ok',            true,
    'balance_after', v_bal_after,
    'plan_balance',  v_plan_after,
    'extra_balance', v_extra_after
  );

EXCEPTION
  -- ── Última linha de defesa: unique_violation no índice ───────────────────
  --
  -- Captura a exceção de violação única caso ambos os checks de idempotência
  -- tenham falhado (bug inesperado no caller ou condição de corrida extrema).
  -- Retorna idempotent: true em vez de propagar o erro para o backend.
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);

END;
$$;

COMMENT ON FUNCTION public.debit_credits_atomic(UUID, INTEGER, TEXT, INTEGER, TEXT, UUID) IS
  'Debita créditos de IA de forma atômica e segura. '
  'Idempotência via coluna execution_log_id com índice único (não JSONB). '
  'Duplo check: pré-lock (rápido) + pós-lock (seguro contra concorrência). '
  'exception handler captura unique_violation como última linha de defesa. '
  'Prioridade de consumo: plan_credits → extra_credits (DO NOT CHANGE). '
  'UPSERT em ai_usage_daily sempre incrementa — nunca sobrescreve.';
