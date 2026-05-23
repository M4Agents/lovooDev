-- =============================================================================
-- FASE 2 — Integração Instagram (RPC 1/3)
-- Função: process_instagram_dm_webhook
--
-- Objetivo: processar um evento de DM do Instagram recebido via webhook.
--   1. Resolve company_id e connection via instagram_user_id (NUNCA aceita company_id direto)
--   2. Garante idempotência por ig_message_id
--   3. Cria ou atualiza a conversa (UPSERT por company_id + ig_thread_id)
--   4. Insere a mensagem (ON CONFLICT DO NOTHING)
--   5. Atualiza unread_count, last_message_at, last_message_preview
--   6. Tenta vincular lead existente via lead_social_profiles
--
-- IMPORTANTE:
--   - Não cria lead automaticamente (fluxo de criação de lead será RPC separada)
--   - Callable apenas por service_role (backend de webhook)
--   - p_instagram_user_id = nossa conta Instagram (instagram_connections.instagram_user_id)
--   - p_participant_ig_user_id = usuário externo com quem conversamos
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_instagram_dm_webhook(
  p_instagram_user_id    TEXT,
  p_ig_message_id        TEXT,
  p_ig_thread_id         TEXT,
  p_participant_ig_user_id TEXT,
  p_participant_name     TEXT        DEFAULT NULL,
  p_participant_username TEXT        DEFAULT NULL,
  p_direction            TEXT        DEFAULT 'inbound',
  p_message_type         TEXT        DEFAULT 'text',
  p_content              TEXT        DEFAULT NULL,
  p_media_url            TEXT        DEFAULT NULL,
  p_timestamp            TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection      public.instagram_connections%ROWTYPE;
  v_conversation_id UUID;
  v_lead_id         INTEGER;
  v_message_existed BOOLEAN := false;
BEGIN
  -- Barreira de segurança: apenas service_role pode chamar esta função
  -- O Supabase concede EXECUTE para authenticated automaticamente via PostgREST;
  -- esta validação interna impede chamadas não autorizadas mesmo assim.
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Resolver conexão via instagram_user_id (nunca aceitar company_id como parâmetro)
  SELECT *
    INTO v_connection
    FROM public.instagram_connections
   WHERE instagram_user_id = p_instagram_user_id
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'connection_not_found',
      'detail', format('Nenhuma conexão ativa para instagram_user_id = %s', p_instagram_user_id)
    );
  END IF;

  -- 2. Idempotência: verificar se a mensagem já foi processada
  SELECT EXISTS(
    SELECT 1 FROM public.instagram_messages
     WHERE ig_message_id = p_ig_message_id
  ) INTO v_message_existed;

  IF v_message_existed THEN
    RETURN jsonb_build_object(
      'ok',      true,
      'skipped', true,
      'reason',  'duplicate_message'
    );
  END IF;

  -- 3. Tentar vincular lead existente via lead_social_profiles
  SELECT lsp.lead_id
    INTO v_lead_id
    FROM public.lead_social_profiles lsp
   WHERE lsp.company_id       = v_connection.company_id
     AND lsp.provider         = 'instagram'
     AND lsp.provider_user_id = p_participant_ig_user_id
   LIMIT 1;

  -- 4. Upsert da conversa
  --    ON CONFLICT: atualiza metadados e incrementa unread apenas para inbound
  INSERT INTO public.instagram_conversations (
    company_id,
    connection_id,
    ig_thread_id,
    ig_participant_id,
    participant_name,
    participant_username,
    lead_id,
    status,
    unread_count,
    last_message_at,
    last_message_preview,
    created_at,
    updated_at
  )
  VALUES (
    v_connection.company_id,
    v_connection.id,
    p_ig_thread_id,
    p_participant_ig_user_id,
    p_participant_name,
    p_participant_username,
    v_lead_id,
    'active',
    CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
    p_timestamp,
    LEFT(COALESCE(p_content, '[mídia]'), 100),
    now(),
    now()
  )
  ON CONFLICT (company_id, ig_thread_id) DO UPDATE SET
    updated_at            = now(),
    last_message_at       = p_timestamp,
    last_message_preview  = LEFT(COALESCE(p_content, '[mídia]'), 100),
    -- Incrementa unread apenas para mensagens inbound
    unread_count          = CASE
                              WHEN p_direction = 'inbound'
                              THEN instagram_conversations.unread_count + 1
                              ELSE instagram_conversations.unread_count
                            END,
    -- Atualiza nome/username do participante se informados
    participant_name      = COALESCE(EXCLUDED.participant_name, instagram_conversations.participant_name),
    participant_username  = COALESCE(EXCLUDED.participant_username, instagram_conversations.participant_username),
    -- Vincula lead se ainda não estava vinculado
    lead_id               = COALESCE(instagram_conversations.lead_id, EXCLUDED.lead_id)
  RETURNING id INTO v_conversation_id;

  -- 5. Inserir mensagem (ON CONFLICT DO NOTHING — idempotência secundária)
  INSERT INTO public.instagram_messages (
    conversation_id,
    company_id,
    ig_message_id,
    direction,
    message_type,
    content,
    media_url,
    status,
    timestamp,
    created_at,
    updated_at
  )
  VALUES (
    v_conversation_id,
    v_connection.company_id,
    p_ig_message_id,
    p_direction,
    p_message_type,
    p_content,
    p_media_url,
    'sent',
    p_timestamp,
    now(),
    now()
  )
  ON CONFLICT (ig_message_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok',              true,
    'skipped',         false,
    'company_id',      v_connection.company_id,
    'connection_id',   v_connection.id,
    'conversation_id', v_conversation_id,
    'lead_id',         v_lead_id
  );
END;
$$;

-- Callable apenas por service_role (backend de webhook)
REVOKE EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
