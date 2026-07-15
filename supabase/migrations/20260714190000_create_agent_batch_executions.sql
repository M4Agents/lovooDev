-- =====================================================
-- MIGRATION: Idempotência de Execução por Lote
-- Timestamp: 20260714190000
-- Etapa 8 — Desenho e implementação da idempotência de execução por batch_id
--
-- OBJETIVO:
--   Garantir que um mesmo batch_id não inicie duas execuções independentes
--   do agente de IA na mesma empresa.
--
-- DECISÃO ARQUITETURAL:
--   A tabela ai_agent_execution_logs é imutável e serve exclusivamente para
--   observabilidade (status de LLM, tokens, custo). Ela NÃO é adequada para
--   controle de ciclo de vida: não possui claim_token, attempts, next_attempt_at,
--   nem status de lifecycle (processing, retry_pending, etc.).
--   → Criamos a tabela agent_batch_executions com responsabilidade única:
--     controlar atomicamente a idempotência e o ciclo de vida das execuções
--     agrupadas. Os logs de observabilidade seguem separados.
--
-- GARANTIA DE IDEMPOTÊNCIA:
--   UNIQUE INDEX em (company_id, batch_id) WHERE batch_id IS NOT NULL.
--   A operação de claim usa INSERT + tratamento de unique_violation + FOR UPDATE,
--   evitando race condition entre workers concorrentes.
--
-- CONTROLE DE POSSE:
--   claim_token UUID: renovado em cada claim (inicial ou retry).
--   Toda conclusão exige company_id + batch_id + claim_token correto.
--   Impede que um worker atrasado finalize uma execução reivindicada novamente.
--
-- STATE MACHINE:
--   (novo)        → processing        [claim_v1: INSERT]
--   retry_pending → processing        [claim_v1: UPDATE quando ready]
--   processing    → completed         [mark_completed_v1]
--   processing    → retry_pending     [mark_retry_v1, attempts < 3]
--   processing    → failed            [mark_retry_v1 quando attempts >= 3, ou mark_failed_v1]
--   processing    → cancelled         [mark_cancelled_v1]
--
-- BACKOFF (mark_retry_v1):
--   attempts = 1 → next_attempt_at = now() + 60s
--   attempts = 2 → next_attempt_at = now() + 300s
--   attempts >= 3 → falha direta (execution_status = 'failed')
--
-- COMPATIBILIDADE:
--   Execuções atuais (sem batch_id) não são afetadas.
--   Índice único é parcial (WHERE batch_id IS NOT NULL).
--   ai_agent_execution_logs permanece imutável e inalterado.
--
-- ROLLBACK:
--   DROP FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID);
--   DROP FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID);
--   DROP FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT);
--   DROP TABLE public.agent_batch_executions;
-- =====================================================


-- ── 1. Tabela agent_batch_executions ─────────────────────────────────────────

