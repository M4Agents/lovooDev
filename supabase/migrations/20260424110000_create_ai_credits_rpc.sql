-- =====================================================
-- Sistema de Créditos de IA — Etapa 2: Funções RPC
--
-- Funções criadas:
--   1. debit_credits_atomic   — débito atômico pós-execução de IA
--   2. renew_company_credits  — renovação do ciclo mensal de créditos
--
-- Dependências (Etapa 1 obrigatória):
--   - public.company_credits
--   - public.credit_transactions
--   - public.ai_usage_daily
--   - public.ai_agent_execution_logs (colunas credits_used, feature_type)
--
-- Segurança:
--   - Ambas as funções são SECURITY DEFINER — operam como postgres
--   - Nunca chamadas diretamente pelo frontend sem validação de sessão
--   - RLS das tabelas não é aplicado dentro das funções (bypass intencional)
--   - Validação de company_id é responsabilidade do caller (backend/cron)
--
-- Regras de negócio enforçadas aqui:
--   - plan_credits consumido antes de extra_credits (DO NOT CHANGE)
--   - saldo nunca fica negativo (CHECK no schema + GREATEST na lógica)
--   - ledger imutável (apenas INSERT em credit_transactions)
--   - extra_credits nunca alterado em renew_company_credits
-- =====================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. FUNÇÃO: debit_credits_atomic
--
-- Débito transacional seguro de créditos após execução de IA.
--
-- GARANTIAS:
--   a) Atomicidade:    SELECT ... FOR UPDATE serializa débitos concorrentes.
--                      Nenhuma outra transação pode ler/alterar company_credits
--                      da mesma empresa enquanto esta transação estiver aberta.
--
--   b) Idempotência:   Se execution_log_id já tiver sido debitado (registro
--                      em credit_transactions com esse ID no metadata), a função
--                      retorna imediatamente com ok: true sem repetir o débito.
--
--   c) Saldo negativo: Validação do saldo DENTRO da transação (após o FOR UPDATE).
--                      Qualquer check externo seria sujeito a race condition.
--
--   d) Consistência:   Todas as escritas (company_credits, credit_transactions,
--                      ai_usage_daily, ai_agent_execution_logs) ocorrem na mesma
--                      transação — ou tudo comita ou tudo reverte.
--
-- PRIORIDADE DE CONSUMO (DO NOT CHANGE):
--   1. plan_credits  — consumido primeiro, sempre
--   2. extra_credits — consumido apenas quando plan_credits = 0
--
-- PARÂMETROS:
--   p_company_id:       empresa que será debitada
--   p_credits:          créditos a debitar (deve ser > 0)
--   p_feature_type:     'whatsapp' ou 'insights'
--   p_total_tokens:     tokens da execução (para auditoria e agregação)
--   p_model:            modelo OpenAI usado (para auditoria)
--   p_execution_log_id: UUID do ai_agent_execution_logs (para cross-reference
--                       e garantia de idempotência)
--
-- RETORNO (JSONB):
--   Sucesso:   { ok: true, balance_after, plan_balance, extra_balance }
--   Idempotente (já debitado): { ok: true, idempotent: true }
--   Insuficiente: { ok: false, error: 'insufficient_credits', balance }
--   Inválido:  { ok: false, error: 'invalid_credits' | 'invalid_feature_type'
--                             | 'company_not_found' }
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
  v_plan_debit   INTEGER;  -- quanto será debitado de plan_credits
  v_extra_debit  INTEGER;  -- quanto será debitado de extra_credits
  v_plan_after   INTEGER;  -- saldo plan_credits após débito
  v_extra_after  INTEGER;  -- saldo extra_credits após débito
  v_bal_after    INTEGER;  -- saldo total após débito
