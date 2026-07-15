-- =====================================================
-- MIGRATION: Recovery de execuções agrupadas presas
-- Timestamp: 20260714210000
-- Etapa 9 — RPC de recovery (sem call sites)
--
-- CONTEXTO:
--   Esta migration cria a função de recovery para execuções de
--   agent_batch_executions que ficaram presas em 'processing' por timeout,
--   interrupção do worker ou falha inesperada.
--   A função permanece sem call sites até a ativação do cron.
--
-- CRITÉRIO DE STALE:
--   Uma execução é considerada stale quando:
--     execution_status = 'processing'
--     updated_at <= now() - make_interval(secs => p_stale_after_seconds)
--
--   LIMITAÇÃO DOCUMENTADA:
--     O trigger trg_agent_batch_executions_updated_at (BEFORE UPDATE) redefine
--     updated_at = now() em qualquer UPDATE. Portanto, updated_at representa
--     o momento da última transição de estado — incluindo o claim mais recente.
--     Qualquer futura atualização de progresso intermediário NÃO deve tocar
--     updated_at indiscriminadamente, pois isso reiniciaria o timeout de stale.
--     Se o pipeline precisar registrar progresso sem afetar o timeout,
--     um campo dedicado como execution_locked_at deve ser introduzido em
--     migração futura.
--
-- STATE MACHINE DE RECOVERY:
--   processing (stale) + attempts < 3  →  retry_pending
--   processing (stale) + attempts ≥ 3  →  failed
--
--   Não incrementa attempts — o increment ocorre em claim_v1 ao re-claim.
--
-- BACKOFF (coerente com mark_retry_v1):
--   attempts = 1  →  next_attempt_at = now() + 60 segundos
--   attempts = 2  →  next_attempt_at = now() + 300 segundos
--   attempts ≥ 3  →  failed, next_attempt_at = NULL
--
-- INVALIDAÇÃO DO CLAIM ANTIGO:
--   claim_token = NULL após recovery.
--   O worker anterior receberá CLAIM_MISMATCH em qualquer chamada de conclusão.
--   Uma futura re-claim gera novo claim_token via claim_v1.
--
-- COMPATIBILIDADE COM claim_v1:
--   A RPC existente agent_batch_execution_claim_v1 já suporta retry_pending:
--     - Se next_attempt_at > now() → retry_not_ready
--     - Se elegível → processing, attempts+1, novo claim_token
--   Nenhuma alteração necessária na claim_v1.
--
-- CONCORRÊNCIA:
--   CTE com FOR UPDATE SKIP LOCKED garante que dois recoveries concorrentes
--   não processem a mesma execução. O segundo recovery pula linhas já
--   bloqueadas pelo primeiro.
--
-- DOIS NÍVEIS DE RECOVERY INDEPENDENTES:
--   agent_message_batches → recovery via agent_message_batches_recover_stale_v1
--   agent_batch_executions → recovery via esta função
--   O futuro cron deverá coordenar os dois níveis. Recuperar a execução
--   NÃO recupera automaticamente o lote, e vice-versa.
--   A ordem, estado esperado de lote vs execução e como evitar divergência
--   entre eles deve ser definida antes da ativação do cron.
--
-- ÍNDICE:
--   Não existe índice em (execution_status, updated_at). Para tabela pequena,
--   scan sequencial é aceitável. Se a tabela crescer, criar:
--     CREATE INDEX idx_agent_batch_executions_stale
--       ON public.agent_batch_executions (updated_at ASC)
--       WHERE execution_status = 'processing';
--
-- PREREQUISITO PARA CRON:
--   Esta função deve ser ativada no cron antes de qualquer integração do
--   pipeline com execuções agrupadas.
--
-- ROLLBACK:
--   DROP FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER);
--   Nenhuma tabela ou dado precisa ser revertido.
-- =====================================================


