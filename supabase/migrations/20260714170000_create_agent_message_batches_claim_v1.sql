-- =====================================================
-- MIGRATION: RPC atômica de claim de lotes
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Claim Atômico (Migration E — Etapa 4)
--
-- Propósito:
--   Criar uma RPC versionada para reivindicar atomicamente lotes elegíveis.
--   Um lote reivindicado transita de pending/retry_pending para processing.
--   Utilizada futuramente pelo Vercel Cron (nesta etapa nenhuma chamada integrada).
--
-- Função criada:
--   public.agent_message_batches_claim_v1(p_limit integer DEFAULT 20)
--   RETURNS SETOF public.agent_message_batches
--
-- Critérios de elegibilidade:
--   pending:       status = 'pending'
--                  AND deadline_at <= now()
--
--   retry_pending: status = 'retry_pending'
--                  AND deadline_at <= now()
--                  AND next_attempt_at IS NOT NULL
--                  AND next_attempt_at <= now()
--
-- Mecanismo de concorrência:
--   SELECT ... FOR UPDATE SKIP LOCKED — impede espera e claim duplicado.
--   CTE + UPDATE RETURNING — atômico em uma única statement SQL.
--   Dois consumidores simultâneos recebem subconjuntos disjuntos de lotes.
--
-- Impacto no banco:
--   Cria apenas uma nova função. Nenhuma tabela alterada.
--   Nenhum dado existente afetado na criação da função.
--
-- Dependências:
--   public.agent_message_batches                (Migration B — 20260714140000)
--   public.set_updated_at()                     (trigger existente na tabela)
--
-- Rollback:
--   DROP FUNCTION public.agent_message_batches_claim_v1(integer);
-- =====================================================


-- ════════════════════════════════════════════════════════════════════════════
-- FUNÇÃO: public.agent_message_batches_claim_v1
-- ════════════════════════════════════════════════════════════════════════════
--
-- Algoritmo:
--
-- PASSO 1 — Validar p_limit (1 ≤ p_limit ≤ 100).
--   Valores inválidos: NULL, zero, negativo, acima de 100.
--   Qualquer valor inválido → RAISE EXCEPTION 'INVALID_PARAM'.
--
-- PASSO 2 — Claim atômico via CTE + UPDATE RETURNING.
--
--   Seleciona IDs dos lotes elegíveis:
--     pending:       deadline_at <= now()
--     retry_pending: deadline_at <= now() AND next_attempt_at IS NOT NULL
--                    AND next_attempt_at <= now()
--
--   Ordena por horário efetivo de elegibilidade:
--     COALESCE(next_attempt_at, deadline_at) — pending usa deadline_at
--                                              (next_attempt_at é NULL);
--                                              retry_pending usa next_attempt_at
--                                              (horário do backoff, mais específico)
--     deadline_at ASC   — desempate pelo prazo
--     id ASC            — tiebreaker determinístico
--
--   FOR UPDATE SKIP LOCKED:
--     Adquire lock exclusivo por linha. Linhas travadas por outro consumidor
--     são puladas imediatamente (sem espera). Garante subconjuntos disjuntos.
--
--   LIMIT v_limit:
--     Aplicado dentro da CTE, limita os IDs selecionados e travados.
--
--   UPDATE define:
--     status     = 'processing'
--     locked_at  = now()          — referência para recovery de presos
--     attempts   = attempts + 1   — contador de tentativas
--     updated_at = now()          — explícito; trigger also sets the same value
--
--   RETURNING *:
--     Retorna o estado PERSISTIDO após o UPDATE (não cálculo manual).
--     Todos os registros retornados têm status = 'processing'
--     e locked_at IS NOT NULL por construção.
--
-- Trigger updated_at:
--   trg_agent_message_batches_updated_at (BEFORE UPDATE) chama set_updated_at()
--   que define NEW.updated_at = now(). O SET explícito na função resulta no
--   mesmo valor (now() é estável por transação). Sem conflito — apenas
--   redundância inofensiva que garante o comportamento mesmo sem trigger.
--
-- Retorno vazio (SETOF com 0 linhas):
--   Ocorre quando nenhum lote é elegível ou todos estão travados por outros
--   consumidores. Não é um erro — o chamador deve tratar 0 linhas como
--   "nada a processar neste ciclo".