BEGIN

  -- ── Validações de entrada ─────────────────────────────────────────────────

  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credits');
  END IF;

  IF p_feature_type NOT IN ('whatsapp', 'insights') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_feature_type');
  END IF;

  -- ── Idempotência: verificar se este execution_log_id já foi debitado ──────
  --
  -- Evita débito duplicado caso writeConversationalLog seja chamado mais de
  -- uma vez para a mesma execução. Checagem antes do FOR UPDATE para não
  -- adquirir lock desnecessariamente.

  IF p_execution_log_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE company_id  = p_company_id
        AND type        = 'usage'
        AND (metadata ->> 'execution_log_id')::uuid = p_execution_log_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
  END IF;

  -- ── Adquirir lock exclusivo na linha da empresa ───────────────────────────
  --
  -- FOR UPDATE garante que duas transações concorrentes para a mesma empresa
  -- não executem o débito em paralelo. A segunda ficará bloqueada até a
  -- primeira comitar ou reverter — eliminando race condition de saldo.

  SELECT * INTO v_row
  FROM public.company_credits
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  v_total := COALESCE(v_row.plan_credits, 0) + COALESCE(v_row.extra_credits, 0);

  -- ── Validação de saldo (dentro da transação, após o lock) ─────────────────
  --
  -- Feita aqui — nunca antes da chamada — para garantir que o saldo lido
  -- é o mesmo que será debitado (sem janela de race condition).

  IF v_total < p_credits THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_credits',
      'balance', v_total
    );
  END IF;

  -- ── Aplicar prioridade de consumo: plan → extra (DO NOT CHANGE) ───────────
  --
  -- plan_credits é consumido primeiro até zerar.
  -- extra_credits entra apenas na diferença restante.

  v_plan_debit  := LEAST(p_credits, v_row.plan_credits);
  v_extra_debit := p_credits - v_plan_debit;  -- zero se plan_credits cobriu tudo

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

  -- ── Registrar no ledger (imutável) ────────────────────────────────────────

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
    'usage',
    -p_credits,       -- negativo = saída
    v_bal_after,
    v_plan_after,
    v_extra_after,
    p_feature_type,
    jsonb_build_object(
      'execution_log_id', p_execution_log_id,
      'total_tokens',     COALESCE(p_total_tokens, 0),
      'model',            p_model,
      'plan_debit',       v_plan_debit,
      'extra_debit',      v_extra_debit
    )
  );

  -- ── Atualizar log de execução com créditos debitados ─────────────────────
  --
  -- Só atualiza se o ID foi fornecido. Sem FK intencional (log deve sobreviver
  -- mesmo que o registro seja removido futuramente).

  IF p_execution_log_id IS NOT NULL THEN
    UPDATE public.ai_agent_execution_logs
    SET
      credits_used = p_credits,
      feature_type = p_feature_type
    WHERE id = p_execution_log_id;
  END IF;

  -- ── Agregado diário incremental (UPSERT idempotente por chave natural) ────
  --
  -- Mesma transação garante que ai_usage_daily nunca fica dessincronizado
  -- com credit_transactions.

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

  -- ── Retorno de sucesso ────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'ok',            true,
    'balance_after', v_bal_after,
    'plan_balance',  v_plan_after,
    'extra_balance', v_extra_after
  );

END;
$$;

COMMENT ON FUNCTION public.debit_credits_atomic(UUID, INTEGER, TEXT, INTEGER, TEXT, UUID) IS
  'Debita créditos de IA de forma atômica e segura. '
  'Usa SELECT FOR UPDATE para serializar débitos concorrentes. '
  'Verifica idempotência por execution_log_id antes de debitar. '
  'Prioridade de consumo: plan_credits → extra_credits (DO NOT CHANGE). '
  'Atualiza company_credits, credit_transactions, ai_usage_daily e ai_agent_execution_logs '
  'na mesma transação. Retorna JSONB com ok, balance_after, plan_balance, extra_balance.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FUNÇÃO: renew_company_credits