CREATE TABLE public.agent_batch_executions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant obrigatório. Sem FK: resiliência a offboarding de empresa.
  company_id       UUID        NOT NULL,

  -- Lote que disparou esta execução.
  -- ON DELETE SET NULL: preserva auditoria se o lote for removido.
  -- NULL reservado para execuções sem agrupamento (uso futuro).
  batch_id         UUID        NULL
    REFERENCES public.agent_message_batches(id) ON DELETE SET NULL,

  -- Ciclo de vida da execução agrupada.
  -- pending       : reservado para uso futuro (V1 não cria neste estado).
  -- processing    : execução em andamento; claim_token ativo.
  -- completed     : LLM executou e resposta enviada com sucesso.
  -- retry_pending : falha temporária; nova tentativa agendada em next_attempt_at.
  -- failed        : falha permanente (max attempts ou mark_failed explícito).
  -- cancelled     : cancelada externamente.
  execution_status TEXT        NOT NULL DEFAULT 'processing'
    CHECK (execution_status IN (
      'pending', 'processing', 'completed', 'retry_pending', 'failed', 'cancelled'
    )),

  -- Token de posse UUID renovado em cada claim (inicial ou retry).
  -- Toda operação de conclusão deve verificar claim_token para evitar
  -- que um worker atrasado finalize uma execução já reivindicada novamente.
  -- NULL em estados terminais (completed, failed, cancelled).
  claim_token      UUID        NULL,

  -- Número de tentativas. Começa em 1 no INSERT; incrementado pelo claim de retry.
  attempts         INTEGER     NOT NULL DEFAULT 1
    CHECK (attempts >= 1),

  -- Somente preenchido quando execution_status = 'retry_pending'.
  -- Indica quando o próximo claim pode ocorrer.
  next_attempt_at  TIMESTAMPTZ NULL,

  -- Último código de erro (max 100 chars, enforçado por CHECK).
  -- Não armazena prompt integral, credenciais ou payload do provedor.
  last_error_code  TEXT        NULL
    CHECK (last_error_code IS NULL OR length(last_error_code) <= 100),

  -- Última mensagem de erro (max 2000 chars, enforçado por CHECK).
  last_error       TEXT        NULL
    CHECK (last_error IS NULL OR length(last_error) <= 2000),

  -- Preenchido quando execution_status = 'completed'.
  completed_at     TIMESTAMPTZ NULL,

  -- Referência opcional ao log de observabilidade (ai_agent_execution_logs.id).
  -- Sem FK intencional: logs de IA são imutáveis e podem ser purgados
  -- independentemente do ciclo de vida das execuções.
  execution_log_id UUID        NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_batch_executions IS
  'Controla a idempotência de execuções do agente de IA disparadas por lotes. '
  'Garante que um mesmo batch_id não inicie duas execuções independentes por empresa. '
  'Operado exclusivamente via service_role no backend. '
  'Não é uma tabela de observabilidade — use ai_agent_execution_logs para auditoria de LLM.';

COMMENT ON COLUMN public.agent_batch_executions.claim_token IS
  'Token de posse UUID gerado em cada claim (inicial ou retry). '
  'Toda conclusão deve verificar claim_token para evitar race condition entre '
  'um worker atrasado e uma nova execução do mesmo lote. '
  'Mais robusto que locked_at (timestamp) pois é aleatório e não depende de precisão de relógio.';

COMMENT ON COLUMN public.agent_batch_executions.execution_log_id IS
  'UUID do registro em ai_agent_execution_logs criado após a execução do LLM. '
  'NULL enquanto a execução não atingiu a fase de AgentExecutor. '
  'Sem FK: ai_agent_execution_logs pode ser purgado de forma independente.';


-- ── 2. Trigger de updated_at ──────────────────────────────────────────────────
-- Reutiliza public.set_updated_at() já existente no banco (desde migration 20260516100000).

CREATE TRIGGER trg_agent_batch_executions_updated_at
  BEFORE UPDATE ON public.agent_batch_executions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 3. Índices ────────────────────────────────────────────────────────────────

