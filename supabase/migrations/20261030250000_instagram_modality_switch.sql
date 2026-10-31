-- =============================================================================
-- Modalidade operacional Instagram: official ou byo, por empresa e conta.
--
-- Sem registro nesta tabela, o recebimento oficial permanece o caminho legado.
-- A troca de dono das conversas só ocorre em switch_instagram_account_modality.
-- Esta migration não altera credenciais, não revoga conexão oficial e não liga
-- a ingestão de contas existentes.
-- =============================================================================

ALTER TABLE public.instagram_connections
  ADD CONSTRAINT uq_igconn_id_company UNIQUE (id, company_id);

CREATE TABLE public.instagram_account_operations (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instagram_account_id   TEXT        NOT NULL,
  mode                   TEXT        NOT NULL,
  official_connection_id UUID,
  byo_account_id         UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_ig_account_operation
    UNIQUE (company_id, instagram_account_id),
  CONSTRAINT chk_ig_account_operation_id
    CHECK (instagram_account_id ~ '^[0-9]{5,32}$'),
  CONSTRAINT chk_ig_account_operation_mode
    CHECK (mode IN ('official', 'byo')),
  CONSTRAINT chk_ig_account_operation_owner CHECK (
    (
      mode = 'official'
      AND official_connection_id IS NOT NULL
      AND byo_account_id IS NULL
    )
    OR (
      mode = 'byo'
      AND byo_account_id IS NOT NULL
      AND official_connection_id IS NULL
    )
  ),
  CONSTRAINT fk_igop_official_company
    FOREIGN KEY (official_connection_id, company_id)
    REFERENCES public.instagram_connections (id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_igop_byo_company
    FOREIGN KEY (byo_account_id, company_id)
    REFERENCES public.instagram_byo_poc_accounts (id, company_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_igop_official
  ON public.instagram_account_operations (official_connection_id)
  WHERE official_connection_id IS NOT NULL;

CREATE INDEX idx_igop_byo
  ON public.instagram_account_operations (byo_account_id)
  WHERE byo_account_id IS NOT NULL;

CREATE TRIGGER set_instagram_account_operations_updated_at
  BEFORE UPDATE ON public.instagram_account_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.instagram_account_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instagram_account_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.instagram_account_operations FROM anon;
REVOKE ALL ON TABLE public.instagram_account_operations FROM authenticated;
REVOKE ALL ON TABLE public.instagram_account_operations FROM service_role;

-- ── Recebimento oficial ──────────────────────────────────────────────────────

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
  v_connection           public.instagram_connections%ROWTYPE;
  v_conversation_id      UUID;
  v_lead_id              INTEGER;
  v_message_id           UUID;
  v_created              BOOLEAN := false;
  v_existing_connection  UUID;
  v_existing_byo         UUID;
  v_lock_keys            TEXT[];
  v_fresh_keys           TEXT[];
  v_lock_key             TEXT;
  v_pass                 INTEGER;
  v_mode                 TEXT;
  v_mode_connection      UUID;
  v_mode_count           INTEGER;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_lock_keys := ARRAY[]::text[];
  FOR v_pass IN 1..2 LOOP
    SELECT coalesce(array_agg(keys.key ORDER BY keys.key), ARRAY[]::text[])
      INTO v_fresh_keys
      FROM (
        SELECT DISTINCT candidate.key
          FROM (
            SELECT p_instagram_user_id AS key
            UNION ALL
            SELECT connection.instagram_user_id
              FROM public.instagram_connections AS connection
             WHERE connection.status = 'active'
               AND (
                 connection.instagram_user_id = p_instagram_user_id
                 OR connection.ig_webhook_id = p_instagram_user_id
               )
            UNION ALL
            SELECT connection.ig_webhook_id
              FROM public.instagram_connections AS connection
             WHERE connection.status = 'active'
               AND (
                 connection.instagram_user_id = p_instagram_user_id
                 OR connection.ig_webhook_id = p_instagram_user_id
               )
          ) AS candidate
         WHERE candidate.key IS NOT NULL
           AND btrim(candidate.key) <> ''
      ) AS keys;
    v_fresh_keys := coalesce(v_fresh_keys, ARRAY[]::text[]);

    IF v_pass = 2 THEN
      IF v_fresh_keys IS DISTINCT FROM v_lock_keys THEN
        RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ambiguous_instagram_account');
      END IF;
      EXIT;
    END IF;

    v_lock_keys := v_fresh_keys;
    FOREACH v_lock_key IN ARRAY v_lock_keys LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 361362));
    END LOOP;
  END LOOP;

  BEGIN
    SELECT *
      INTO STRICT v_connection
      FROM public.instagram_connections
     WHERE status = 'active'
       AND (
         instagram_user_id = p_instagram_user_id
         OR ig_webhook_id = p_instagram_user_id
       )
       FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'connection_not_found',
        'detail', format('Nenhuma conexão ativa para instagram_user_id = %s', p_instagram_user_id)
      );
    WHEN TOO_MANY_ROWS THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ambiguous_instagram_account');
  END;

  SELECT count(*)::integer
    INTO v_mode_count
    FROM public.instagram_account_operations AS operation
   WHERE operation.company_id = v_connection.company_id
     AND (
       operation.instagram_account_id = v_connection.instagram_user_id
       OR (
         v_connection.ig_webhook_id IS NOT NULL
         AND operation.instagram_account_id = v_connection.ig_webhook_id
       )
       OR operation.instagram_account_id = p_instagram_user_id
     );

  IF v_mode_count > 1 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ambiguous_instagram_account');
  END IF;

  IF v_mode_count = 1 THEN
    SELECT operation.mode, operation.official_connection_id
      INTO v_mode, v_mode_connection
      FROM public.instagram_account_operations AS operation
     WHERE operation.company_id = v_connection.company_id
       AND (
         operation.instagram_account_id = v_connection.instagram_user_id
         OR (
           v_connection.ig_webhook_id IS NOT NULL
           AND operation.instagram_account_id = v_connection.ig_webhook_id
         )
         OR operation.instagram_account_id = p_instagram_user_id
       );

    IF v_mode = 'byo' THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'mode_byo');
    END IF;

    IF v_mode IS DISTINCT FROM 'official'
       OR v_mode_connection IS DISTINCT FROM v_connection.id THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'mode_conflict');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.instagram_messages
     WHERE ig_message_id = p_ig_message_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate_message');
  END IF;

  SELECT lsp.lead_id
    INTO v_lead_id
    FROM public.lead_social_profiles AS lsp
   WHERE lsp.company_id = v_connection.company_id
     AND lsp.provider = 'instagram'
     AND lsp.provider_user_id = p_participant_ig_user_id
   LIMIT 1;

  SELECT conversation.id, conversation.connection_id, conversation.byo_account_id
    INTO v_conversation_id, v_existing_connection, v_existing_byo
    FROM public.instagram_conversations AS conversation
   WHERE conversation.company_id = v_connection.company_id
     AND conversation.ig_thread_id = p_ig_thread_id
     FOR UPDATE;

  IF FOUND AND (
    v_existing_byo IS NOT NULL
    OR v_existing_connection IS DISTINCT FROM v_connection.id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'conversation_owner_conflict');
  END IF;

  IF NOT FOUND THEN
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
      0, NULL, NULL, now(), now()
    )
    ON CONFLICT (company_id, ig_thread_id) DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT conversation.id, conversation.connection_id, conversation.byo_account_id
        INTO v_conversation_id, v_existing_connection, v_existing_byo
        FROM public.instagram_conversations AS conversation
       WHERE conversation.company_id = v_connection.company_id
         AND conversation.ig_thread_id = p_ig_thread_id
         FOR UPDATE;

      IF NOT FOUND
         OR v_existing_byo IS NOT NULL
         OR v_existing_connection IS DISTINCT FROM v_connection.id THEN
        RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'conversation_owner_conflict');
      END IF;
    ELSE
      v_created := true;
    END IF;
  END IF;

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
  ON CONFLICT (ig_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    IF v_created THEN
      DELETE FROM public.instagram_conversations AS conversation
       WHERE conversation.id = v_conversation_id
         AND conversation.company_id = v_connection.company_id
         AND conversation.connection_id = v_connection.id
         AND conversation.byo_account_id IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.instagram_messages AS message
            WHERE message.conversation_id = v_conversation_id
         );
    END IF;
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate_message');
  END IF;

  UPDATE public.instagram_conversations AS conversation
     SET last_message_at = p_timestamp,
         last_message_preview = left(coalesce(p_content, '[mídia]'), 100),
         unread_count = CASE
           WHEN p_direction = 'inbound' THEN conversation.unread_count + 1
           ELSE conversation.unread_count
         END,
         participant_name = coalesce(p_participant_name, conversation.participant_name),
         participant_username = coalesce(p_participant_username, conversation.participant_username),
         lead_id = coalesce(conversation.lead_id, v_lead_id),
         updated_at = now()
   WHERE conversation.id = v_conversation_id
     AND conversation.company_id = v_connection.company_id
     AND conversation.connection_id = v_connection.id
     AND conversation.byo_account_id IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'company_id', v_connection.company_id,
    'connection_id', v_connection.id,
    'conversation_id', v_conversation_id,
    'lead_id', v_lead_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_instagram_dm_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;

