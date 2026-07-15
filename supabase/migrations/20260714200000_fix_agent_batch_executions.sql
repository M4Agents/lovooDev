-- =====================================================
-- MIGRATION: Corrigir agent_batch_executions
-- Timestamp: 20260714200000
-- Etapa 8 — Migration corretiva (pré-integração)
--
-- CONTEXTO:
--   A migration original (20260714190000) foi aplicada com 0 registros
--   e 0 call sites. Esta migration corretiva é segura e deve ser aplicada
--   antes de qualquer integração com service layer, cron ou pipeline.
--
-- CORREÇÕES APLICADAS:
--   1. batch_id NOT NULL (tabela é exclusiva para execuções agrupadas)
--   2. FK batch_id → agent_message_batches(id) ON DELETE RESTRICT
--   3. FK company_id → companies(id) ON DELETE CASCADE
--   4. FK execution_log_id → ai_agent_execution_logs(id) ON DELETE SET NULL
--   5. UNIQUE(company_id, batch_id) completa (substitui índice parcial)
--   6. Remove estado 'pending' do CHECK — nunca usado nesta V1
--   7. Recrear claim_v1 sem lógica de estado 'pending'
--
-- DECISÃO: FK COMPOSTA (company_id, batch_id) → agent_message_batches(company_id, id)
--   INVIÁVEL nesta etapa:
--     agent_message_batches possui apenas PK (id). Não há UNIQUE(company_id, id).
--     Criar esse índice exigiria alterar uma tabela que terá dados reais em produção.
--   COMPENSAÇÃO:
--     - FK simples batch_id → agent_message_batches(id): garante que o lote existe.
--     - FK simples company_id → companies(id): garante que a empresa existe.
--     - Toda RPC valida PERFORM FROM agent_message_batches WHERE id = batch_id AND company_id = p_company_id,
--       garantindo o vínculo cruzado em tempo de execução.
--     - As duas FKs independentes NÃO garantem sozinhas que batch_id pertence a company_id
--       — a validação cruzada nas RPCs é obrigatória.
--
-- DECISÃO: ON DELETE para batch_id → RESTRICT
--   Um lote com execução associada não pode ser excluído diretamente.
--   Isso preserva rastreabilidade e evita execuções órfãs.
--   Para limpar: encerrar a execução (mark_failed ou mark_cancelled) antes de deletar o lote.
--
-- DECISÃO: ON DELETE para company_id → CASCADE
--   Padrão do projeto (agent_message_batches.company_id usa CASCADE).
--   Exclusão completa de empresa remove todos os seus dados operacionais.
--
-- DECISÃO: estado 'pending' removido
--   Nenhuma path de código cria registros em 'pending'. O claim_v1 cria
--   diretamente em 'processing'. Manter 'pending' no CHECK sem semântica
--   definida introduziria ambiguidade desnecessária.
--
-- IDENTIFICADOR ESTÁVEL DE EXECUÇÃO (a ser integrado futuramente):
--   agent_batch_executions.id é o execution_id estável.
--   Na futura integração:
--     1. claim_v1 retorna execution_id = agent_batch_executions.id
--     2. Pipeline usa esse ID como run_id do Orchestrator (em vez de randomUUID())
--     3. chat_messages.ai_run_id recebe agent_batch_executions.id
--     4. Retry do mesmo batch reutiliza o mesmo execution_id
--     5. Antes de chamar LLM, pipeline consulta execution_status via execution_id
--     6. Idempotência outbound: verificar mensagens existentes por ai_run_id
--        antes de gerar nova resposta LLM
--   IMPORTANTE: cron não deve ser ativado sem que o recovery de execuções
--   com claim antigo esteja implementado.
--
-- RECOVERY (pendente — pré-requisito para ativação do cron):
--   Execuções com execution_status = 'processing' e updated_at desatualizado
--   devem ser recuperadas para retry_pending ou failed antes do próximo ciclo.
--   Deve usar: claim_token, updated_at como referência temporal, limite de tentativas,
--   operação atômica. Não implementado nesta etapa.
--
-- ROLLBACK:
--   DROP FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID);
--   DROP FUNCTION public.agent_batch_execution_mark_completed_v1(UUID, UUID, UUID);
--   DROP FUNCTION public.agent_batch_execution_mark_retry_v1(UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION public.agent_batch_execution_mark_failed_v1(UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION public.agent_batch_execution_mark_cancelled_v1(UUID, UUID, UUID, TEXT);
--   -- Reverter esta migration:
--   ALTER TABLE public.agent_batch_executions DROP CONSTRAINT IF EXISTS uq_agent_batch_executions_batch;
--   ALTER TABLE public.agent_batch_executions DROP CONSTRAINT IF EXISTS agent_batch_executions_company_id_fkey;
--   ALTER TABLE public.agent_batch_executions DROP CONSTRAINT IF EXISTS agent_batch_executions_execution_log_id_fkey;
--   ALTER TABLE public.agent_batch_executions DROP CONSTRAINT IF EXISTS agent_batch_executions_status_check;
--   ALTER TABLE public.agent_batch_executions ADD CONSTRAINT agent_batch_executions_batch_id_fkey
--     FOREIGN KEY (batch_id) REFERENCES public.agent_message_batches(id) ON DELETE SET NULL;
--   ALTER TABLE public.agent_batch_executions ALTER COLUMN batch_id DROP NOT NULL;
--   -- Recriar estado 'pending' e índice parcial conforme migration original.
--   -- Nota: não assumir que tornar batch_id nullable será seguro após integração.
-- =====================================================


-- ── Guarda contra execução acidental com dados reais ─────────────────────────
-- Abortar se a tabela já tiver registros (indica integração ativa).
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.agent_batch_executions) > 0 THEN
    RAISE EXCEPTION
      'ABORTED: agent_batch_executions nao esta vazia (% registros). '
      'Esta migration so deve ser aplicada com zero registros.',
      (SELECT COUNT(*) FROM public.agent_batch_executions)
    USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'Verificacao inicial: 0 registros confirmados.';
END;
$$;


-- ── 1. Índice parcial → substituído por UNIQUE constraint completa ─────────────
DROP INDEX IF EXISTS public.uix_agent_batch_executions_batch;


-- ── 2. batch_id: NULL → NOT NULL ──────────────────────────────────────────────
-- Seguro com 0 registros. Nenhuma linha existente precisa ser atualizada.
ALTER TABLE public.agent_batch_executions
  ALTER COLUMN batch_id SET NOT NULL;


-- ── 3. FK de batch_id: ON DELETE SET NULL → ON DELETE RESTRICT ───────────────
-- RESTRICT impede exclusão de lote com execução associada.
-- Garante rastreabilidade e evita execução órfã.
ALTER TABLE public.agent_batch_executions
  DROP CONSTRAINT IF EXISTS agent_batch_executions_batch_id_fkey;

ALTER TABLE public.agent_batch_executions
  ADD CONSTRAINT agent_batch_executions_batch_id_fkey
  FOREIGN KEY (batch_id)
  REFERENCES public.agent_message_batches(id)
  ON DELETE RESTRICT;


-- ── 4. FK de company_id: nova ─────────────────────────────────────────────────
-- ON DELETE CASCADE: padrão do projeto (agent_message_batches usa CASCADE).
-- Exclusão de empresa remove todos os dados operacionais associados.
ALTER TABLE public.agent_batch_executions
  ADD CONSTRAINT agent_batch_executions_company_id_fkey
  FOREIGN KEY (company_id)
  REFERENCES public.companies(id)
  ON DELETE CASCADE;


-- ── 5. FK de execution_log_id: nova ──────────────────────────────────────────
-- execution_log_id aponta para ai_agent_execution_logs.id (UUID do log de LLM).
-- ON DELETE SET NULL: se o log for purgado, preserva o registro de execução.
-- Este campo NÃO é preenchido pelas RPCs desta etapa — apenas pelo AgentExecutor futuro.
ALTER TABLE public.agent_batch_executions
  ADD CONSTRAINT agent_batch_executions_execution_log_id_fkey
  FOREIGN KEY (execution_log_id)
  REFERENCES public.ai_agent_execution_logs(id)
  ON DELETE SET NULL;


-- ── 6. CHECK de status: remover 'pending' ─────────────────────────────────────
-- Localizar e remover constraint auto-gerada pelo nome real no banco.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid
    AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.agent_batch_executions'::regclass
    AND c.contype  = 'c'
    AND a.attname  = 'execution_status'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.agent_batch_executions DROP CONSTRAINT %I',
      v_constraint_name
    );
    RAISE NOTICE 'Removido constraint: %', v_constraint_name;
  ELSE
    RAISE NOTICE 'Nenhum CHECK constraint de execution_status encontrado — ignorando.';
  END IF;