-- IDEMPOTÊNCIA CENTRAL: somente uma execução por (empresa, lote).
-- Partial WHERE batch_id IS NOT NULL: execuções sem batch_id não colidem entre si.
-- Este índice é a garantia primária contra execuções duplicadas.
CREATE UNIQUE INDEX uix_agent_batch_executions_batch
  ON public.agent_batch_executions (company_id, batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON INDEX uix_agent_batch_executions_batch IS
  'Garante atomicamente que somente uma execução existe por (company_id, batch_id). '
  'Partial WHERE batch_id IS NOT NULL: execuções sem agrupamento não colidem.';

-- Recovery: localizar execuções retry_pending prontas para nova tentativa.
CREATE INDEX idx_agent_batch_executions_retry
  ON public.agent_batch_executions (company_id, next_attempt_at ASC)
  WHERE execution_status = 'retry_pending' AND next_attempt_at IS NOT NULL;

-- Monitoramento: consultas por empresa e status.
CREATE INDEX idx_agent_batch_executions_company_status
  ON public.agent_batch_executions (company_id, execution_status, created_at DESC);


-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- INSERT/UPDATE: exclusivamente via service_role no backend (bypassa RLS).
-- authenticated/anon: sem acesso — nenhuma SELECT policy definida → bloqueado por RLS.

ALTER TABLE public.agent_batch_executions ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs de ciclo de vida da execução agrupada
-- ═══════════════════════════════════════════════════════════════════════════


-- ── agent_batch_execution_claim_v1 ───────────────────────────────────────────
--
-- Reivindica atomicamente uma execução para o batch_id informado.
--
-- Comportamento:
--   Primeira chamada:
--     → INSERT com execution_status='processing', claim_token=gen_random_uuid()
--     → acquired=true, reason='claimed'
--
--   Execução retry_pending com next_attempt_at <= now():
--     → UPDATE para processing com novo claim_token, attempts++
--     → acquired=true, reason='retry_claimed'
--
--   Execução processing:
--     → acquired=false, reason='already_processing'
--
--   Execução completed:
--     → acquired=false, reason='already_completed'
--
--   Execução failed ou cancelled:
--     → acquired=false, reason='already_failed' | 'already_cancelled'
--
--   Retry não pronto (next_attempt_at > now()):
--     → acquired=false, reason='retry_not_ready'
--
-- Concorrência:
--   Dois claims simultâneos para o mesmo batch_id:
--   Um recebe unique_violation no INSERT → lê com FOR UPDATE → vê 'processing'
--   → retorna acquired=false, reason='already_processing'.
--   Apenas um worker recebe acquired=true.

CREATE OR REPLACE FUNCTION public.agent_batch_execution_claim_v1(
  p_company_id UUID,
  p_batch_id   UUID
)
RETURNS TABLE (
  acquired         BOOLEAN,
  execution_id     UUID,
  batch_id         UUID,
  execution_status TEXT,
  claim_token      UUID,
  attempts         INTEGER,
  reason           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing  RECORD;
  v_new_token UUID;
  v_new_id    UUID;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validar que o lote existe e pertence à empresa
  PERFORM 1
  FROM public.agent_message_batches amb
  WHERE amb.id = p_batch_id AND amb.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
      USING ERRCODE = 'P0001';
  END IF;

  -- Tentativa de INSERT como primeiro claim.
  -- Conflito no índice único → execução já existe; tratado em EXCEPTION.
  v_new_token := gen_random_uuid();

  BEGIN
    INSERT INTO public.agent_batch_executions (
      company_id, batch_id, execution_status, claim_token, attempts
    ) VALUES (
      p_company_id, p_batch_id, 'processing', v_new_token, 1
    )
    RETURNING id INTO v_new_id;

    -- Primeiro claim bem-sucedido
    RETURN QUERY
      SELECT true, v_new_id, p_batch_id, 'processing'::TEXT,
             v_new_token, 1, 'claimed'::TEXT;
    RETURN;

  EXCEPTION WHEN unique_violation THEN
    -- Registro já existe: ler com FOR UPDATE para serializar decisão.
    -- Alias obrigatório: evita ambiguidade entre coluna de retorno 'batch_id'
    -- e coluna da tabela 'batch_id' no contexto de RETURNS TABLE.
    SELECT abe.*
    INTO   v_existing
    FROM   public.agent_batch_executions abe
    WHERE  abe.company_id = p_company_id
      AND  abe.batch_id   = p_batch_id
    FOR UPDATE;

    -- Removido entre o conflito e o SELECT (cenário extremamente improvável)
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONCURRENT_DELETE: execucao removida durante o claim'
        USING ERRCODE = 'P0001';
    END IF;
  END;

  -- Avaliar o estado do registro existente
  IF v_existing.execution_status = 'processing' THEN
    RETURN QUERY
      SELECT false, v_existing.id, p_batch_id, 'processing'::TEXT,
             NULL::UUID, v_existing.attempts, 'already_processing'::TEXT;

  ELSIF v_existing.execution_status = 'completed' THEN
    RETURN QUERY
      SELECT false, v_existing.id, p_batch_id, 'completed'::TEXT,
             NULL::UUID, v_existing.attempts, 'already_completed'::TEXT;

  ELSIF v_existing.execution_status = 'failed' THEN
    RETURN QUERY
      SELECT false, v_existing.id, p_batch_id, 'failed'::TEXT,
             NULL::UUID, v_existing.attempts, 'already_failed'::TEXT;

  ELSIF v_existing.execution_status = 'cancelled' THEN
    RETURN QUERY
      SELECT false, v_existing.id, p_batch_id, 'cancelled'::TEXT,
             NULL::UUID, v_existing.attempts, 'already_cancelled'::TEXT;

  ELSIF v_existing.execution_status = 'retry_pending' THEN
    IF v_existing.next_attempt_at IS NOT NULL
       AND v_existing.next_attempt_at > now() THEN
      -- Retry não está pronto ainda
      RETURN QUERY
        SELECT false, v_existing.id, p_batch_id, 'retry_pending'::TEXT,
               NULL::UUID, v_existing.attempts, 'retry_not_ready'::TEXT;
    ELSE
      -- Retry pronto: renovar claim_token e incrementar attempts
      v_new_token := gen_random_uuid();

      UPDATE public.agent_batch_executions
      SET
        execution_status = 'processing',
        claim_token      = v_new_token,
        attempts         = v_existing.attempts + 1,
        next_attempt_at  = NULL,
        last_error_code  = NULL,
        last_error       = NULL,
        updated_at       = now()
      WHERE id = v_existing.id;

      RETURN QUERY
        SELECT true, v_existing.id, p_batch_id, 'processing'::TEXT,
               v_new_token, v_existing.attempts + 1, 'retry_claimed'::TEXT;
    END IF;

  ELSIF v_existing.execution_status = 'pending' THEN
    -- Estado pending reservado para uso futuro (claimável)
    v_new_token := gen_random_uuid();

    UPDATE public.agent_batch_executions
    SET
      execution_status = 'processing',
      claim_token      = v_new_token,
      attempts         = v_existing.attempts + 1,
      updated_at       = now()
    WHERE id = v_existing.id;

    RETURN QUERY
      SELECT true, v_existing.id, p_batch_id, 'processing'::TEXT,
             v_new_token, v_existing.attempts + 1, 'claimed_from_pending'::TEXT;

  ELSE
    RAISE EXCEPTION 'INVALID_STATE: execution_status desconhecido: %',
      v_existing.execution_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) TO service_role;


-- ── agent_batch_execution_mark_completed_v1 ──────────────────────────────────
--
-- Marca a execução como concluída com sucesso.
-- Limpa claim_token, last_error_code, last_error.
-- Preenche completed_at.
-- Exige claim_token correto para evitar conclusão por worker atrasado.

CREATE OR REPLACE FUNCTION public.agent_batch_execution_mark_completed_v1(
  p_company_id  UUID,
  p_batch_id    UUID,
  p_claim_token UUID
)
RETURNS SETOF public.agent_batch_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- Bloquear e ler registro para validação segura
  SELECT * INTO v_row
  FROM   public.agent_batch_executions
  WHERE  company_id = p_company_id
    AND  batch_id   = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND: execucao nao encontrada para este lote e empresa'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.execution_status != 'processing'
     OR v_row.claim_token   != p_claim_token THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto. '
      'A execucao pode ja ter sido concluida ou reivindicada novamente.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    UPDATE public.agent_batch_executions
    SET
      execution_status = 'completed',
      completed_at     = now(),
      claim_token      = NULL,
      next_attempt_at  = NULL,
      last_error_code  = NULL,
      last_error       = NULL,
      updated_at       = now()
    WHERE id = v_row.id
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID) TO service_role;


