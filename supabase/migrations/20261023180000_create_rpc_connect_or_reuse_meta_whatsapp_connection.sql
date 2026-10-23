-- =============================================================================
-- Meta WhatsApp Cloud API — MVP5.A5.4.4
-- Função: public.rpc_connect_or_reuse_meta_whatsapp_connection
--
-- Tipo: EXCLUSIVAMENTE ADITIVA.
--   CREATE FUNCTION nova. Não altera tabelas, triggers, RLS, índices
--   nem public.rpc_create_meta_whatsapp_connection.
--
-- Responsabilidade:
--   Inserir uma conexão nova OU reutilizar a instância ativa do mesmo
--   tenant para o phone_number_id comprovado, numa única transação.
--
-- Autorização:
--   NÃO realizada aqui. O backend (validateMetaCaller + claim) valida
--   JWT, membership, role, partner e feature flag ANTES de invocar.
--
-- Acesso: service_role only.
-- Token: recebe access_token_enc já cifrado. Nunca plaintext. Nunca retorna ciphertext.
--
-- Concorrência (contrato A5.4.2 / A5.4.3):
--   • pg_advisory_xact_lock serializa por número (padrão hashtextextended do projeto).
--   • idx_mwi_phone_number_id_owner é a garantia final de unicidade ativa.
--   • REUSE só se instances.updated_at <= onboarding.created_at (lido no banco).
--   • Disconnect idempotente (já disconnected, sem UPDATE) NÃO cancela signup.
--   • Disconnect real (connected → disconnected) bumpa updated_at e invalida
--     signup iniciado antes. NOW() no trigger é início da transação, não commit.
--   • Reauth antiga não sobrescreve token gravado por reauth mais nova.
--   • Segundo signup simultâneo da mesma empresa pode receber authorization_stale.
--
-- Dependências:
--   20260912110000_create_meta_whatsapp_instances.sql
--   20260912120000_create_meta_whatsapp_credentials.sql
--   20260912130000_create_meta_whatsapp_onboarding.sql
--   20260914212046_create_meta_whatsapp_connect_rpc.sql (não substituída)
--
-- Rollback (somente com aprovação explícita):
--   DROP FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
--     uuid, uuid, uuid, text, text, text, text, text, text, smallint);
-- =============================================================================

