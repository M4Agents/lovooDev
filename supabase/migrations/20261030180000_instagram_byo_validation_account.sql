-- Instagram BYO — validação do SUAT e associação da conta.
-- Não executa nesta fase. Não altera a conexão oficial nem o webhook oficial.
--
-- Rollback, ainda não executado:
--   DROP FUNCTION public.instagram_byo_associate_account(uuid, uuid, uuid, integer, text, text, text, text, text[]);
--   DROP FUNCTION public.instagram_byo_record_validation(uuid, uuid, uuid, integer, text, text, text);

ALTER TABLE public.instagram_byo_credential_events
  DROP CONSTRAINT chk_ig_byo_evt_operation;

ALTER TABLE public.instagram_byo_credential_events
  ADD CONSTRAINT chk_ig_byo_evt_operation
  CHECK (operation IN (
    'set',
    'replace_app',
    'rotate_secret',
    'rotate_suat',
    'revoke',
    'validate',
    'associate_account'
  ));

ALTER TABLE public.instagram_byo_credential_events
  DROP CONSTRAINT chk_ig_byo_evt_action;

ALTER TABLE public.instagram_byo_credential_events
  ADD CONSTRAINT chk_ig_byo_evt_action
  CHECK (action IN (
    'credentials_set',
    'app_id_replaced',
    'secret_rotated',
    'suat_rotated',
    'validation_failed',
    'validated',
    'enabled',
    'disabled',
    'revoked',
    'account_associated'
  ));

ALTER TABLE public.instagram_byo_poc_accounts
  DROP CONSTRAINT chk_ig_byo_poc_status_reason;

ALTER TABLE public.instagram_byo_poc_accounts
  ADD CONSTRAINT chk_ig_byo_poc_status_reason
  CHECK (
    status_reason IS NULL
    OR status_reason IN ('credentials_replaced', 'credentials_revoked', 'validation_reset')
  );

