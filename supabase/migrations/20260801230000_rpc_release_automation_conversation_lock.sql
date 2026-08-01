-- =====================================================================
-- Migration G — RPC release_automation_conversation_lock_v1
--
-- Libera a lease de uma conversa.
-- Validações obrigatórias: company_id, channel, conversation_id, e
-- pelo menos um dos dois: schedule_id ou lock_id.
-- Não libera lease que pertença a outro schedule.
--
-- Chamada em finally pelo processador — garante liberação mesmo em erro.
--
-- Retorno JSONB:
--   { released: bool, reason: text }
-- =====================================================================

CREATE OR REPLACE FUNCTION public.release_automation_conversation_lock_v1(
  p_company_id       UUID,
  p_channel          TEXT,
  p_conversation_id  UUID,
  p_schedule_id      UUID DEFAULT NULL,
  p_lock_id          UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Validações obrigatórias
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'company_id_required');
  END IF;
  IF p_channel IS NULL OR p_channel = '' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'channel_required');
  END IF;
  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'conversation_id_required');
  END IF;
  IF p_schedule_id IS NULL AND p_lock_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'schedule_id_or_lock_id_required');
  END IF;

  DELETE FROM public.automation_conversation_locks
   WHERE company_id      = p_company_id
     AND channel          = p_channel
     AND conversation_id  = p_conversation_id
     AND (
       -- Liberar pelo schedule_id OU pelo lock_id — qualquer um é suficiente
       (p_schedule_id IS NOT NULL AND schedule_id = p_schedule_id)
       OR
       (p_lock_id IS NOT NULL AND id = p_lock_id)
     );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count = 0 THEN
    -- Lease não encontrada ou pertence a outro — não é erro crítico
    -- (pode ter expirado e sido recuperada por outro worker)
    RETURN jsonb_build_object('released', false, 'reason', 'not_found_or_owned_by_other');
  END IF;

  RETURN jsonb_build_object('released', true, 'reason', 'ok');
END;
$$;

-- REVOKE FROM anon explícito: mesmo motivo da RPC claim.
REVOKE ALL ON FUNCTION public.release_automation_conversation_lock_v1(UUID, TEXT, UUID, UUID, UUID)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_automation_conversation_lock_v1(UUID, TEXT, UUID, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.release_automation_conversation_lock_v1 IS
  'Libera lease de conversa do motor de automação Instagram.
   Valida company_id, channel, conversation_id e ownership (schedule_id ou lock_id).
   Não falha se a lease já foi liberada ou expirou — comportamento idempotente.
   Apenas service_role pode chamar.';