CREATE OR REPLACE FUNCTION public.agent_message_batches_claim_v1(
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER;
BEGIN

  -- ── PASSO 1: Validação de p_limit ──────────────────────────────────────────
  -- Não confiar no chamador. Limites validados explicitamente no banco.
  -- NULL é tratado defensivamente: o DEFAULT evita chegada nula em chamadas
  -- normais, mas chamadas explícitas com NULL = 1 devem ser rejeitadas.

  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit deve ser entre 1 e 100, recebido: %',
      COALESCE(p_limit::text, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit excede o maximo de 100, recebido: %', p_limit
      USING ERRCODE = 'P0001';
  END IF;

  v_limit := p_limit;

  -- ── PASSO 2: Claim atômico ──────────────────────────────────────────────────
  -- A CTE e o UPDATE são uma única statement SQL — atômica por definição.
  -- O lock (FOR UPDATE) é adquirido durante a CTE e mantido até o commit.
  -- A transição pending/retry_pending → processing é garantida atomicamente:
  -- nenhum outro consumidor pode reivindicar a mesma linha após o lock.

  RETURN QUERY
    WITH due_batches AS (
      SELECT b.id
      FROM public.agent_message_batches b
      WHERE (
            b.status = 'pending'
        AND b.deadline_at <= now()
      )
      OR (
            b.status = 'retry_pending'
        AND b.deadline_at <= now()
        AND b.next_attempt_at IS NOT NULL
        AND b.next_attempt_at <= now()
      )
      ORDER BY
        COALESCE(b.next_attempt_at, b.deadline_at) ASC,
        b.deadline_at ASC,
        b.id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT v_limit
    )
    UPDATE public.agent_message_batches
    SET
      status     = 'processing',
      locked_at  = now(),
      attempts   = public.agent_message_batches.attempts + 1,
      updated_at = now()
    FROM due_batches
    WHERE public.agent_message_batches.id = due_batches.id
    RETURNING public.agent_message_batches.*;

END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- SEGURANÇA — REVOKE E GRANT
-- ════════════════════════════════════════════════════════════════════════════
--
-- A RPC opera sobre agent_message_batches com FOR UPDATE — acesso exclusivo
-- ao cron/backend via service_role.
-- RLS já bloqueia anon e authenticated ao nível de tabela (sem policies).
-- Os REVOKEs abaixo reforçam a restrição ao nível de função.

REVOKE ALL ON FUNCTION public.agent_message_batches_claim_v1(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batches_claim_v1(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batches_claim_v1(INTEGER) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.agent_message_batches_claim_v1(INTEGER) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- COMENTÁRIO
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.agent_message_batches_claim_v1(INTEGER) IS
  'RPC atômica de claim de lotes elegíveis para processamento (v1). '
  'Seleciona lotes pending (deadline_at <= now()) ou retry_pending '
  '(deadline_at <= now() AND next_attempt_at IS NOT NULL AND next_attempt_at <= now()). '
  'Aplica status=processing, locked_at=now(), attempts=attempts+1 via CTE+UPDATE RETURNING. '
  'FOR UPDATE SKIP LOCKED garante que dois consumidores nunca reivindicam o mesmo lote. '
  'Retorna SETOF agent_message_batches (apenas lotes efetivamente reivindicados). '
  'Retorno vazio = nenhum lote elegível disponível (não é erro). '
  'p_limit: 1..100 (default=20). Acesso exclusivo via service_role.';


-- =====================================================
-- ROLLBACK MANUAL (não executar automaticamente)
--
-- A migration cria apenas uma função — nenhum dado é afetado.
-- Para reverter:
--
--   DROP FUNCTION public.agent_message_batches_claim_v1(integer);
--
-- Não é necessário rollback de dados, tabelas ou outros objetos.
-- =====================================================