END;
$$;

-- Novo CHECK sem 'pending':
-- processing   : execução em andamento, claim_token ativo
-- completed    : LLM executou e resposta enviada com sucesso
-- retry_pending: falha temporária; nova tentativa agendada
-- failed       : falha permanente
-- cancelled    : cancelada externamente
ALTER TABLE public.agent_batch_executions
  ADD CONSTRAINT agent_batch_executions_status_check
  CHECK (execution_status IN (
    'processing', 'completed', 'retry_pending', 'failed', 'cancelled'
  ));


-- ── 7. UNIQUE completa (não parcial) ─────────────────────────────────────────
-- Única restrição necessária com batch_id NOT NULL.
ALTER TABLE public.agent_batch_executions
  ADD CONSTRAINT uq_agent_batch_executions_batch
  UNIQUE (company_id, batch_id);


-- ── 8. Atualizar comentários ──────────────────────────────────────────────────
COMMENT ON TABLE public.agent_batch_executions IS
  'Controla a idempotência de execuções do agente de IA disparadas por lotes de mensagens. '
  'Garante que um mesmo batch_id não inicie duas execuções independentes por empresa. '
  'batch_id é NOT NULL — toda linha representa uma execução agrupada real. '
  'Execuções sem agrupamento (fluxo legado) não pertencem a esta tabela. '
  'IDENTIFICADOR ESTÁVEL: agent_batch_executions.id deve ser usado como execution_id '
  'no pipeline (Orchestrator, AgentExecutor) e em chat_messages.ai_run_id para '
  'rastrear o vínculo entre execução agrupada e mensagens enviadas ao lead. '
  'Retries do mesmo batch reutilizam o mesmo id — não geram novo UUID. '
  'PREREQUISITO PARA CRON: recovery de execuções stale deve ser implementado antes '
  'de ativar o cron.';