-- ── agent_batch_execution_mark_retry_v1 ──────────────────────────────────────
--
-- Registra falha e decide entre retry ou falha permanente.
--
-- Política de backoff (baseada em attempts atual):
--   attempts = 1 → retry_pending, next_attempt_at = now() + 60s
--   attempts = 2 → retry_pending, next_attempt_at = now() + 300s
--   attempts >= 3 → failed diretamente (sem retry)
--
-- Nota: attempts é incrementado pelo claim de retry, não por esta função.
-- Quando esta função é chamada, attempts já reflete a tentativa que acabou de falhar.
--
-- Limites de texto:
--   p_error_code:    truncado a 100 chars
--   p_error_message: truncado a 2000 chars

CREATE OR REPLACE FUNCTION public.agent_batch_execution_mark_retry_v1(
  p_company_id    UUID,
  p_batch_id      UUID,
  p_claim_token   UUID,
  p_error_code    TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_batch_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     RECORD;
  v_backoff INTERVAL;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- Bloquear e ler o registro para validação e decisão de backoff
  SELECT * INTO v_row
  FROM   public.agent_batch_executions
  WHERE  company_id = p_company_id
    AND  batch_id   = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND: execucao nao encontrada para este lote e empresa'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.execution_status != 'processing'
     OR v_row.claim_token   != p_claim_token THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto. '
      'A execucao pode ja ter sido concluida ou reivindicada novamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.attempts >= 3 THEN
    -- Máximo de tentativas atingido: transicionar diretamente para failed
    RETURN QUERY
      UPDATE public.agent_batch_executions
      SET
        execution_status = 'failed',
        claim_token      = NULL,
        next_attempt_at  = NULL,
        last_error_code  = left(coalesce(p_error_code, 'MAX_ATTEMPTS_REACHED'), 100),
        last_error       = left(p_error_message, 2000),
        updated_at       = now()
      WHERE id = v_row.id
      RETURNING *;
  ELSE
    -- Determinar backoff com base no número atual de tentativas
    v_backoff := CASE v_row.attempts
      WHEN 1 THEN INTERVAL '60 seconds'
      WHEN 2 THEN INTERVAL '300 seconds'
      ELSE        INTERVAL '300 seconds'
    END;

    RETURN QUERY
      UPDATE public.agent_batch_executions
      SET
        execution_status = 'retry_pending',
        claim_token      = NULL,
        next_attempt_at  = now() + v_backoff,
        last_error_code  = left(p_error_code, 100),
        last_error       = left(p_error_message, 2000),
        updated_at       = now()
      WHERE id = v_row.id
      RETURNING *;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT) TO service_role;