CREATE OR REPLACE FUNCTION public.agent_batch_executions_recover_stale_v1(
  p_stale_after_seconds INTEGER DEFAULT 300,
  p_limit               INTEGER DEFAULT 20
)
RETURNS SETOF public.agent_batch_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Validação de parâmetros
  IF p_stale_after_seconds IS NULL OR p_stale_after_seconds < 60 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_stale_after_seconds deve ser >= 60 (recebido: %)',
      coalesce(p_stale_after_seconds::TEXT, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_stale_after_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_stale_after_seconds deve ser <= 3600 (recebido: %)',
      p_stale_after_seconds
      USING ERRCODE = 'P0001';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit deve ser >= 1 (recebido: %)',
      coalesce(p_limit::TEXT, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit deve ser <= 100 (recebido: %)',
      p_limit
      USING ERRCODE = 'P0001';
  END IF;

  -- Recovery atômico via CTE
  --
  -- FOR UPDATE SKIP LOCKED:
  --   Dois recoveries concorrentes nunca processam a mesma linha.
  --   O segundo recovery pula linhas já bloqueadas pelo primeiro.
  --
  -- ORDER BY updated_at ASC, id ASC:
  --   Recupera primeiro as execuções presas há mais tempo.
  --   Determinístico e justo.
  --
  -- CASE em execution_status, next_attempt_at, last_error_code, last_error:
  --   attempts ≥ 3 → failed (encerramento permanente)
  --   attempts < 3 → retry_pending (nova tentativa agendada)
  --
  -- updated_at = now() explícito:
  --   O trigger set_updated_at() também atualiza updated_at via BEFORE UPDATE,
  --   produzindo o mesmo valor. Não há conflito.
  --
  -- RETORNO:
  --   Apenas linhas efetivamente modificadas (RETURNING).
  --   Estado retornado: 'retry_pending' ou 'failed'. Nunca 'processing'.
  RETURN QUERY
  WITH stale_executions AS (
    SELECT id
    FROM   public.agent_batch_executions
    WHERE  execution_status = 'processing'
      AND  updated_at <= now() - make_interval(secs => p_stale_after_seconds)
    ORDER BY updated_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.agent_batch_executions AS abe
  SET
    execution_status = CASE
      WHEN abe.attempts >= 3 THEN 'failed'
      ELSE                        'retry_pending'
    END,
    claim_token = NULL,
    next_attempt_at = CASE
      WHEN abe.attempts >= 3 THEN NULL
      WHEN abe.attempts =  1 THEN now() + INTERVAL '60 seconds'
      WHEN abe.attempts =  2 THEN now() + INTERVAL '300 seconds'
      ELSE                        now() + INTERVAL '300 seconds'
    END,
    last_error_code = CASE
      WHEN abe.attempts >= 3 THEN 'STALE_EXECUTION_MAX_ATTEMPTS'
      ELSE                        'STALE_EXECUTION_RECOVERED'
    END,
    last_error = CASE
      WHEN abe.attempts >= 3 THEN left(
        'Execucao encerrada por limite de tentativas durante recovery de claim stale. ' ||
        'Ultima atualizacao: ' || abe.updated_at::TEXT,
        2000
      )
      ELSE left(
        'Claim stale detectado. Execucao reagendada para retry. ' ||
        'Ultima atualizacao: ' || abe.updated_at::TEXT,
        2000
      )
    END,
    updated_at = now()
  FROM stale_executions
  WHERE abe.id = stale_executions.id
  RETURNING abe.*;
END;
$$;

COMMENT ON FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER) IS
  'Recupera execuções de agent_batch_executions presas em processing por timeout ou '
  'interrupção do worker. '
  'Transiciona para retry_pending (attempts < 3) ou failed (attempts >= 3). '
  'Invalida o claim_token anterior (claim_token = NULL). '
  'Usa FOR UPDATE SKIP LOCKED para garantir que dois recoveries concorrentes '
  'nao processem a mesma execucao. '
  'Deve ser chamada pelo cron antes de qualquer nova claim. '
  'Pré-requisito: deve existir antes da ativação do cron. '
  'IMPORTANTE: updated_at representa o momento da última transição de estado. '
  'Atualizações de progresso intermediário não devem alterar updated_at, '
  'pois isso reiniciaria o timeout de stale. '
  'PREREQUISITO PARA CRON: coordenação com agent_message_batches_recover_stale_v1 '
  'deve ser definida antes da ativação do cron — os dois níveis são independentes.';

REVOKE ALL ON FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_batch_executions_recover_stale_v1(INTEGER, INTEGER) TO service_role;
