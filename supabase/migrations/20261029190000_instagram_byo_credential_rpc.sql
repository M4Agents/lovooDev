-- =============================================================================
-- Instagram BYO — RPC transacional de credenciais
--
-- Arquivo local, ainda não aplicado.
-- Versão remota anterior conhecida: 20261029172738
--   (instagram_byo_company_credentials).
-- Aplicar no futuro sozinho, por apply_migration. Sem db push e sem repair.
--
-- Acrescenta idempotência aos eventos, restringe status_reason e scopes das
-- contas BYO e cria public.instagram_byo_apply_credentials.
-- Não altera tabelas oficiais do Instagram e não grava linha de credencial.
--
-- A função é SECURITY INVOKER. O backend autentica, aplica o gate e o RBAC,
-- cifra os segredos e só então envia ciphertext e request_fingerprint.
-- O fingerprint não volta no JSON.
--
-- Rollback, ainda não executado:
--   DROP FUNCTION public.instagram_byo_apply_credentials(
--     uuid, uuid, text, integer, uuid, text, text, text, text, text
--   );
--   ALTER TABLE public.instagram_byo_poc_accounts
--     DROP CONSTRAINT chk_ig_byo_poc_status_reason,
--     DROP CONSTRAINT chk_ig_byo_poc_scopes;
--   DROP FUNCTION public.instagram_byo_scopes_allowed(text[]);
--   ALTER TABLE public.instagram_byo_credential_events
--     DROP CONSTRAINT uq_ig_byo_evt_company_request,
--     DROP CONSTRAINT chk_ig_byo_evt_operation,
--     DROP CONSTRAINT chk_ig_byo_evt_fingerprint,
--     DROP CONSTRAINT chk_ig_byo_evt_result_status,
--     DROP CONSTRAINT chk_ig_byo_evt_result_version,
--     DROP COLUMN request_id,
--     DROP COLUMN operation,
--     DROP COLUMN request_fingerprint,
--     DROP COLUMN result_validation_status,
--     DROP COLUMN result_credential_version,
--     DROP COLUMN result_configured;
-- =============================================================================

DO $byo_preflight$
BEGIN
  IF to_regclass('public.instagram_byo_credential_events') IS NULL
     OR to_regclass('public.instagram_byo_poc_accounts') IS NULL
     OR to_regclass('public.instagram_byo_company_credentials') IS NULL
     OR to_regclass('public.companies') IS NULL
  THEN
    RAISE EXCEPTION 'instagram byo relations are missing';
  END IF;

  IF EXISTS (SELECT 1 FROM public.instagram_byo_credential_events) THEN
    RAISE EXCEPTION 'instagram_byo_credential_events is not empty';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.instagram_byo_poc_accounts AS account
     WHERE (
            account.status_reason IS NOT NULL
        AND account.status_reason NOT IN ('credentials_replaced', 'credentials_revoked')
       )
        OR EXISTS (
          SELECT 1
            FROM unnest(account.scopes) AS scope_item
           WHERE scope_item IS NULL
              OR scope_item !~ '^[a-z0-9_]{1,64}$'
        )
  ) THEN
    RAISE EXCEPTION 'instagram_byo_poc_accounts status fields are incompatible';
  END IF;
END
$byo_preflight$;

ALTER TABLE public.instagram_byo_credential_events
  ADD COLUMN request_id uuid NOT NULL,
  ADD COLUMN operation text NOT NULL,
  ADD COLUMN request_fingerprint text NOT NULL,
  ADD COLUMN result_validation_status text NOT NULL,
  ADD COLUMN result_credential_version integer NOT NULL,
  ADD COLUMN result_configured boolean NOT NULL;

