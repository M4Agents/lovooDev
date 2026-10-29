-- =============================================================================
-- PoC Instagram BYO — tabela isolada
-- Tabela: public.instagram_byo_poc_accounts
--
-- Não altera instagram_connections, RPCs, índices nem policies existentes.
-- Não fixa o UUID de nenhuma empresa. O isolamento do piloto fica na API.
--
-- Token futuro:
--   access_token_enc usa chave própria INSTAGRAM_BYO_TOKEN_ENC_KEY_V1.
--   Prefixo previsto: byo1: (AES-256-GCM). Não usar o prefixo v1: do fluxo oficial.
--   Esta migração não grava token e não cria função de criptografia.
--
-- Rollback:
--   DROP TABLE public.instagram_byo_poc_accounts;
-- =============================================================================

CREATE TABLE public.instagram_byo_poc_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instagram_account_id  TEXT        NOT NULL,
  system_user_id        TEXT,
  instagram_username    TEXT,
  access_token_enc      TEXT,
  encryption_version    SMALLINT    NOT NULL DEFAULT 1,
  scopes                TEXT[]      NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'poc_disabled',
  status_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_ig_byo_poc_company_account
    UNIQUE (company_id, instagram_account_id),

  CONSTRAINT chk_ig_byo_poc_status
    CHECK (status IN ('poc_enabled', 'poc_disabled')),

  CONSTRAINT chk_ig_byo_poc_enc_version
    CHECK (encryption_version >= 1),

  CONSTRAINT chk_ig_byo_poc_account_id
    CHECK (instagram_account_id ~ '^[0-9]{5,32}$'),

  CONSTRAINT chk_ig_byo_poc_system_user_id
    CHECK (system_user_id IS NULL OR system_user_id ~ '^[0-9]{5,32}$'),

  CONSTRAINT chk_ig_byo_poc_enabled_has_token
    CHECK (
      status <> 'poc_enabled'
      OR (access_token_enc IS NOT NULL AND length(access_token_enc) > 0)
    )
);

CREATE INDEX idx_ig_byo_poc_company
  ON public.instagram_byo_poc_accounts (company_id);

CREATE INDEX idx_ig_byo_poc_company_status
  ON public.instagram_byo_poc_accounts (company_id, status);

CREATE TRIGGER update_instagram_byo_poc_accounts_updated_at
  BEFORE UPDATE ON public.instagram_byo_poc_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.instagram_byo_poc_accounts ENABLE ROW LEVEL SECURITY;

-- Sem policy para anon/authenticated: RLS nega o acesso direto.
-- REVOKE impede a consulta mesmo para membro da empresa.
REVOKE ALL ON TABLE public.instagram_byo_poc_accounts FROM PUBLIC;
REVOKE ALL ON TABLE public.instagram_byo_poc_accounts FROM anon;
REVOKE ALL ON TABLE public.instagram_byo_poc_accounts FROM authenticated;

GRANT ALL ON TABLE public.instagram_byo_poc_accounts TO service_role;