-- ── Recebimento BYO ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_instagram_byo_dm_webhook(
  p_company_id uuid,
  p_byo_account_id uuid,
  p_instagram_account_id text,
  p_ig_message_id text,
  p_ig_thread_id text,
  p_participant_ig_user_id text,
  p_direction text,
  p_message_type text,
  p_content text DEFAULT NULL,
  p_media_url text DEFAULT NULL,
  p_timestamp timestamptz DEFAULT NULL,
  p_reply_to_ig_message_id text DEFAULT NULL,
  p_reply_to_content text DEFAULT NULL,
  p_reply_to_direction text DEFAULT NULL,
  p_participant_name text DEFAULT NULL,
  p_participant_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_status text;
  v_deleted_at timestamptz;
  v_account public.instagram_byo_poc_accounts%ROWTYPE;
  v_live_count integer;
  v_live_is_ours boolean;
  v_official_count integer;
  v_mode text;
  v_mode_byo uuid;
  v_mode_count integer;
  v_credential_status text;
  v_webhook_enabled boolean;
  v_route_id text;
  v_verify_hash text;
  v_secret text;
  v_reply_direction text;
  v_conversation_id uuid;
  v_connection_id uuid;
  v_owner_byo uuid;
  v_created boolean := false;
  v_lead_id integer;
  v_message_id uuid;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL OR p_byo_account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'rejected');
  END IF;

  SELECT company.status, company.deleted_at
    INTO v_company_status, v_deleted_at
    FROM public.companies AS company
   WHERE company.id = p_company_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_mismatch');
  END IF;

  SELECT account.*
    INTO v_account
    FROM public.instagram_byo_poc_accounts AS account
   WHERE account.id = p_byo_account_id
     AND account.company_id = p_company_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_mismatch');
  END IF;

  IF p_instagram_account_id IS NULL
     OR p_instagram_account_id !~ '^[0-9]{5,32}$'
     OR v_account.instagram_account_id IS DISTINCT FROM p_instagram_account_id
     OR p_ig_thread_id IS NULL
     OR p_participant_ig_user_id IS NULL
     OR p_ig_thread_id <> p_participant_ig_user_id
     OR char_length(p_ig_thread_id) NOT BETWEEN 1 AND 64
     OR p_ig_message_id IS NULL
     OR char_length(btrim(p_ig_message_id)) NOT BETWEEN 1 AND 256
  THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'rejected');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_account.instagram_account_id, 361362));

  SELECT count(*)::integer,
         coalesce(bool_or(account.id = p_byo_account_id), false)
    INTO v_live_count, v_live_is_ours
    FROM public.instagram_byo_poc_accounts AS account
   WHERE account.instagram_account_id = v_account.instagram_account_id
     AND account.status_reason IS NULL;

  IF v_live_count > 1 OR (v_live_count = 1 AND NOT v_live_is_ours) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ambiguous_byo_account');
  END IF;

  SELECT count(*)::integer
    INTO v_mode_count
    FROM public.instagram_account_operations AS operation
   WHERE operation.company_id = p_company_id
     AND operation.instagram_account_id = v_account.instagram_account_id;

  IF v_mode_count > 1 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ambiguous_instagram_account');
  END IF;

  SELECT operation.mode, operation.byo_account_id
    INTO v_mode, v_mode_byo
    FROM public.instagram_account_operations AS operation
   WHERE operation.company_id = p_company_id
     AND operation.instagram_account_id = v_account.instagram_account_id;

  IF FOUND AND v_mode = 'official' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'mode_official');
  END IF;

  IF FOUND AND (
    v_mode IS DISTINCT FROM 'byo'
    OR v_mode_byo IS DISTINCT FROM p_byo_account_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'mode_conflict');
  END IF;

  IF NOT FOUND THEN
    SELECT count(*)::integer
      INTO v_official_count
      FROM public.instagram_connections AS connection
     WHERE connection.status = 'active'
       AND (
         connection.instagram_user_id = v_account.instagram_account_id
         OR connection.ig_webhook_id = v_account.instagram_account_id
       );

    IF v_official_count > 0 THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'official_priority');
    END IF;

    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'mode_required');
  END IF;

  IF v_account.direct_ingest_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'direct_ingest_disabled');
  END IF;

  IF v_account.status IS DISTINCT FROM 'poc_disabled'
     OR v_account.status_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'direct_ingest_disabled');
  END IF;

  SELECT credential.validation_status,
         credential.webhook_enabled,
         credential.webhook_route_id,
         credential.webhook_verify_token_hash,
         credential.app_secret_enc
    INTO v_credential_status, v_webhook_enabled, v_route_id, v_verify_hash, v_secret
    FROM public.instagram_byo_company_credentials AS credential
   WHERE credential.company_id = p_company_id;

  IF NOT FOUND
     OR v_credential_status IS DISTINCT FROM 'valid'
     OR v_secret IS NULL
     OR char_length(v_secret) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'invalid_credential');
  END IF;

  IF v_webhook_enabled IS NOT TRUE
     OR v_route_id IS NULL
     OR v_verify_hash IS NULL
     OR v_route_id !~ '^[0-9a-f]{64}$'
     OR v_verify_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'webhook_disabled');
  END IF;

  IF v_company_status IS DISTINCT FROM 'active' OR v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_inactive');
  END IF;

  v_reply_direction := CASE
    WHEN p_reply_to_direction IN ('inbound', 'outbound') THEN p_reply_to_direction
    ELSE NULL
  END;

  IF p_direction NOT IN ('inbound', 'outbound')
     OR p_message_type NOT IN ('text', 'image', 'video', 'audio', 'storyReply', 'unsupported')
     OR p_timestamp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'rejected');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.instagram_messages AS message
     WHERE message.ig_message_id = p_ig_message_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate_message');
  END IF;

  SELECT conversation.id, conversation.connection_id, conversation.byo_account_id
    INTO v_conversation_id, v_connection_id, v_owner_byo
    FROM public.instagram_conversations AS conversation
   WHERE conversation.company_id = p_company_id
     AND conversation.ig_thread_id = p_ig_thread_id
     FOR UPDATE;

  IF FOUND AND (
    v_connection_id IS NOT NULL
    OR v_owner_byo IS DISTINCT FROM p_byo_account_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'conversation_owner_conflict');
  END IF;

  IF NOT FOUND THEN
    SELECT lsp.lead_id
      INTO v_lead_id
      FROM public.lead_social_profiles AS lsp
     WHERE lsp.company_id = p_company_id
       AND lsp.provider = 'instagram'
       AND lsp.provider_user_id = p_participant_ig_user_id
     LIMIT 1;

    INSERT INTO public.instagram_conversations (
      company_id, connection_id, byo_account_id, ig_thread_id, ig_participant_id,
      participant_name, participant_username, lead_id, status, unread_count,
      last_message_at, last_message_preview, ai_state, created_at, updated_at
    )
    VALUES (
      p_company_id, NULL, p_byo_account_id, p_ig_thread_id, p_participant_ig_user_id,
      p_participant_name, p_participant_username, v_lead_id, 'active', 0,
      NULL, NULL, 'ai_off', now(), now()
    )
    ON CONFLICT (company_id, ig_thread_id) DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT conversation.id, conversation.connection_id, conversation.byo_account_id
        INTO v_conversation_id, v_connection_id, v_owner_byo
        FROM public.instagram_conversations AS conversation
       WHERE conversation.company_id = p_company_id
         AND conversation.ig_thread_id = p_ig_thread_id
         FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'rejected');
      END IF;

      IF v_connection_id IS NOT NULL OR v_owner_byo IS DISTINCT FROM p_byo_account_id THEN
        RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'conversation_owner_conflict');
      END IF;
    ELSE
      v_created := true;
    END IF;
  END IF;

  INSERT INTO public.instagram_messages (
    conversation_id, company_id, ig_message_id,
    direction, message_type, content, media_url, status,
    reply_to_ig_message_id, reply_to_content, reply_to_direction,
    timestamp, created_at, updated_at
  )
  VALUES (
    v_conversation_id, p_company_id, p_ig_message_id,
    p_direction, p_message_type, p_content, p_media_url, 'sent',
    p_reply_to_ig_message_id, p_reply_to_content, v_reply_direction,
    p_timestamp, now(), now()
  )
  ON CONFLICT (ig_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    IF v_created THEN
      DELETE FROM public.instagram_conversations AS conversation
       WHERE conversation.id = v_conversation_id
         AND conversation.company_id = p_company_id
         AND conversation.byo_account_id = p_byo_account_id
         AND conversation.connection_id IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.instagram_messages AS message
            WHERE message.conversation_id = v_conversation_id
         );
    END IF;
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate_message');
  END IF;

  UPDATE public.instagram_conversations AS conversation
     SET last_message_at = p_timestamp,
         last_message_preview = left(coalesce(p_content, '[mídia]'), 100),
         unread_count = CASE
           WHEN p_direction = 'inbound' THEN conversation.unread_count + 1
           ELSE conversation.unread_count
         END,
         participant_name = coalesce(conversation.participant_name, p_participant_name),
         participant_username = coalesce(conversation.participant_username, p_participant_username),
         updated_at = now()
   WHERE conversation.id = v_conversation_id
     AND conversation.company_id = p_company_id
     AND conversation.byo_account_id = p_byo_account_id
     AND conversation.connection_id IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'reason', 'persisted',
    'conversation_id', v_conversation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.process_instagram_byo_dm_webhook(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text
) TO service_role;

