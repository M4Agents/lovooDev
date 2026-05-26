-- =============================================================================
-- Fix: atualizar lookup de conexão nas RPCs de webhook para suportar ig_webhook_id
--
-- Problema:
--   A Meta retorna dois IDs distintos para contas Instagram novas:
--   - instagram_user_id  → ID do OAuth (/me → id)
--   - ig_webhook_id      → IGBID usado em entry.id dos webhooks (/me → user_id)
--
--   As RPCs resolviam a conexão apenas por instagram_user_id, causando
--   connection_not_found para contas novas onde os IDs diferem.
--
-- Correção:
--   WHERE (instagram_user_id = p_instagram_user_id OR ig_webhook_id = p_instagram_user_id)
--
-- Afeta:
--   - process_instagram_dm_webhook (14 parâmetros — versão atual)
--   - process_instagram_comment_webhook
-- =============================================================================

-- ── 1. process_instagram_dm_webhook ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_instagram_dm_webhook(
  p_instagram_user_id       TEXT,
  p_ig_message_id           TEXT,
  p_ig_thread_id            TEXT,
  p_participant_ig_user_id  TEXT,
  p_participant_name        TEXT        DEFAULT NULL,
  p_participant_username    TEXT        DEFAULT NULL,
  p_direction               TEXT        DEFAULT 'inbound',
  p_message_type            TEXT        DEFAULT 'text',
  p_content                 TEXT        DEFAULT NULL,
  p_media_url               TEXT        DEFAULT NULL,
  p_timestamp               TIMESTAMPTZ DEFAULT now(),
  p_reply_to_ig_message_id  TEXT        DEFAULT NULL,
  p_reply_to_content        TEXT        DEFAULT NULL,
  p_reply_to_direction      TEXT        DEFAULT NULL
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
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Resolver conexão via instagram_user_id ou ig_webhook_id (lookup dual)
  --    ig_webhook_id = IGBID usado pelo webhook (entry.id)
  --    instagram_user_id = ID do OAuth — fallback para contas antigas
  SELECT *
    INTO v_connection
    FROM public.instagram_connections
   WHERE (instagram_user_id = p_instagram_user_id OR ig_webhook_id = p_instagram_user_id)
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'connection_not_found',
      'detail', format('Nenhuma conexão ativa para instagram_user_id = %s', p_instagram_user_id)
    );
  END IF;

  -- 2. Idempotência
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

  -- 3. Tentar vincular lead
  SELECT lsp.lead_id
    INTO v_lead_id
    FROM public.lead_social_profiles lsp
   WHERE lsp.company_id       = v_connection.company_id
     AND lsp.provider         = 'instagram'
     AND lsp.provider_user_id = p_participant_ig_user_id
   LIMIT 1;

  -- 4. Upsert da conversa
  INSERT INTO public.instagram_conversations (
    company_id, connection_id, ig_thread_id, ig_participant_id,
    participant_name, participant_username, lead_id, status,
    unread_count, last_message_at, last_message_preview,
    created_at, updated_at
  )
  VALUES (
    v_connection.company_id, v_connection.id,
    p_ig_thread_id, p_participant_ig_user_id,
    p_participant_name, p_participant_username, v_lead_id, 'active',
    CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
    p_timestamp,
    LEFT(COALESCE(p_content, '[mídia]'), 100),
    now(), now()
  )
  ON CONFLICT (company_id, ig_thread_id) DO UPDATE SET
    updated_at            = now(),
    last_message_at       = p_timestamp,
    last_message_preview  = LEFT(COALESCE(p_content, '[mídia]'), 100),
    unread_count          = CASE
                              WHEN p_direction = 'inbound'
                              THEN instagram_conversations.unread_count + 1
                              ELSE instagram_conversations.unread_count
                            END,
    participant_name      = COALESCE(EXCLUDED.participant_name, instagram_conversations.participant_name),
    participant_username  = COALESCE(EXCLUDED.participant_username, instagram_conversations.participant_username),
    lead_id               = COALESCE(instagram_conversations.lead_id, EXCLUDED.lead_id)
  RETURNING id INTO v_conversation_id;

  -- 5. Inserir mensagem (com reply_to se presente)
  INSERT INTO public.instagram_messages (
    conversation_id, company_id, ig_message_id,
    direction, message_type, content, media_url, status,
    reply_to_ig_message_id, reply_to_content, reply_to_direction,
    timestamp, created_at, updated_at
  )
  VALUES (
    v_conversation_id, v_connection.company_id, p_ig_message_id,
    p_direction, p_message_type, p_content, p_media_url, 'sent',
    p_reply_to_ig_message_id, p_reply_to_content, p_reply_to_direction,
    p_timestamp, now(), now()
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

REVOKE EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;


-- ── 2. process_instagram_comment_webhook ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_instagram_comment_webhook(
  p_instagram_user_id      TEXT,
  p_ig_comment_id          TEXT,
  p_ig_media_id            TEXT,
  p_ig_user_id             TEXT,
  p_content                TEXT,
  p_timestamp              TIMESTAMPTZ,
  p_ig_media_type          TEXT        DEFAULT NULL,
  p_ig_username            TEXT        DEFAULT NULL,
  p_parent_ig_comment_id   TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection        public.instagram_connections%ROWTYPE;
  v_parent_comment_id UUID    := NULL;
  v_lead_id           INTEGER := NULL;
  v_comment_existed   BOOLEAN := false;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Resolver conexão via instagram_user_id ou ig_webhook_id (lookup dual)
  SELECT *
    INTO v_connection
    FROM public.instagram_connections
   WHERE (instagram_user_id = p_instagram_user_id OR ig_webhook_id = p_instagram_user_id)
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'connection_not_found',
      'detail', format('Nenhuma conexão ativa para instagram_user_id = %s', p_instagram_user_id)
    );
  END IF;

  -- 2. Idempotência
  SELECT EXISTS(
    SELECT 1 FROM public.instagram_comments
     WHERE ig_comment_id = p_ig_comment_id
  ) INTO v_comment_existed;

  IF v_comment_existed THEN
    RETURN jsonb_build_object(
      'ok',      true,
      'skipped', true,
      'reason',  'duplicate_comment'
    );
  END IF;

  -- 3. Resolver UUID do comentário pai (se for reply)
  IF p_parent_ig_comment_id IS NOT NULL THEN
    SELECT id
      INTO v_parent_comment_id
      FROM public.instagram_comments
     WHERE ig_comment_id = p_parent_ig_comment_id
       AND company_id    = v_connection.company_id
     LIMIT 1;
  END IF;

  -- 4. Tentar vincular lead existente via lead_social_profiles
  SELECT lsp.lead_id
    INTO v_lead_id
    FROM public.lead_social_profiles lsp
   WHERE lsp.company_id       = v_connection.company_id
     AND lsp.provider         = 'instagram'
     AND lsp.provider_user_id = p_ig_user_id
   LIMIT 1;

  -- 5. Inserir comentário (ON CONFLICT DO NOTHING — idempotência)
  INSERT INTO public.instagram_comments (
    company_id, connection_id, ig_comment_id, ig_media_id,
    ig_media_type, ig_user_id, ig_username, content,
    parent_comment_id, lead_id, status,
    timestamp, created_at, updated_at
  )
  VALUES (
    v_connection.company_id, v_connection.id,
    p_ig_comment_id, p_ig_media_id,
    p_ig_media_type, p_ig_user_id, p_ig_username, p_content,
    v_parent_comment_id, v_lead_id, 'pending',
    p_timestamp, now(), now()
  )
  ON CONFLICT (ig_comment_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok',             true,
    'skipped',        false,
    'company_id',     v_connection.company_id,
    'connection_id',  v_connection.id,
    'lead_id',        v_lead_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_instagram_comment_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_instagram_comment_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