CREATE FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  p_company_id         uuid,
  p_connected_by       uuid,
  p_onboarding_id      uuid,
  p_waba_id            text,
  p_phone_number_id    text,
  p_phone_number       text,
  p_verified_name      text,
  p_display_name       text,
  p_access_token_enc   text,
  p_encryption_version smallint
)
RETURNS TABLE (
  instance_id     uuid,
  phone_number_id text,
  waba_id         text,
  phone_number    text,
  verified_name   text,
  status          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent_created_at timestamptz;
  v_instance_id       uuid;
  v_owner_company_id  uuid;
  v_row_updated_at    timestamptz;
  v_constraint_name   text;
  v_cred_exists       boolean;
BEGIN
  -- ── 0. Validação de parâmetros (sem descriptografar) ──────────────────────
  IF p_company_id IS NULL
     OR p_connected_by IS NULL
     OR p_onboarding_id IS NULL THEN
    RAISE EXCEPTION 'invalid_parameter'
      USING ERRCODE = '22023';
  END IF;

  IF p_waba_id IS NULL OR p_waba_id !~ '^[0-9]+$'
     OR p_phone_number_id IS NULL OR p_phone_number_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_parameter'
      USING ERRCODE = '22023';
  END IF;

  -- Ciphertext versionado v<N>:… — não inspecionar o payload.
  IF p_access_token_enc IS NULL
     OR p_access_token_enc !~ '^v[0-9]+:.+$' THEN
    RAISE EXCEPTION 'invalid_parameter'
      USING ERRCODE = '22023';
  END IF;

  IF p_encryption_version IS NULL OR p_encryption_version < 1 THEN
    RAISE EXCEPTION 'invalid_parameter'
      USING ERRCODE = '22023';
  END IF;

  -- ── 1. Onboarding: created_at só do banco. Sem revalidar expires_at. ──────
  SELECT mwo.created_at
    INTO v_intent_created_at
    FROM public.meta_whatsapp_onboarding AS mwo
   WHERE mwo.id = p_onboarding_id
     AND mwo.company_id = p_company_id
     AND mwo.user_id = p_connected_by
     AND mwo.used_at IS NOT NULL;

  IF v_intent_created_at IS NULL THEN
    RAISE EXCEPTION 'onboarding_not_usable'
      USING ERRCODE = 'P0002';
  END IF;

  -- ── 2. Serializar por número (global — o unique também é global) ──────────
  PERFORM pg_advisory_xact_lock(
    hashtextextended('meta_wa_phone:' || p_phone_number_id, 0)
  );

  -- ── 3. Instância ativa ────────────────────────────────────────────────────
  SELECT mwi.id, mwi.company_id, mwi.updated_at
    INTO v_instance_id, v_owner_company_id, v_row_updated_at
    FROM public.meta_whatsapp_instances AS mwi
   WHERE mwi.phone_number_id = p_phone_number_id
     AND mwi.deleted_at IS NULL
     FOR UPDATE;

  IF v_instance_id IS NULL THEN
    -- INSERT: mesma semântica da RPC de criação. Soft-deleted não é lido.
    BEGIN
      INSERT INTO public.meta_whatsapp_instances (
        company_id,
        phone_number_id,
        waba_id,
        display_name,
        phone_number,
        verified_name,
        status,
        connected_by
      )
      VALUES (
        p_company_id,
        p_phone_number_id,
        p_waba_id,
        p_display_name,
        p_phone_number,
        p_verified_name,
        'connected',
        p_connected_by
      )
      RETURNING public.meta_whatsapp_instances.id INTO v_instance_id;

      INSERT INTO public.meta_whatsapp_credentials (
        instance_id,
        access_token_enc,
        encryption_version
      )
      VALUES (
        v_instance_id,
        p_access_token_enc,
        p_encryption_version
      );
    EXCEPTION
      WHEN unique_violation THEN
        -- Distinguir o unique parcial do número de qualquer outro 23505.
        -- Índice (não CONSTRAINT): CONSTRAINT_NAME costuma ser o nome do índice.
        -- Se vier NULL ou outro nome, NÃO tratar como conflito de número — re-raise.
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM 'idx_mwi_phone_number_id_owner' THEN
          RAISE;
        END IF;

        SELECT mwi.id, mwi.company_id, mwi.updated_at
          INTO v_instance_id, v_owner_company_id, v_row_updated_at
          FROM public.meta_whatsapp_instances AS mwi
         WHERE mwi.phone_number_id = p_phone_number_id
           AND mwi.deleted_at IS NULL
           FOR UPDATE;

        IF v_instance_id IS NULL THEN
          RAISE;
        END IF;

        IF v_owner_company_id IS DISTINCT FROM p_company_id THEN
          RAISE unique_violation;
        END IF;
        -- Mesma empresa: cai no REUSE abaixo (OCC).
    END;

    IF v_owner_company_id IS NULL THEN
      -- INSERT bem-sucedido (sem cair no EXCEPTION).
      RETURN QUERY
      SELECT
        mwi.id,
        mwi.phone_number_id,
        mwi.waba_id,
        mwi.phone_number,
        mwi.verified_name,
        mwi.status
      FROM public.meta_whatsapp_instances AS mwi
      WHERE mwi.id = v_instance_id;
      RETURN;
    END IF;
  END IF;

  -- ── 4. Linha ativa encontrada (SELECT inicial ou 23505 do número) ─────────
  IF v_owner_company_id IS DISTINCT FROM p_company_id THEN
    RAISE unique_violation;
  END IF;

  -- OCC: WRITE na instância depois do start invalida este signup.
  IF v_row_updated_at > v_intent_created_at THEN
    RAISE EXCEPTION 'authorization_stale'
      USING ERRCODE = 'P0003';
  END IF;

  -- Credencial: UPDATE ou INSERT órfão. PIN não é tocado.
  SELECT EXISTS (
    SELECT 1
    FROM public.meta_whatsapp_credentials AS mwc
    WHERE mwc.instance_id = v_instance_id
  ) INTO v_cred_exists;

  IF v_cred_exists THEN
    UPDATE public.meta_whatsapp_credentials AS mwc
       SET access_token_enc   = p_access_token_enc,
           encryption_version = p_encryption_version
     WHERE mwc.instance_id = v_instance_id;
  ELSE
    INSERT INTO public.meta_whatsapp_credentials (
      instance_id,
      access_token_enc,
      encryption_version
    )
    VALUES (
      v_instance_id,
      p_access_token_enc,
      p_encryption_version
    );
  END IF;

  -- UPDATE da instância dispara trg_mwi_updated_at (invalida OCC do Caminho 1).
  UPDATE public.meta_whatsapp_instances AS mwi
     SET status       = 'connected',
         connected_by = p_connected_by,
         waba_id      = p_waba_id,
         phone_number = p_phone_number,
         verified_name = p_verified_name,
         display_name = p_display_name
   WHERE mwi.id = v_instance_id
     AND mwi.company_id = p_company_id
     AND mwi.deleted_at IS NULL
     AND mwi.phone_number_id = p_phone_number_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorization_stale'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    mwi.id,
    mwi.phone_number_id,
    mwi.waba_id,
    mwi.phone_number,
    mwi.verified_name,
    mwi.status
  FROM public.meta_whatsapp_instances AS mwi
  WHERE mwi.id = v_instance_id;
END;
$$;

COMMENT ON FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  uuid, uuid, uuid, text, text, text, text, text, text, smallint
) IS
'INSERT ou REUSE atômico de conexão Meta WhatsApp. '
'service_role only. Auth no backend (validateMetaCaller + claim). '
'OCC: instances.updated_at <= onboarding.created_at. '
'Token somente cifrado. 23505 de outro índice não é tratado como conflito de número.';

REVOKE ALL ON FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  uuid, uuid, uuid, text, text, text, text, text, text, smallint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  uuid, uuid, uuid, text, text, text, text, text, text, smallint
) FROM anon;

REVOKE ALL ON FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  uuid, uuid, uuid, text, text, text, text, text, text, smallint
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_connect_or_reuse_meta_whatsapp_connection(
  uuid, uuid, uuid, text, text, text, text, text, text, smallint
) TO service_role;