-- ── Troca explícita de modalidade ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.switch_instagram_account_modality(
  p_company_id uuid,
  p_actor_id uuid,
  p_instagram_account_id text,
  p_target_mode text,
  p_official_connection_id uuid,
  p_byo_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_count integer;
  v_admin_count integer;
  v_company_status text;
  v_deleted_at timestamptz;
  v_connection public.instagram_connections%ROWTYPE;
  v_account public.instagram_byo_poc_accounts%ROWTYPE;
  v_connection_matches integer;
  v_account_span integer;
  v_byo_ready boolean;
  v_current_mode text;
  v_current_official uuid;
  v_current_byo uuid;
  v_source_count integer;
  v_moved integer;
  v_flag_rows integer;
  v_flag_now boolean;
  v_applied boolean;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL
     OR p_actor_id IS NULL
     OR p_official_connection_id IS NULL
     OR p_byo_account_id IS NULL
     OR p_target_mode NOT IN ('official', 'byo')
     OR p_instagram_account_id IS NULL
     OR p_instagram_account_id !~ '^[0-9]{5,32}$'
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rejected');
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE membership.role IN ('super_admin', 'system_admin', 'admin')
         )::integer
    INTO v_role_count, v_admin_count
    FROM public.company_users AS membership
   WHERE membership.user_id = p_actor_id
     AND membership.company_id = p_company_id
     AND membership.is_active IS TRUE;

  IF v_role_count IS DISTINCT FROM 1 OR v_admin_count IS DISTINCT FROM 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT company.status, company.deleted_at
    INTO v_company_status, v_deleted_at
    FROM public.companies AS company
   WHERE company.id = p_company_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'company_mismatch');
  END IF;

  IF v_company_status IS DISTINCT FROM 'active' OR v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'company_inactive');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_instagram_account_id, 361362)
  );

  SELECT connection.*
    INTO v_connection
    FROM public.instagram_connections AS connection
   WHERE connection.id = p_official_connection_id
     AND connection.company_id = p_company_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'company_mismatch');
  END IF;

  SELECT account.*
    INTO v_account
    FROM public.instagram_byo_poc_accounts AS account
   WHERE account.id = p_byo_account_id
     AND account.company_id = p_company_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'company_mismatch');
  END IF;

  IF v_account.instagram_account_id IS DISTINCT FROM p_instagram_account_id
     OR (
       v_connection.instagram_user_id IS DISTINCT FROM p_instagram_account_id
       AND v_connection.ig_webhook_id IS DISTINCT FROM p_instagram_account_id
     )
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'identity_mismatch');
  END IF;

  SELECT count(*)::integer
    INTO v_connection_matches
    FROM public.instagram_connections AS connection
   WHERE connection.company_id = p_company_id
     AND (
       connection.instagram_user_id = p_instagram_account_id
       OR connection.ig_webhook_id = p_instagram_account_id
     );

  IF v_connection_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'identity_mismatch');
  END IF;

  IF v_connection_matches > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_instagram_account');
  END IF;

  SELECT count(DISTINCT account.id)::integer
    INTO v_account_span
    FROM public.instagram_byo_poc_accounts AS account
   WHERE account.company_id = p_company_id
     AND account.status_reason IS NULL
     AND (
       account.instagram_account_id = v_connection.instagram_user_id
       OR account.instagram_account_id = v_connection.ig_webhook_id
     );

  IF v_account_span = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'identity_mismatch');
  END IF;

  IF v_account_span > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_instagram_account');
  END IF;

  SELECT (
    credential.validation_status = 'valid'
    AND credential.webhook_enabled IS TRUE
    AND credential.webhook_route_id ~ '^[0-9a-f]{64}$'
    AND credential.webhook_verify_token_hash ~ '^[0-9a-f]{64}$'
    AND credential.app_secret_enc IS NOT NULL
    AND char_length(credential.app_secret_enc) > 0
    AND credential.suat_enc IS NOT NULL
    AND char_length(credential.suat_enc) > 0
  )
    INTO v_byo_ready
    FROM public.instagram_byo_company_credentials AS credential
   WHERE credential.company_id = p_company_id;

  IF p_target_mode = 'byo'
     AND (
       v_byo_ready IS NOT TRUE
       OR v_account.status IS DISTINCT FROM 'poc_disabled'
       OR v_account.status_reason IS NOT NULL
     )
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'destination_not_ready');
  END IF;

  IF p_target_mode = 'official' AND v_connection.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'destination_not_ready');
  END IF;

  SELECT operation.mode, operation.official_connection_id, operation.byo_account_id
    INTO v_current_mode, v_current_official, v_current_byo
    FROM public.instagram_account_operations AS operation
   WHERE operation.company_id = p_company_id
     AND operation.instagram_account_id = p_instagram_account_id
     FOR UPDATE;

  IF p_target_mode = 'byo' THEN
    SELECT count(*)::integer
      INTO v_source_count
      FROM public.instagram_conversations AS conversation
     WHERE conversation.company_id = p_company_id
       AND conversation.connection_id = p_official_connection_id
       AND conversation.byo_account_id IS NULL;
  ELSE
    SELECT count(*)::integer
      INTO v_source_count
      FROM public.instagram_conversations AS conversation
     WHERE conversation.company_id = p_company_id
       AND conversation.byo_account_id = p_byo_account_id
       AND conversation.connection_id IS NULL;
  END IF;

  v_applied := CASE
    WHEN p_target_mode = 'byo' THEN
      v_current_mode = 'byo'
      AND v_current_byo = p_byo_account_id
      AND v_current_official IS NULL
      AND v_source_count = 0
      AND v_account.direct_ingest_enabled IS TRUE
    ELSE
      v_current_mode = 'official'
      AND v_current_official = p_official_connection_id
      AND v_current_byo IS NULL
      AND v_source_count = 0
      AND v_account.direct_ingest_enabled IS NOT TRUE
  END;

  IF v_applied THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'already_applied',
      'target_mode', p_target_mode,
      'moved_count', 0
    );
  END IF;

  IF p_target_mode = 'byo' THEN
    WITH moved AS (
      UPDATE public.instagram_conversations AS conversation
         SET connection_id = NULL,
             byo_account_id = p_byo_account_id,
             updated_at = now()
       WHERE conversation.company_id = p_company_id
         AND conversation.connection_id = p_official_connection_id
         AND conversation.byo_account_id IS NULL
      RETURNING conversation.id
    )
    SELECT count(*)::integer INTO v_moved FROM moved;
  ELSE
    WITH moved AS (
      UPDATE public.instagram_conversations AS conversation
         SET byo_account_id = NULL,
             connection_id = p_official_connection_id,
             updated_at = now()
       WHERE conversation.company_id = p_company_id
         AND conversation.byo_account_id = p_byo_account_id
         AND conversation.connection_id IS NULL
      RETURNING conversation.id
    )
    SELECT count(*)::integer INTO v_moved FROM moved;
  END IF;

  INSERT INTO public.instagram_account_operations (
    company_id, instagram_account_id, mode, official_connection_id, byo_account_id
  )
  VALUES (
    p_company_id,
    p_instagram_account_id,
    p_target_mode,
    CASE WHEN p_target_mode = 'official' THEN p_official_connection_id ELSE NULL END,
    CASE WHEN p_target_mode = 'byo' THEN p_byo_account_id ELSE NULL END
  )
  ON CONFLICT (company_id, instagram_account_id) DO UPDATE SET
    mode = EXCLUDED.mode,
    official_connection_id = EXCLUDED.official_connection_id,
    byo_account_id = EXCLUDED.byo_account_id,
    updated_at = now();

  UPDATE public.instagram_byo_poc_accounts AS account
     SET direct_ingest_enabled = (p_target_mode = 'byo'),
         updated_at = now()
   WHERE account.id = p_byo_account_id
     AND account.company_id = p_company_id
     AND account.status = 'poc_disabled'
     AND account.status_reason IS NULL;

  GET DIAGNOSTICS v_flag_rows = ROW_COUNT;
  IF v_flag_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'troca de modalidade abortada'
      USING ERRCODE = '40001';
  END IF;

  SELECT account.direct_ingest_enabled
    INTO v_flag_now
    FROM public.instagram_byo_poc_accounts AS account
   WHERE account.id = p_byo_account_id
     AND account.company_id = p_company_id;

  IF v_flag_now IS DISTINCT FROM (p_target_mode = 'byo') THEN
    RAISE EXCEPTION 'troca de modalidade abortada'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.instagram_audit_logs (
    company_id, connection_id, action, performed_by, metadata
  )
  VALUES (
    p_company_id,
    p_official_connection_id,
    'switch_instagram_modality',
    p_actor_id,
    jsonb_build_object(
      'instagram_account_id', p_instagram_account_id,
      'from_mode', v_current_mode,
      'to_mode', p_target_mode,
      'moved_count', v_moved,
      'official_connection_id', p_official_connection_id,
      'byo_account_id', p_byo_account_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'switched',
    'target_mode', p_target_mode,
    'moved_count', v_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.switch_instagram_account_modality(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.switch_instagram_account_modality(
  uuid, uuid, text, text, uuid, uuid
) FROM anon;

REVOKE ALL ON FUNCTION public.switch_instagram_account_modality(
  uuid, uuid, text, text, uuid, uuid
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.switch_instagram_account_modality(
  uuid, uuid, text, text, uuid, uuid
) TO service_role;