CREATE OR REPLACE FUNCTION public.instagram_byo_record_validation(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_request_fingerprint text,
  p_next_status text,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $ig_byo_record_validation$
DECLARE
  v_deleted_at timestamptz;
  v_event_operation text;
  v_event_fingerprint text;
  v_stored_status text;
  v_stored_version integer;
  v_stored_configured boolean;
  v_live_version integer;
  v_status text;
  v_version integer;
  v_new_version integer;
  v_constraint text;
BEGIN
  IF p_company_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_expected_version IS NULL
     OR p_expected_version < 1
     OR p_request_fingerprint !~ '^s1:[0-9a-f]{64}$'
     OR p_next_status NOT IN ('valid', 'failed')
     OR (p_next_status = 'valid' AND p_error_code IS NOT NULL)
     OR (
       p_next_status = 'failed'
       AND (p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$')
     )
  THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  SELECT company.deleted_at
    INTO v_deleted_at
    FROM public.companies AS company
   WHERE company.id = p_company_id
     FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT event.operation,
         event.request_fingerprint,
         event.result_validation_status,
         event.result_credential_version,
         event.result_configured
    INTO v_event_operation,
         v_event_fingerprint,
         v_stored_status,
         v_stored_version,
         v_stored_configured
    FROM public.instagram_byo_credential_events AS event
   WHERE event.company_id = p_company_id
     AND event.request_id = p_request_id;

  IF FOUND THEN
    IF v_event_operation <> 'validate' OR v_event_fingerprint <> p_request_fingerprint THEN
      RETURN jsonb_build_object('result', 'request_reused');
    END IF;
    SELECT credential.credential_version
      INTO v_live_version
      FROM public.instagram_byo_company_credentials AS credential
     WHERE credential.company_id = p_company_id;
    RETURN jsonb_build_object(
      'result', 'idempotent',
      'validation_status', v_stored_status,
      'credential_version', v_stored_version,
      'configured', v_stored_configured,
      'stale', v_live_version IS DISTINCT FROM v_stored_version,
      'validation_error_code', CASE WHEN v_stored_status = 'failed' THEN p_error_code ELSE NULL END
    );
  END IF;

  SELECT credential.validation_status, credential.credential_version
    INTO v_status, v_version
    FROM public.instagram_byo_company_credentials AS credential
   WHERE credential.company_id = p_company_id
     FOR UPDATE;

  IF NOT FOUND
     OR v_status = 'revoked'
     OR v_status NOT IN ('saved', 'pending', 'valid', 'failed')
     OR v_version IS DISTINCT FROM p_expected_version
  THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  UPDATE public.instagram_byo_company_credentials AS credential
     SET validation_status = p_next_status,
         validation_error_code = p_error_code,
         validated_at = CASE WHEN p_next_status = 'valid' THEN now() ELSE NULL END,
         credential_version = credential.credential_version + 1
   WHERE credential.company_id = p_company_id
     AND credential.credential_version = p_expected_version
     AND credential.validation_status = v_status
  RETURNING credential.credential_version
    INTO v_new_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  UPDATE public.instagram_byo_poc_accounts AS account
     SET status = 'poc_disabled',
         access_token_enc = NULL,
         scopes = '{}'::text[],
         status_reason = 'validation_reset'
   WHERE account.company_id = p_company_id;

  INSERT INTO public.instagram_byo_credential_events (
    company_id,
    actor_user_id,
    action,
    metadata,
    request_id,
    operation,
    request_fingerprint,
    result_validation_status,
    result_credential_version,
    result_configured
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    CASE WHEN p_next_status = 'valid' THEN 'validated' ELSE 'validation_failed' END,
    jsonb_build_object('previous_status', v_status, 'next_status', p_next_status),
    p_request_id,
    'validate',
    p_request_fingerprint,
    p_next_status,
    v_new_version,
    true
  );

  RETURN jsonb_build_object(
    'result', 'applied',
    'validation_status', p_next_status,
    'credential_version', v_new_version,
    'configured', true,
    'stale', false,
    'validation_error_code', p_error_code
  );
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'uq_ig_byo_evt_company_request' THEN
      RETURN jsonb_build_object('result', 'request_reused');
    END IF;
    RETURN jsonb_build_object('result', 'conflict');
  WHEN check_violation OR foreign_key_violation THEN
    RETURN jsonb_build_object('result', 'rejected');
  WHEN insufficient_privilege OR deadlock_detected OR serialization_failure OR query_canceled THEN
    RETURN jsonb_build_object('result', 'unavailable');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('result', 'unavailable');
END;
$ig_byo_record_validation$;

CREATE OR REPLACE FUNCTION public.instagram_byo_associate_account(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_request_fingerprint text,
  p_instagram_account_id text,
  p_instagram_username text,
  p_system_user_id text,
  p_scopes text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $ig_byo_associate_account$
DECLARE
  v_deleted_at timestamptz;
  v_event_operation text;
  v_event_fingerprint text;
  v_stored_status text;
  v_stored_version integer;
  v_stored_configured boolean;
  v_live_version integer;
  v_status text;
  v_version integer;
  v_new_version integer;
  v_constraint text;
BEGIN
  IF p_company_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_expected_version IS NULL
     OR p_expected_version < 1
     OR p_request_fingerprint !~ '^s1:[0-9a-f]{64}$'
     OR p_instagram_account_id !~ '^[0-9]{5,32}$'
     OR p_system_user_id !~ '^[0-9]{5,32}$'
     OR (
       p_instagram_username IS NOT NULL
       AND p_instagram_username !~ '^[A-Za-z0-9._]{1,30}$'
     )
     OR p_scopes IS NULL
     OR NOT public.instagram_byo_scopes_allowed(p_scopes)
  THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  SELECT company.deleted_at
    INTO v_deleted_at
    FROM public.companies AS company
   WHERE company.id = p_company_id
     FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT event.operation,
         event.request_fingerprint,
         event.result_validation_status,
         event.result_credential_version,
         event.result_configured
    INTO v_event_operation,
         v_event_fingerprint,
         v_stored_status,
         v_stored_version,
         v_stored_configured
    FROM public.instagram_byo_credential_events AS event
   WHERE event.company_id = p_company_id
     AND event.request_id = p_request_id;

  IF FOUND THEN
    IF v_event_operation <> 'associate_account'
       OR v_event_fingerprint <> p_request_fingerprint
    THEN
      RETURN jsonb_build_object('result', 'request_reused');
    END IF;
    SELECT credential.credential_version
      INTO v_live_version
      FROM public.instagram_byo_company_credentials AS credential
     WHERE credential.company_id = p_company_id;
    RETURN jsonb_build_object(
      'result', 'idempotent',
      'validation_status', v_stored_status,
      'credential_version', v_stored_version,
      'configured', v_stored_configured,
      'stale', v_live_version IS DISTINCT FROM v_stored_version
    );
  END IF;

  SELECT credential.validation_status, credential.credential_version
    INTO v_status, v_version
    FROM public.instagram_byo_company_credentials AS credential
   WHERE credential.company_id = p_company_id
     FOR UPDATE;

  IF NOT FOUND
     OR v_status <> 'valid'
     OR v_version IS DISTINCT FROM p_expected_version
  THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  UPDATE public.instagram_byo_company_credentials AS credential
     SET credential_version = credential.credential_version + 1
   WHERE credential.company_id = p_company_id
     AND credential.credential_version = p_expected_version
     AND credential.validation_status = 'valid'
  RETURNING credential.credential_version
    INTO v_new_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  UPDATE public.instagram_byo_poc_accounts AS account
     SET status = 'poc_disabled',
         access_token_enc = NULL,
         scopes = '{}'::text[],
         status_reason = 'validation_reset'
   WHERE account.company_id = p_company_id
     AND account.instagram_account_id <> p_instagram_account_id;

  INSERT INTO public.instagram_byo_poc_accounts (
    company_id,
    instagram_account_id,
    system_user_id,
    instagram_username,
    access_token_enc,
    encryption_version,
    scopes,
    status,
    status_reason
  ) VALUES (
    p_company_id,
    p_instagram_account_id,
    p_system_user_id,
    p_instagram_username,
    NULL,
    1,
    p_scopes,
    'poc_disabled',
    NULL
  )
  ON CONFLICT (company_id, instagram_account_id) DO UPDATE
    SET system_user_id = EXCLUDED.system_user_id,
        instagram_username = EXCLUDED.instagram_username,
        access_token_enc = NULL,
        scopes = EXCLUDED.scopes,
        status = 'poc_disabled',
        status_reason = NULL;

  INSERT INTO public.instagram_byo_credential_events (
    company_id,
    actor_user_id,
    action,
    metadata,
    request_id,
    operation,
    request_fingerprint,
    result_validation_status,
    result_credential_version,
    result_configured
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    'account_associated',
    jsonb_build_object('previous_status', 'valid', 'next_status', 'valid'),
    p_request_id,
    'associate_account',
    p_request_fingerprint,
    'valid',
    v_new_version,
    true
  );

  RETURN jsonb_build_object(
    'result', 'applied',
    'validation_status', 'valid',
    'credential_version', v_new_version,
    'configured', true,
    'stale', false
  );
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'uq_ig_byo_evt_company_request' THEN
      RETURN jsonb_build_object('result', 'request_reused');
    END IF;
    RETURN jsonb_build_object('result', 'conflict');
  WHEN check_violation OR foreign_key_violation THEN
    RETURN jsonb_build_object('result', 'rejected');
  WHEN insufficient_privilege OR deadlock_detected OR serialization_failure OR query_canceled THEN
    RETURN jsonb_build_object('result', 'unavailable');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('result', 'unavailable');
END;
$ig_byo_associate_account$;

REVOKE ALL ON FUNCTION public.instagram_byo_record_validation(uuid, uuid, uuid, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instagram_byo_record_validation(uuid, uuid, uuid, integer, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.instagram_byo_record_validation(uuid, uuid, uuid, integer, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_byo_record_validation(uuid, uuid, uuid, integer, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.instagram_byo_associate_account(uuid, uuid, uuid, integer, text, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instagram_byo_associate_account(uuid, uuid, uuid, integer, text, text, text, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.instagram_byo_associate_account(uuid, uuid, uuid, integer, text, text, text, text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_byo_associate_account(uuid, uuid, uuid, integer, text, text, text, text, text[]) TO service_role;
