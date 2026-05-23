-- =============================================================================
-- FASE 2 — Integração Instagram (RPC 3/3)
-- Função: acquire_instagram_conversation_lock
--
-- Objetivo: adquirir lock temporário em uma conversa.
-- Regras:
--   - Lock livre ou expirado → adquirir (caller assume)
--   - Lock ativo do próprio caller → renovar
--   - Lock ativo de outro usuário → retornar bloqueado (sem takeover)
--
-- IMPORTANTE:
--   - Takeover NÃO está implementado aqui (será via backend futuro)
--   - Callable por authenticated (agentes/vendedores travam conversas)
--   - Valida membership antes de permitir lock
--   - Usa configuração de conversation_lock_minutes da empresa (fallback: 15 min)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_instagram_conversation_lock(
  p_conversation_id UUID,
  p_lock_minutes    INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       UUID := auth.uid();
  v_conv            public.instagram_conversations%ROWTYPE;
  v_lock_minutes    INT;
  v_now             TIMESTAMPTZ := now();
  v_lock_expires_at TIMESTAMPTZ;
BEGIN
  -- Caller deve ser autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'unauthenticated'
    );
  END IF;

  -- Buscar conversa
  SELECT *
    INTO v_conv
    FROM public.instagram_conversations
   WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'conversation_not_found'
    );
  END IF;

  -- Validar que o caller é membro da empresa dona da conversa
  IF NOT (
    public.auth_user_is_company_member(v_conv.company_id)
    OR public.auth_user_is_parent_admin(v_conv.company_id)
  ) THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'forbidden'
    );
  END IF;

  -- Resolver duração do lock: parâmetro > configuração da empresa > default 15 min
  IF p_lock_minutes IS NOT NULL THEN
    v_lock_minutes := GREATEST(1, LEAST(120, p_lock_minutes));
  ELSE
    SELECT COALESCE(s.conversation_lock_minutes, 15)
      INTO v_lock_minutes
      FROM public.instagram_company_settings s
     WHERE s.company_id = v_conv.company_id;

    IF NOT FOUND THEN
      v_lock_minutes := 15;
    END IF;
  END IF;

  v_lock_expires_at := v_now + (v_lock_minutes || ' minutes')::INTERVAL;

  -- Avaliar estado atual do lock
  IF v_conv.locked_by IS NULL
     OR v_conv.lock_expires_at IS NULL
     OR v_conv.lock_expires_at < v_now
  THEN
    -- Lock livre ou expirado → adquirir
    UPDATE public.instagram_conversations SET
      locked_by       = v_caller_id,
      locked_at       = v_now,
      lock_expires_at = v_lock_expires_at,
      updated_at      = v_now
    WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'ok',             true,
      'acquired',       true,
      'renewed',        false,
      'locked_by',      v_caller_id,
      'lock_expires_at', v_lock_expires_at,
      'message',        'Lock adquirido com sucesso'
    );

  ELSIF v_conv.locked_by = v_caller_id THEN
    -- Lock ativo do próprio caller → renovar
    UPDATE public.instagram_conversations SET
      locked_at       = v_now,
      lock_expires_at = v_lock_expires_at,
      updated_at      = v_now
    WHERE id = p_conversation_id;

    RETURN jsonb_build_object(
      'ok',             true,
      'acquired',       false,
      'renewed',        true,
      'locked_by',      v_caller_id,
      'lock_expires_at', v_lock_expires_at,
      'message',        'Lock renovado com sucesso'
    );

  ELSE
    -- Lock ativo de outro usuário → retornar bloqueado
    RETURN jsonb_build_object(
      'ok',             false,
      'acquired',       false,
      'renewed',        false,
      'blocked',        true,
      'locked_by',      v_conv.locked_by,
      'lock_expires_at', v_conv.lock_expires_at,
      'message',        'Conversa bloqueada por outro usuário'
    );
  END IF;
END;
$$;

-- Callable por authenticated (agentes e vendedores podem travar conversas)
REVOKE EXECUTE ON FUNCTION public.acquire_instagram_conversation_lock(UUID, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.acquire_instagram_conversation_lock(UUID, INT)
  TO authenticated;