-- ── agent_batch_execution_mark_failed_v1 ─────────────────────────────────────
--
-- Encerra uma execução como permanentemente falha.
-- Deve ser chamada quando não se deseja usar a política de retry automático
-- de mark_retry_v1 (ex: erro de configuração, erro de LLM não recuperável).
-- Preserva attempts.

CREATE OR REPLACE FUNCTION public.agent_batch_execution_mark_failed_v1(
  p_company_id    UUID,
  p_batch_id      UUID,
  p_claim_token   UUID,
  p_error_code    TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_batch_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM   public.agent_batch_executions
  WHERE  company_id = p_company_id
    AND  batch_id   = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND: execucao nao encontrada para este lote e empresa'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.execution_status != 'processing'
     OR v_row.claim_token   != p_claim_token THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto. '
      'A execucao pode ja ter sido concluida ou reivindicada novamente.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    UPDATE public.agent_batch_executions
    SET
      execution_status = 'failed',
      claim_token      = NULL,
      next_attempt_at  = NULL,
      last_error_code  = left(p_error_code, 100),
      last_error       = left(p_error_message, 2000),
      updated_at       = now()
    WHERE id = v_row.id
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT) TO service_role;


-- ── agent_batch_execution_mark_cancelled_v1 ──────────────────────────────────
--
-- Cancela uma execução em andamento.
-- Motivo de cancelamento não é logado no backend (conteúdo potencialmente sensível).
-- Preserva attempts.

CREATE OR REPLACE FUNCTION public.agent_batch_execution_mark_cancelled_v1(
  p_company_id  UUID,
  p_batch_id    UUID,
  p_claim_token UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_batch_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM   public.agent_batch_executions
  WHERE  company_id = p_company_id
    AND  batch_id   = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND: execucao nao encontrada para este lote e empresa'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.execution_status != 'processing'
     OR v_row.claim_token   != p_claim_token THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto. '
      'A execucao pode ja ter sido concluida ou reivindicada novamente.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    UPDATE public.agent_batch_executions
    SET
      execution_status = 'cancelled',
      claim_token      = NULL,
      next_attempt_at  = NULL,
      -- p_reason truncado a 1000 chars (limite seguro, sem expor conteúdo longo)
      last_error_code  = left(p_reason, 100),
      last_error       = left(p_reason, 2000),
      updated_at       = now()
    WHERE id = v_row.id
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT) TO service_role;
