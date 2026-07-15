-- =============================================================================
-- MIGRATION: Criar agent_message_batch_reschedule_v1
-- Data: 2026-07-15
-- Etapa: 13.1 — Parte C
--
-- OBJETIVO:
--   Permitir a transição processing → retry_pending por motivo de schedule,
--   SEM tratar isso como falha técnica.
--
--   Diferença em relação a agent_message_batch_mark_retry_v1:
--     - Não incrementa attempts (compensado por decrementar 1 após o claim)
--     - Define next_attempt_at com data explícita fornecida pelo caller
--     - Usa last_error_code = 'OUT_OF_SCHEDULE' (não um erro de infra)
--     - Tem limite de next_attempt_at de 8 dias (compatível com busca semanal)
--
-- CONTEXTO DO ATTEMPTS:
--   O claim (agent_batch_execution_claim_v1) já incrementou attempts ao
--   reivindicar a execução. Para schedule, esse incremento é indesejado —
--   o lote não falhou tecnicamente; apenas está fora do horário.
--   A RPC compensa: attempts = GREATEST(attempts - 1, 0).
--
-- PRÉ-CONDIÇÕES:
--   - company_id correto (multi-tenant)
--   - batch_id existe e pertence à empresa
--   - status = 'processing' (claim ativo)
--   - locked_at corresponde ao claim atual (prova de posse)
--   - next_attempt_at no futuro (> now())
--   - next_attempt_at dentro do limite (≤ now() + 8 dias)
--
-- SEGURANÇA:
--   SECURITY DEFINER + search_path fechado.
--   GRANT apenas para service_role.
--   Acesso via JWT negado (não concedido para authenticated/anon/public).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.agent_message_batch_reschedule_v1(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT);
-- =============================================================================

-- ── Remover versão anterior se existir ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- ── Criar função ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_message_batch_reschedule_v1(
  p_company_id      UUID,
  p_batch_id        UUID,
  p_locked_at       TIMESTAMPTZ,
  p_next_attempt_at TIMESTAMPTZ,
  p_reason          TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason      TEXT;
  v_updated_row public.agent_message_batches;
BEGIN

  -- ── Validação de parâmetros obrigatórios ─────────────────────────────────

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_REQUIRED: p_company_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'BATCH_REQUIRED: p_batch_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_locked_at IS NULL THEN
    RAISE EXCEPTION 'LOCKED_AT_REQUIRED: p_locked_at is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_next_attempt_at IS NULL THEN
    RAISE EXCEPTION 'NEXT_ATTEMPT_REQUIRED: p_next_attempt_at is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Validação de next_attempt_at ─────────────────────────────────────────

  IF p_next_attempt_at <= now() THEN
    RAISE EXCEPTION
      'INVALID_NEXT_ATTEMPT: p_next_attempt_at must be strictly in the future (received: %)',
      p_next_attempt_at
      USING ERRCODE = 'P0001';
  END IF;

  IF p_next_attempt_at > now() + INTERVAL '8 days' THEN
    RAISE EXCEPTION
      'NEXT_ATTEMPT_TOO_FAR: p_next_attempt_at cannot exceed 8 days from now (received: %)',
      p_next_attempt_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Sanitizar reason ─────────────────────────────────────────────────────
  -- Limite de 1.000 chars — não logar payload ou mensagem do usuário.

  v_reason := LEFT(COALESCE(p_reason, 'OUT_OF_SCHEDULE — reagendado para próxima janela'), 1000);

  -- ── Atualizar lote ───────────────────────────────────────────────────────
  --
  -- Pré-condições verificadas implicitamente pelo WHERE:
  --   id = p_batch_id          → batch existe e é o correto
  --   company_id = p_company_id → pertence ao tenant correto
  --   status = 'processing'    → claim ativo (não processado nem cancelado)
  --   locked_at = p_locked_at  → prova de posse (claim atual, não stale)
  --
  -- Não incrementar attempts: o claim já incrementou; esta RPC compensa.
  -- attempts = GREATEST(attempts - 1, 0) evita subzero em condição de borda.

  UPDATE public.agent_message_batches
  SET
    status          = 'retry_pending',
    next_attempt_at = p_next_attempt_at,
    locked_at       = NULL,
    last_error_code = 'OUT_OF_SCHEDULE',
    last_error      = v_reason,
    attempts        = GREATEST(attempts - 1, 0),
    updated_at      = now()
  WHERE id         = p_batch_id
    AND company_id = p_company_id
    AND status     = 'processing'
    AND locked_at  = p_locked_at
  RETURNING *
  INTO v_updated_row;

  -- ── Verificar se o UPDATE afetou alguma linha ─────────────────────────────
  --
  -- Se nenhuma linha foi afetada, as pré-condições não foram satisfeitas:
  --   - Batch não encontrado
  --   - company_id incorreto (TENANT_VIOLATION)
  --   - status diferente de 'processing' (INVALID_STATE)
  --   - locked_at diferente (CLAIM_MISMATCH — claim antigo ou já recuperado)
  --
  -- Não revelar qual pré-condição falhou para não expor dados cross-tenant.

  IF v_updated_row IS NULL THEN
    RAISE EXCEPTION
      'CLAIM_MISMATCH: batch not found or not in expected state for reschedule. '
      'Expected: status=processing, locked_at=%, company_id=%',
      p_locked_at, p_company_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEXT v_updated_row;
END;
$$;

-- ── Permissões ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

-- ── Comentário ───────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.agent_message_batch_reschedule_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
  'Transição processing → retry_pending por motivo de schedule. '
  'NÃO incrementa attempts (o claim já incrementou; esta RPC compensa com GREATEST(attempts-1,0)). '
  'Exige prova de posse via locked_at. '
  'p_next_attempt_at: estritamente no futuro, máximo 8 dias. '
  'Uso exclusivo via service_role — nunca exposto ao frontend.';