ALTER TABLE public.instagram_byo_credential_events
  ADD CONSTRAINT chk_ig_byo_evt_operation
    CHECK (operation IN ('set', 'replace_app', 'rotate_secret', 'rotate_suat', 'revoke')),
  ADD CONSTRAINT chk_ig_byo_evt_fingerprint
    CHECK (request_fingerprint ~ '^(h1|s1):[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_ig_byo_evt_result_status
    CHECK (result_validation_status IN ('saved', 'pending', 'valid', 'failed', 'revoked')),
  ADD CONSTRAINT chk_ig_byo_evt_result_version
    CHECK (result_credential_version >= 1),
  ADD CONSTRAINT uq_ig_byo_evt_company_request
    UNIQUE (company_id, request_id);

ALTER TABLE public.instagram_byo_poc_accounts
  ADD CONSTRAINT chk_ig_byo_poc_status_reason
    CHECK (
      status_reason IS NULL
      OR status_reason IN ('credentials_replaced', 'credentials_revoked')
    );

CREATE OR REPLACE FUNCTION public.instagram_byo_scopes_allowed(p_scopes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $ig_byo_scopes$
  SELECT p_scopes IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(p_scopes) AS scope_item
        WHERE scope_item IS NULL
           OR scope_item !~ '^[a-z0-9_]{1,64}$'
     );
$ig_byo_scopes$;

ALTER TABLE public.instagram_byo_poc_accounts
  ADD CONSTRAINT chk_ig_byo_poc_scopes
    CHECK (public.instagram_byo_scopes_allowed(scopes));

CREATE OR REPLACE FUNCTION public.instagram_byo_apply_credentials(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_expected_version integer,
  p_request_id uuid,
  p_request_fingerprint text,
  p_meta_app_id text,
  p_app_secret_enc text,
  p_suat_enc text,
  p_origin_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $ig_byo_apply$
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
  v_app_secret_enc text;
  v_suat_enc text;
  v_has_credential boolean;
  v_new_version integer;
  v_new_status text;
  v_previous_status text;
  v_result text;
  v_action text;
  v_metadata jsonb;
  v_constraint text;
BEGIN
  IF p_company_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_operation IS NULL
     OR p_request_fingerprint IS NULL
     OR p_operation NOT IN ('set', 'replace_app', 'rotate_secret', 'rotate_suat', 'revoke')
     OR p_request_fingerprint !~ '^(h1|s1):[0-9a-f]{64}$'
  THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  IF p_operation = 'revoke' THEN
    IF left(p_request_fingerprint, 3) <> 's1:'
       OR p_meta_app_id IS NOT NULL
       OR p_app_secret_enc IS NOT NULL
       OR p_suat_enc IS NOT NULL
       OR p_origin_project_id IS NOT NULL
    THEN
      RETURN jsonb_build_object('result', 'rejected');
    END IF;
  ELSIF left(p_request_fingerprint, 3) <> 'h1:' THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  IF p_operation IN ('replace_app', 'rotate_secret', 'rotate_suat', 'revoke')
     AND (p_expected_version IS NULL OR p_expected_version < 1)
  THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  IF p_operation = 'set'
     AND p_expected_version IS NOT NULL
     AND p_expected_version < 1
  THEN
    RETURN jsonb_build_object('result', 'conflict');
  END IF;

  IF p_operation IN ('set', 'replace_app')
     AND (
       p_meta_app_id IS NULL
       OR p_meta_app_id !~ '^[0-9]{5,32}$'
       OR p_app_secret_enc IS NULL
       OR p_suat_enc IS NULL
       OR p_app_secret_enc = p_suat_enc
       OR p_app_secret_enc !~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
       OR p_suat_enc !~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
       OR length(p_app_secret_enc) < 45
       OR length(p_suat_enc) < 45
       OR length(substring(p_app_secret_enc FROM 6)) % 4 <> 0
       OR length(substring(p_suat_enc FROM 6)) % 4 <> 0
       OR (
         p_origin_project_id IS NOT NULL
         AND p_origin_project_id !~ '^prj_[A-Za-z0-9]{8,64}$'
       )
     )
  THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  IF p_operation = 'rotate_secret'
     AND (
       p_meta_app_id IS NOT NULL
       OR p_suat_enc IS NOT NULL
       OR p_origin_project_id IS NOT NULL
       OR p_app_secret_enc IS NULL
       OR p_app_secret_enc !~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
       OR length(p_app_secret_enc) < 45
       OR length(substring(p_app_secret_enc FROM 6)) % 4 <> 0
     )
  THEN
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  IF p_operation = 'rotate_suat'
     AND (
       p_meta_app_id IS NOT NULL
       OR p_app_secret_enc IS NOT NULL
       OR p_origin_project_id IS NOT NULL
       OR p_suat_enc IS NULL
       OR p_suat_enc !~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
       OR length(p_suat_enc) < 45
       OR length(substring(p_suat_enc FROM 6)) % 4 <> 0
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
    IF v_event_operation <> p_operation
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

  SELECT credential.validation_status,
         credential.credential_version,
         credential.app_secret_enc,
         credential.suat_enc
    INTO v_status,
         v_version,
         v_app_secret_enc,
         v_suat_enc
    FROM public.instagram_byo_company_credentials AS credential
   WHERE credential.company_id = p_company_id
     FOR UPDATE;

  v_has_credential := FOUND;

  IF p_operation = 'set' THEN
    IF NOT v_has_credential THEN
      IF p_expected_version IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'conflict');
      END IF;

      INSERT INTO public.instagram_byo_company_credentials (
        company_id,
        meta_app_id,
        app_secret_enc,
        suat_enc,
        encryption_version,
        key_label,
        validation_status,
        validation_error_code,
        validated_at,
        secret_rotated_at,
        suat_rotated_at,
        rotated_by,
        revoked_at,
        origin_project_id,
        credential_version
      ) VALUES (
        p_company_id,
        p_meta_app_id,
        p_app_secret_enc,
        p_suat_enc,
        1,
        'byo1',
        'saved',
        NULL,
        NULL,
        now(),
        now(),
        p_actor_user_id,
        NULL,
        p_origin_project_id,
        1
      );

      v_new_version := 1;
      v_new_status := 'saved';
      v_previous_status := NULL;
      v_result := 'applied';
    ELSIF v_status = 'revoked' THEN
      IF p_expected_version IS DISTINCT FROM v_version THEN
        RETURN jsonb_build_object('result', 'conflict');
      END IF;

      UPDATE public.instagram_byo_company_credentials AS credential
         SET meta_app_id = p_meta_app_id,
             app_secret_enc = p_app_secret_enc,
             suat_enc = p_suat_enc,
             validation_status = 'saved',
             validation_error_code = NULL,
             validated_at = NULL,
             revoked_at = NULL,
             secret_rotated_at = now(),
             suat_rotated_at = now(),
             rotated_by = p_actor_user_id,
             origin_project_id = p_origin_project_id,
             credential_version = credential.credential_version + 1
       WHERE credential.company_id = p_company_id
         AND credential.credential_version = p_expected_version
         AND credential.validation_status = 'revoked'
      RETURNING credential.credential_version
        INTO v_new_version;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'conflict');
      END IF;

      v_new_status := 'saved';
      v_previous_status := 'revoked';
      v_result := 'applied';
    ELSE
      RETURN jsonb_build_object('result', 'conflict');
    END IF;
  ELSIF p_operation = 'replace_app' THEN
    IF NOT v_has_credential OR v_status = 'revoked' THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    UPDATE public.instagram_byo_company_credentials AS credential
       SET meta_app_id = p_meta_app_id,
           app_secret_enc = p_app_secret_enc,
           suat_enc = p_suat_enc,
           validation_status = 'saved',
           validation_error_code = NULL,
           validated_at = NULL,
           revoked_at = NULL,
           secret_rotated_at = now(),
           suat_rotated_at = now(),
           rotated_by = p_actor_user_id,
           origin_project_id = p_origin_project_id,
           credential_version = credential.credential_version + 1
     WHERE credential.company_id = p_company_id
       AND credential.credential_version = p_expected_version
       AND credential.validation_status <> 'revoked'
    RETURNING credential.credential_version
      INTO v_new_version;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    v_new_status := 'saved';
    v_previous_status := v_status;
    v_result := 'applied';
  ELSIF p_operation = 'rotate_secret' THEN
    IF NOT v_has_credential
       OR v_status = 'revoked'
       OR p_app_secret_enc = v_suat_enc
    THEN
      IF p_app_secret_enc = v_suat_enc THEN
        RETURN jsonb_build_object('result', 'rejected');
      END IF;
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    UPDATE public.instagram_byo_company_credentials AS credential
       SET app_secret_enc = p_app_secret_enc,
           validation_status = 'saved',
           validation_error_code = NULL,
           validated_at = NULL,
           revoked_at = NULL,
           secret_rotated_at = now(),
           rotated_by = p_actor_user_id,
           credential_version = credential.credential_version + 1
     WHERE credential.company_id = p_company_id
       AND credential.credential_version = p_expected_version
       AND credential.validation_status <> 'revoked'
       AND credential.suat_enc IS DISTINCT FROM p_app_secret_enc
    RETURNING credential.credential_version
      INTO v_new_version;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    v_new_status := 'saved';
    v_previous_status := v_status;
    v_result := 'applied';
  ELSIF p_operation = 'rotate_suat' THEN
    IF NOT v_has_credential
       OR v_status = 'revoked'
       OR p_suat_enc = v_app_secret_enc
    THEN
      IF p_suat_enc = v_app_secret_enc THEN
        RETURN jsonb_build_object('result', 'rejected');
      END IF;
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    UPDATE public.instagram_byo_company_credentials AS credential
       SET suat_enc = p_suat_enc,
           validation_status = 'saved',
           validation_error_code = NULL,
           validated_at = NULL,
           revoked_at = NULL,
           suat_rotated_at = now(),
           rotated_by = p_actor_user_id,
           credential_version = credential.credential_version + 1
     WHERE credential.company_id = p_company_id
       AND credential.credential_version = p_expected_version
       AND credential.validation_status <> 'revoked'
       AND credential.app_secret_enc IS DISTINCT FROM p_suat_enc
    RETURNING credential.credential_version
      INTO v_new_version;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    v_new_status := 'saved';
    v_previous_status := v_status;
    v_result := 'applied';
  ELSIF p_operation = 'revoke' THEN
    IF NOT v_has_credential OR p_expected_version IS DISTINCT FROM v_version THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;

    IF v_status = 'revoked' THEN
      v_new_version := v_version;
      v_new_status := 'revoked';
      v_previous_status := 'revoked';
      v_result := 'already_revoked';
    ELSE
      UPDATE public.instagram_byo_company_credentials AS credential
         SET validation_status = 'revoked',
             app_secret_enc = NULL,
             suat_enc = NULL,
             validation_error_code = NULL,
             validated_at = NULL,
             revoked_at = now(),
             rotated_by = p_actor_user_id,
             credential_version = credential.credential_version + 1
       WHERE credential.company_id = p_company_id
         AND credential.credential_version = p_expected_version
         AND credential.validation_status <> 'revoked'
      RETURNING credential.credential_version
        INTO v_new_version;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'conflict');
      END IF;

      v_new_status := 'revoked';
      v_previous_status := v_status;
      v_result := 'applied';
    END IF;
  ELSE
    RETURN jsonb_build_object('result', 'rejected');
  END IF;

  UPDATE public.instagram_byo_poc_accounts AS account
     SET status = 'poc_disabled',
         access_token_enc = NULL,
         scopes = '{}'::text[],
         status_reason = CASE
           WHEN p_operation = 'revoke' THEN 'credentials_revoked'
           ELSE 'credentials_replaced'
         END
   WHERE account.company_id = p_company_id;

  v_action := CASE p_operation
    WHEN 'set' THEN 'credentials_set'
    WHEN 'replace_app' THEN 'app_id_replaced'
    WHEN 'rotate_secret' THEN 'secret_rotated'
    WHEN 'rotate_suat' THEN 'suat_rotated'
    ELSE 'revoked'
  END;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'previous_status', v_previous_status,
    'next_status', v_new_status,
    'app_id_changed', CASE
      WHEN p_operation = 'revoke' THEN NULL
      ELSE p_operation IN ('set', 'replace_app')
    END,
    'secret_replaced', CASE
      WHEN p_operation = 'revoke' THEN NULL
      ELSE p_operation IN ('set', 'replace_app', 'rotate_secret')
    END,
    'suat_replaced', CASE
      WHEN p_operation = 'revoke' THEN NULL
      ELSE p_operation IN ('set', 'replace_app', 'rotate_suat')
    END
  ));

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
    v_action,
    v_metadata,
    p_request_id,
    p_operation,
    p_request_fingerprint,
    v_new_status,
    v_new_version,
    v_new_status <> 'revoked'
  );

  RETURN jsonb_build_object(
    'result', v_result,
    'validation_status', v_new_status,
    'credential_version', v_new_version,
    'configured', v_new_status <> 'revoked',
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
$ig_byo_apply$;

REVOKE ALL ON FUNCTION public.instagram_byo_apply_credentials(
  uuid, uuid, text, integer, uuid, text, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.instagram_byo_apply_credentials(
  uuid, uuid, text, integer, uuid, text, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.instagram_byo_apply_credentials(
  uuid, uuid, text, integer, uuid, text, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.instagram_byo_apply_credentials(
  uuid, uuid, text, integer, uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_byo_scopes_allowed(text[]) TO service_role;