COMMENT ON COLUMN public.agent_batch_executions.batch_id IS
  'Lote que disparou esta execução. NOT NULL — toda execução nesta tabela é agrupada. '
  'FK com ON DELETE RESTRICT: o lote não pode ser excluído enquanto houver execução associada. '
  'Para limpar: encerrar a execução (mark_failed ou mark_cancelled) antes de deletar o lote.';

COMMENT ON COLUMN public.agent_batch_executions.company_id IS
  'Empresa que originou a execução. FK com ON DELETE CASCADE — padrão do projeto. '
  'Exclusão de empresa remove todos os dados operacionais associados.';

COMMENT ON COLUMN public.agent_batch_executions.execution_log_id IS
  'UUID do registro em ai_agent_execution_logs criado após a execução do LLM. '
  'NULL enquanto a execução não atingiu a fase de AgentExecutor. '
  'FK com ON DELETE SET NULL: preserva registro de execução se o log for purgado. '
  'Esta RPC NÃO preenche este campo — será preenchido pelo AgentExecutor na futura integração.';

COMMENT ON COLUMN public.agent_batch_executions.claim_token IS
  'Token de posse UUID gerado em cada claim (inicial ou retry). '
  'Toda operação de conclusão deve verificar claim_token para evitar race condition '
  'entre worker atrasado e nova execução do mesmo lote.';

