-- =============================================================================
-- Meta WhatsApp Cloud API — Fase 1B.3.4A / RPC de persistência atômica
-- Função: public.rpc_create_meta_whatsapp_connection
--
-- Responsabilidade: inserir atomicamente uma instância Meta WhatsApp e sua
-- credencial criptografada numa única transação PL/pgSQL.
--
-- Modelo:
--   1 INSERT em public.meta_whatsapp_instances → obtém instance_id via RETURNING
--   1 INSERT em public.meta_whatsapp_credentials (FK instance_id)
--   Se qualquer INSERT falhar: rollback automático de ambos.
--
-- Autorização:
--   NÃO realizada aqui — é responsabilidade exclusiva do backend (validateMetaCaller)
--   antes de invocar esta função. A RPC não lê JWT, auth.uid(), company_users,
--   partner_company_assignments nem feature flags.
--
-- Acesso:
--   service_role only — REVOKE ALL de PUBLIC, anon, authenticated.
--   Chamada exclusivamente pelo backend Vercel (api/).
--
-- Token:
--   Recebe access_token_enc (já criptografado pelo backend via tokenCrypto.js).
--   Nunca recebe token plaintext.
--   Nunca retorna token ou ciphertext.
--
-- Conflito (23505):
--   NÃO capturado internamente. O unique index parcial idx_mwi_phone_number_id_owner
--   em public.meta_whatsapp_instances propaga unique_violation ao caller.
--   O endpoint /onboarding/complete mapeia 23505 → 409 phone_number_already_connected.
--
-- Dependências (devem existir antes de aplicar esta migration):
--   20260912110000_create_meta_whatsapp_instances.sql
--   20260912120000_create_meta_whatsapp_credentials.sql
-- =============================================================================

-- =============================================================================
-- FUNÇÃO
-- =============================================================================

-- Primeira criação — CREATE FUNCTION (não OR REPLACE) para falhar explicitamente
-- se uma função com esta assinatura já existir inesperadamente.
CREATE FUNCTION public.rpc_create_meta_whatsapp_connection(
  p_company_id         uuid,
  p_connected_by       uuid,
  p_waba_id            text,
  p_phone_number_id    text,
  p_phone_number       text,
  p_verified_name      text,    -- nullable: string | NULL
  p_display_name       text,    -- nullable: NULL no MVP
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
  v_instance_id uuid;
BEGIN
  -- ── 1. INSERT da instância ──────────────────────────────────────────────────
  -- Campos não setados: id (DEFAULT gen_random_uuid()), created_at, updated_at,
  -- deleted_at (nasce NULL). Defaults do schema atuam naturalmente.
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
  RETURNING id INTO v_instance_id;

  -- ── 2. INSERT da credencial ─────────────────────────────────────────────────
  -- instance_id referencia a instância recém-criada.
  -- Campos não setados: created_at, updated_at (DEFAULT now()).
  -- Se este INSERT falhar (ex: FK violada, NOT NULL, etc.),
  -- o PostgreSQL faz rollback automático do INSERT anterior.
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

  -- ── 3. Retorno ──────────────────────────────────────────────────────────────
  -- Qualifica todas as colunas com o alias da tabela para evitar ambiguidade
  -- com os parâmetros de saída do RETURNS TABLE.
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

-- =============================================================================
-- COMMENT
-- =============================================================================

COMMENT ON FUNCTION public.rpc_create_meta_whatsapp_connection(
  uuid, uuid, text, text, text, text, text, text, smallint
) IS
'Persistência atômica Meta WhatsApp: insere meta_whatsapp_instances + '
'meta_whatsapp_credentials numa única transação PL/pgSQL. '
'Acesso exclusivo de service_role (backend). '
'Autorização do usuário deve ocorrer ANTES no backend (validateMetaCaller). '
'Recebe token já criptografado — nunca token plaintext. '
'23505 (unique_violation) propagado ao caller sem captura interna.';

-- =============================================================================
-- GRANTS / REVOKES
-- =============================================================================

-- Assinatura completa obrigatória nos comandos GRANT/REVOKE para garantir
-- que o escopo é exato mesmo se existirem overloads futuros.
REVOKE ALL ON FUNCTION public.rpc_create_meta_whatsapp_connection(
  uuid, uuid, text, text, text, text, text, text, smallint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.rpc_create_meta_whatsapp_connection(
  uuid, uuid, text, text, text, text, text, text, smallint
) FROM anon;

REVOKE ALL ON FUNCTION public.rpc_create_meta_whatsapp_connection(
  uuid, uuid, text, text, text, text, text, text, smallint
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_create_meta_whatsapp_connection(
  uuid, uuid, text, text, text, text, text, text, smallint
) TO service_role;
