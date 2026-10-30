-- =============================================================================
-- Instagram BYO — flag de ingestão e RPC de Direct
--
-- Adiciona direct_ingest_enabled com default false. Nenhuma linha é ligada.
-- O trigger zera o flag quando a conta deixa de ser elegível, para a
-- revogação e a substituição de credencial não esbarrarem no CHECK.
--
-- A RPC grava só em instagram_conversations e instagram_messages.
-- Não é chamada pelo webhook. A concorrência com o webhook oficial
-- permanece, porque aquele fluxo não usa este advisory lock.
-- =============================================================================

ALTER TABLE public.instagram_byo_poc_accounts
  ADD COLUMN direct_ingest_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.instagram_byo_poc_accounts
  ADD CONSTRAINT chk_ig_byo_poc_direct_ingest
  CHECK (
    direct_ingest_enabled = false
    OR (status = 'poc_disabled' AND status_reason IS NULL)
  );

CREATE OR REPLACE FUNCTION public.instagram_byo_disable_direct_ingest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.status_reason IS NOT NULL
     OR NEW.status IS DISTINCT FROM 'poc_disabled' THEN
    NEW.direct_ingest_enabled := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.instagram_byo_disable_direct_ingest() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instagram_byo_disable_direct_ingest() FROM anon;
REVOKE ALL ON FUNCTION public.instagram_byo_disable_direct_ingest() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_byo_disable_direct_ingest() TO service_role;

CREATE TRIGGER ig_byo_poc_disable_direct_ingest
  BEFORE UPDATE ON public.instagram_byo_poc_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.instagram_byo_disable_direct_ingest();

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

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(v_account.instagram_account_id, 361362));

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
