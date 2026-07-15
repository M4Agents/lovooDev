-- =============================================================================
-- Migration: create_agent_conversation_lock_rpcs
--
-- Cria duas RPCs atômicas para aquisição e liberação do lock de conversa do
-- agente de IA, substituindo o fluxo não-atômico SELECT→DELETE→INSERT que
-- existia em conversationLock.js.
--
-- RACE CONDITION CORRIGIDA:
--   O fluxo anterior usava 3 operações separadas sem transação, permitindo que
--   um worker apagasse ou perdesse o lock para outro worker entre as operações.
--   A nova RPC usa INSERT otimista + SELECT FOR UPDATE para garantir que apenas
--   um worker por vez modifica o lock.
--
-- NÃO ALTERA a tabela agent_processing_locks — apenas cria funções.
-- =============================================================================


-- ── agent_conversation_lock_acquire_v1 ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.agent_conversation_lock_acquire_v1(
  p_company_id          UUID,
  p_conversation_id     UUID,
  p_run_id              UUID,
  p_stale_after_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing RECORD;
BEGIN

  -- ── Validações de entrada ──────────────────────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_conversation_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_run_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_stale_after_seconds < 30 OR p_stale_after_seconds > 3600 THEN
    RAISE EXCEPTION
      'INVALID_PARAM: p_stale_after_seconds deve estar entre 30 e 3600 (recebido: %)',
      p_stale_after_seconds
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Validação multi-tenant ─────────────────────────────────────────────────
  -- Confirma que conversation_id pertence a company_id.
  -- Impede que um caller passe conversation_id de outra empresa.
  IF NOT EXISTS (
    SELECT 1
    FROM   public.chat_conversations
    WHERE  id         = p_conversation_id
      AND  company_id = p_company_id
  ) THEN
    RAISE EXCEPTION
      'TENANT_VIOLATION: conversa % não pertence à empresa %',
      p_conversation_id, p_company_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Tentativa otimista: INSERT direto (caminho feliz) ──────────────────────
  -- Se não existe lock → INSERT com sucesso imediato.
  -- Se existe lock → 23505 → tratar com SELECT FOR UPDATE.
  BEGIN
    INSERT INTO public.agent_processing_locks
      (company_id, conversation_id, locked_by_run_id)
    VALUES
      (p_company_id, p_conversation_id, p_run_id);

    RETURN jsonb_build_object('acquired', true, 'reason', 'acquired');

  EXCEPTION WHEN unique_violation THEN
    -- Lock existe — inspecionar com row-level lock
    NULL;
  END;

  -- ── Inspecionar lock existente com row-level lock ──────────────────────────
  -- SELECT FOR UPDATE bloqueia a linha enquanto a função decide.
  -- Outros workers que tentam adquirir o mesmo lock ficam em fila aqui.
  -- Quando desbloqueados, veem o estado atual e tomam a decisão correta.
  SELECT locked_by_run_id, acquired_at
  INTO   v_existing
  FROM   public.agent_processing_locks
  WHERE  company_id      = p_company_id
    AND  conversation_id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Lock foi removido entre o 23505 e o SELECT FOR UPDATE (race raro).
    -- Tentar inserir novamente.
    BEGIN
      INSERT INTO public.agent_processing_locks
        (company_id, conversation_id, locked_by_run_id)
      VALUES
        (p_company_id, p_conversation_id, p_run_id);
      RETURN jsonb_build_object('acquired', true, 'reason', 'acquired');
    EXCEPTION WHEN unique_violation THEN
      -- Outro worker acabou de inserir entre o SELECT e este INSERT.
      RETURN jsonb_build_object('acquired', false, 'reason', 'lock_busy');
    END;
  END IF;

  -- ── Caso: Mesmo runId — re-aquisição idempotente ───────────────────────────
  -- Preserva acquired_at original: retries do mesmo worker não renovam o lock,
  -- evitando que um lock abandonado fique vivo indefinidamente.
  IF v_existing.locked_by_run_id = p_run_id THEN
    RETURN jsonb_build_object('acquired', true, 'reason', 'already_owned');
  END IF;

  -- ── Caso: Lock stale — substituir atomicamente ─────────────────────────────
  -- Já temos SELECT FOR UPDATE na linha → UPDATE é seguro sem nova verificação.
  -- Nenhum outro worker pode inserir nem modificar esta linha enquanto
  -- esta transação não fizer COMMIT.
  IF v_existing.acquired_at <= now() - make_interval(secs => p_stale_after_seconds) THEN
    UPDATE public.agent_processing_locks
    SET
      locked_by_run_id = p_run_id,
      acquired_at      = now()
    WHERE company_id      = p_company_id
      AND conversation_id = p_conversation_id;

    RETURN jsonb_build_object('acquired', true, 'reason', 'stale_replaced');
  END IF;

  -- ── Caso: Lock ativo de outro runId — ocupado ──────────────────────────────
  RETURN jsonb_build_object('acquired', false, 'reason', 'lock_busy');

END;
$$;

REVOKE ALL ON FUNCTION public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION public.agent_conversation_lock_acquire_v1(UUID, UUID, UUID, INTEGER) IS
  'Aquisição atômica de lock de conversa para o agente de IA. '
  'Comportamentos: acquired (lock inexistente), already_owned (mesmo runId — idempotente, '
  'preserved acquired_at), stale_replaced (lock expirado substituído atomicamente), '
  'lock_busy (outro worker ativo). '
  'Garante atomicidade via INSERT otimista + SELECT FOR UPDATE (sem race condition). '
  'Valida multi-tenant: conversa deve pertencer à empresa. '
  'p_stale_after_seconds: mínimo 30, máximo 3600, padrão 300 (5 min). '
  'Uso exclusivo via service_role — nunca exposto ao frontend.';


-- ── agent_conversation_lock_release_v1 ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.agent_conversation_lock_release_v1(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.agent_conversation_lock_release_v1(
  p_company_id      UUID,
  p_conversation_id UUID,
  p_run_id          UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_conversation_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_run_id é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;

  -- DELETE filtra pelos três campos — prova de posse.
  -- Worker antigo nunca remove o lock de um worker mais novo.
  DELETE FROM public.agent_processing_locks
  WHERE company_id       = p_company_id
    AND conversation_id  = p_conversation_id
    AND locked_by_run_id = p_run_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    RETURN jsonb_build_object('released', true);
  ELSE
    RETURN jsonb_build_object('released', false);
  END IF;

END;
$$;

REVOKE ALL ON FUNCTION public.agent_conversation_lock_release_v1(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_conversation_lock_release_v1(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.agent_conversation_lock_release_v1(UUID, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_conversation_lock_release_v1(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.agent_conversation_lock_release_v1(UUID, UUID, UUID) IS
  'Liberação atômica de lock de conversa do agente de IA. '
  'Filtra por company_id + conversation_id + locked_by_run_id (prova de posse). '
  'Worker antigo nunca remove lock de worker mais novo. '
  'Retorna {released: true} se removido, {released: false} se não encontrado (não é erro crítico). '
  'Uso exclusivo via service_role — nunca exposto ao frontend.';