COMMENT ON CONSTRAINT uq_agent_batch_executions_batch
  ON public.agent_batch_executions IS
  'Garante atomicamente que somente uma execução existe por (company_id, batch_id). '
  'Constraint completa (batch_id NOT NULL). '
  'Substituiu o índice parcial da migration 20260714190000.';


-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs — Recriar com schema corrigido
-- ═══════════════════════════════════════════════════════════════════════════


-- ── agent_batch_execution_claim_v1 ───────────────────────────────────────────
--
-- MUDANÇA NESTA VERSÃO:
--   Removido o branch de estado 'pending' (nunca é criado pelo sistema).
--   O único estados que permitem claim são:
--     - sem registro (INSERT)
--     - 'retry_pending' com next_attempt_at <= now()
--   Os demais estados são terminais ou já processando.

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

  -- Validar que o lote existe e pertence à empresa.
  -- Alias obrigatório: evita ambiguidade com coluna de retorno 'batch_id'
  -- no contexto de RETURNS TABLE (v_existing é o conflito interno).
  PERFORM 1
  FROM public.agent_message_batches amb
  WHERE amb.id = p_batch_id AND amb.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
      USING ERRCODE = 'P0001';
  END IF;

  -- Tentativa de INSERT como primeiro claim.
  -- Conflito no UNIQUE (company_id, batch_id) → execução já existe.
  v_new_token := gen_random_uuid();

  BEGIN
    INSERT INTO public.agent_batch_executions (
      company_id, batch_id, execution_status, claim_token, attempts
    ) VALUES (
      p_company_id, p_batch_id, 'processing', v_new_token, 1
    )
    RETURNING id INTO v_new_id;

    -- Primeiro claim bem-sucedido.
    -- O execution_id retornado (v_new_id = agent_batch_executions.id) é o
    -- identificador estável que o pipeline deve reutilizar como run_id.
    RETURN QUERY
      SELECT true, v_new_id, p_batch_id, 'processing'::TEXT,
             v_new_token, 1, 'claimed'::TEXT;
    RETURN;

  EXCEPTION WHEN unique_violation THEN
    -- Registro já existe: ler com FOR UPDATE para serializar decisão.
    -- Alias 'abe' evita ambiguidade com coluna de retorno 'batch_id'.
    SELECT abe.*
    INTO   v_existing
    FROM   public.agent_batch_executions abe
    WHERE  abe.company_id = p_company_id
      AND  abe.batch_id   = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
      -- Removido concorrentemente entre INSERT e SELECT (extremamente improvável)
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
      -- Retry ainda não está pronto
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

  ELSE
    -- Estado desconhecido ou 'pending' inserido manualmente (não permitido pelo CHECK)
    RAISE EXCEPTION 'INVALID_STATE: execution_status inesperado: %',
      v_existing.execution_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_execution_claim_v1(UUID, UUID) TO service_role;


-- ── mark_completed, mark_retry, mark_failed, mark_cancelled ──────────────────
-- Sem mudanças lógicas nestas funções. Recriadas para consistência e para
-- garantir que o GRANT se mantém com o schema corrigido.

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
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.attempts >= 3 THEN
    -- Máximo de tentativas atingido: falha permanente
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
    -- Backoff: attempts=1 → 60s; attempts=2 → 300s
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
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto.'
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
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_claim_token e obrigatorio' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou claim_token incorreto.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    UPDATE public.agent_batch_executions
    SET
      execution_status = 'cancelled',
      claim_token      = NULL,
      next_attempt_at  = NULL,
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