--
-- Renovação do ciclo mensal de créditos do plano.
--
-- GARANTIAS:
--   a) Idempotência de ciclo:  Verifica se já houve renovação no ciclo atual
--                              (mesmo mês/ano). Se sim, retorna sem duplicar.
--                              Usa last_renewed_at para detectar.
--
--   b) Preservação de extras:  extra_credits NÃO é tocado em nenhuma hipótese.
--                              O campo está intencionalmente ausente do UPDATE.
--
--   c) Substituição de saldo:  plan_credits é SUBSTITUÍDO (não somado) pelo
--                              novo valor de monthly_ai_credits — saldo anterior
--                              do ciclo é descartado conforme regra de negócio.
--
--   d) Ledger:                 Registra renovação em credit_transactions
--                              somente se de fato houve substituição.
--
-- PARÂMETROS:
--   p_company_id:    empresa a renovar
--   p_plan_credits:  cota mensal (vem de plans.monthly_ai_credits)
--
-- RETORNO (JSONB):
--   Renovado:    { ok: true, renewed: true, plan_credits, extra_credits }
--   Idempotente: { ok: true, renewed: false, reason: 'already_renewed_this_month' }
--   Inválido:    { ok: false, error: 'invalid_plan_credits' | 'company_not_found' }
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.renew_company_credits(
  p_company_id   UUID,
  p_plan_credits INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row         public.company_credits%ROWTYPE;
  v_extra       INTEGER;
  v_bal_after   INTEGER;
  v_this_month  DATE;
BEGIN

  -- ── Validação de entrada ──────────────────────────────────────────────────

  IF p_plan_credits IS NULL OR p_plan_credits < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_credits');
  END IF;

  -- Primeiro dia do mês atual — usado como marcador de ciclo
  v_this_month := date_trunc('month', CURRENT_DATE)::DATE;

  -- ── Buscar e travar registro da empresa ───────────────────────────────────

  SELECT * INTO v_row
  FROM public.company_credits
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Empresa sem registro: criar com saldo zero e continuar para renovação
    INSERT INTO public.company_credits (company_id, plan_credits, extra_credits, plan_credits_total)
    VALUES (p_company_id, 0, 0, 0)
    ON CONFLICT (company_id) DO NOTHING;

    SELECT * INTO v_row
    FROM public.company_credits
    WHERE company_id = p_company_id
    FOR UPDATE;
  END IF;

  -- ── Idempotência: verificar se já renovado neste ciclo ───────────────────
  --
  -- Se last_renewed_at é do mesmo mês/ano, não renovar novamente.
  -- Isso protege contra chamadas duplas da cron ou retries.

  IF v_row.last_renewed_at IS NOT NULL
     AND date_trunc('month', v_row.last_renewed_at)::DATE = v_this_month
  THEN
    RETURN jsonb_build_object(
      'ok',      true,
      'renewed', false,
      'reason',  'already_renewed_this_month'
    );
  END IF;

  -- ── Aplicar renovação ─────────────────────────────────────────────────────
  --
  -- plan_credits é SUBSTITUÍDO — saldo anterior descartado (regra de negócio).
  -- extra_credits está AUSENTE do SET intencionalmente — nunca alterado.
  -- plan_credits_total reflete a nova cota do ciclo.

  UPDATE public.company_credits
  SET
    plan_credits       = p_plan_credits,   -- substituição total, não acúmulo
    plan_credits_total = p_plan_credits,
    last_renewed_at    = now(),
    updated_at         = now()
    -- extra_credits: ausente intencionalmente — preservado intacto
  WHERE company_id = p_company_id;

  -- Ler extra_credits após update para calcular balance_after correto
  SELECT extra_credits INTO v_extra
  FROM public.company_credits
  WHERE company_id = p_company_id;

  v_bal_after := p_plan_credits + COALESCE(v_extra, 0);

  -- ── Registrar renovação no ledger ─────────────────────────────────────────

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
    p_plan_credits,   -- positivo = entrada
    v_bal_after,
    p_plan_credits,
    COALESCE(v_extra, 0),
    NULL,             -- renovação não tem feature_type
    jsonb_build_object(
      'plan_credits_total', p_plan_credits,
      'renewed_at',         now(),
      'cycle_month',        to_char(v_this_month, 'YYYY-MM')
    )
  );

  -- ── Retorno de sucesso ────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'ok',           true,
    'renewed',      true,
    'plan_credits', p_plan_credits,
    'extra_credits', COALESCE(v_extra, 0),
    'balance_after', v_bal_after
  );

END;
$$;

COMMENT ON FUNCTION public.renew_company_credits(UUID, INTEGER) IS
  'Renova o ciclo mensal de créditos do plano de uma empresa. '
  'plan_credits é SUBSTITUÍDO (não somado) — saldo anterior descartado. '
  'extra_credits nunca é tocado — ausente do UPDATE intencionalmente. '
  'Idempotente por ciclo: segunda chamada no mesmo mês retorna renewed: false. '
  'Registra plan_renewal em credit_transactions.';
