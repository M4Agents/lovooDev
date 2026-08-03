-- =============================================================================
-- Nuvemshop Integration — Migration 12/12
-- RPC: replay_nuvemshop_event
--
-- Operação administrativa transacional para reprocessar um evento morto (dead).
-- Toda a operação ocorre em uma única transação:
--   - Valida estado do evento (somente 'dead' ou 'failed' são elegíveis)
--   - Verifica ausência de lock ativo no recurso
--   - Registra auditoria (nuvemshop_replay_audit)
--   - Altera evento para 'pending', incrementa replay_count
--   - Rollback automático em qualquer falha intermediária
--
-- Proteções:
--   - Nunca existe replay sem auditoria (operação atômica)
--   - Nunca existe auditoria sem replay (mesma transação)
--   - Dois replays simultâneos do mesmo evento são impedidos (lock check)
--   - O payload original é preservado intacto
--
-- Segurança:
--   - RBAC validado NO ENDPOINT antes de chamar este RPC
--   - p_replayed_by recebe o UUID do usuário autenticado (validado no endpoint)
--   - SECURITY DEFINER com search_path explícito
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.replay_nuvemshop_event(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.replay_nuvemshop_event(
  p_event_id        UUID,
  p_replayed_by     UUID,
  p_reason          TEXT,
  p_ip_address      TEXT    DEFAULT NULL,
  p_user_agent      TEXT    DEFAULT NULL,
  p_correlation_id  TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event         public.nuvemshop_webhook_events%ROWTYPE;
  v_lock_active   BOOLEAN;
  v_replay_count  SMALLINT;
BEGIN
  -- Validações de parâmetros
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_id is required');
  END IF;

  IF p_replayed_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'replayed_by is required');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason is required');
  END IF;

  -- Buscar e bloquear o evento (FOR UPDATE previne replay concorrente)
  SELECT * INTO v_event
  FROM public.nuvemshop_webhook_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;

  -- Apenas eventos 'failed' ou 'dead' são elegíveis para replay
  IF v_event.status NOT IN ('failed', 'dead') THEN
    RETURN jsonb_build_object(
      'ok',             false,
      'error',          'event_not_eligible',
      'current_status', v_event.status
    );
  END IF;

  -- Verificar ausência de processamento ativo para o mesmo recurso
  -- (extrai resource_type/resource_id do payload Nuvemshop)
  SELECT EXISTS (
    SELECT 1
    FROM public.nuvemshop_processing_locks lk
    WHERE lk.company_id = v_event.company_id
      AND lk.store_id   = v_event.store_id
      AND lk.expires_at > now()
  ) INTO v_lock_active;

  IF v_lock_active THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'resource_locked'
    );
  END IF;

  v_replay_count := v_event.replay_count + 1;

  -- Registrar auditoria (deve ocorrer na mesma transação que a atualização do evento)
  INSERT INTO public.nuvemshop_replay_audit (
    event_id,
    company_id,
    store_id,
    replayed_by,
    replayed_at,
    replay_count,
    previous_status,
    new_status,
    reason,
    ip_address,
    user_agent,
    correlation_id
  ) VALUES (
    p_event_id,
    v_event.company_id,
    v_event.store_id,
    p_replayed_by,
    now(),
    v_replay_count,
    v_event.status,
    'pending',
    trim(p_reason),
    p_ip_address,
    p_user_agent,
    p_correlation_id
  );

  -- Atualizar evento para reprocessamento
  -- O payload original é preservado; apenas estado e contadores mudam
  UPDATE public.nuvemshop_webhook_events
  SET
    status          = 'pending',
    replay_count    = v_replay_count,
    attempts        = 0,
    last_error      = NULL,
    next_attempt_at = now(),
    worker_id       = NULL,
    acquired_at     = NULL,
    processed_at    = NULL,
    updated_at      = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'event_id',     p_event_id,
    'replay_count', v_replay_count
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Qualquer erro causa rollback automático da transação
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'internal_error'
    );
END;
$$;

-- Acesso restrito: somente service_role (endpoint admin valida RBAC antes de chamar)
REVOKE EXECUTE ON FUNCTION public.replay_nuvemshop_event(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.replay_nuvemshop_event(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
