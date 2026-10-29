-- =============================================================================
-- Instagram BYO Meta — credenciais da empresa e trilha de auditoria
--
-- Cria somente:
--   public.instagram_byo_company_credentials
--   public.instagram_byo_credential_events
--
-- Não altera instagram_byo_poc_accounts, instagram_connections, mensagens,
-- comentários, RPCs nem policies existentes. Não grava linha e não guarda
-- segredo em claro.
--
-- Histórico conhecido, sem reparo nesta migração:
--   arquivo local da tabela de contas: 20261029140000
--   versão aplicada no M4_Digital:     20261029155651
-- Este arquivo é posterior e deve ser aplicado sozinho.
--
-- Exclusão:
--   company_id usa ON DELETE CASCADE. Credencial e auditoria vivem enquanto
--   a empresa existir. Remover a empresa apaga os ciphertexts em vez de
--   deixá-los órfãos.
--   rotated_by e actor_user_id usam ON DELETE SET NULL. A saída do usuário
--   preserva a linha da empresa e a trilha.
--
-- Privilégios padrão do schema public concedem ALL a anon, authenticated e
-- service_role. O REVOKE abaixo, na mesma migração, retira esse acesso.
-- A conferência efetiva fica comentada no final e não faz parte da execução.
--
-- Sem função de gravação. A transação que grava credencial e evento fica
-- para a fase seguinte.
--
-- Rollback, ainda não executado:
--   DROP TABLE public.instagram_byo_credential_events;
--   DROP TABLE public.instagram_byo_company_credentials;
-- =============================================================================

CREATE TABLE public.instagram_byo_company_credentials (
  company_id             UUID        PRIMARY KEY
                         REFERENCES public.companies(id) ON DELETE CASCADE,
  meta_app_id            TEXT        NOT NULL,
  app_secret_enc         TEXT,
  suat_enc               TEXT,
  encryption_version     SMALLINT    NOT NULL DEFAULT 1,
  key_label              TEXT        NOT NULL DEFAULT 'byo1',
  validation_status      TEXT        NOT NULL DEFAULT 'saved',
  validation_error_code  TEXT,
  validated_at           TIMESTAMPTZ,
  secret_rotated_at      TIMESTAMPTZ,
  suat_rotated_at        TIMESTAMPTZ,
  rotated_by             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at             TIMESTAMPTZ,
  origin_project_id      TEXT,
  credential_version     INTEGER     NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_ig_byo_cred_app_id
    CHECK (meta_app_id ~ '^[0-9]{5,32}$'),

  CONSTRAINT chk_ig_byo_cred_secret_prefix
    CHECK (
      app_secret_enc IS NULL
      OR (
        app_secret_enc ~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
        AND length(app_secret_enc) >= 45
        AND length(substring(app_secret_enc FROM 6)) % 4 = 0
      )
    ),

  CONSTRAINT chk_ig_byo_cred_suat_prefix
    CHECK (
      suat_enc IS NULL
      OR (
        suat_enc ~ '^byo1:[A-Za-z0-9+/]+={0,2}$'
        AND length(suat_enc) >= 45
        AND length(substring(suat_enc FROM 6)) % 4 = 0
      )
    ),

  CONSTRAINT chk_ig_byo_cred_crypto_version
    CHECK (encryption_version = 1 AND key_label = 'byo1'),

  CONSTRAINT chk_ig_byo_cred_status
    CHECK (validation_status IN ('saved', 'pending', 'valid', 'failed', 'revoked')),

  CONSTRAINT chk_ig_byo_cred_valid_at
    CHECK (
      (validation_status = 'valid' AND validated_at IS NOT NULL)
      OR (validation_status <> 'valid' AND validated_at IS NULL)
    ),

  CONSTRAINT chk_ig_byo_cred_state_secrets
    CHECK (
      (
        validation_status = 'revoked'
        AND revoked_at IS NOT NULL
        AND app_secret_enc IS NULL
        AND suat_enc IS NULL
      )
      OR (
        validation_status <> 'revoked'
        AND revoked_at IS NULL
        AND app_secret_enc IS NOT NULL
        AND suat_enc IS NOT NULL
      )
    ),

  CONSTRAINT chk_ig_byo_cred_distinct_secrets
    CHECK (
      app_secret_enc IS NULL
      OR suat_enc IS NULL
      OR app_secret_enc <> suat_enc
    ),

  CONSTRAINT chk_ig_byo_cred_error_code
    CHECK (
      (
        validation_status = 'failed'
        AND (
          validation_error_code IS NULL
          OR validation_error_code ~ '^[a-z0-9_]{1,64}$'
        )
      )
      OR (
        validation_status <> 'failed'
        AND validation_error_code IS NULL
      )
    ),

  CONSTRAINT chk_ig_byo_cred_origin_project
    CHECK (
      origin_project_id IS NULL
      OR origin_project_id ~ '^prj_[A-Za-z0-9]{8,64}$'
    ),

  CONSTRAINT chk_ig_byo_cred_version_positive
    CHECK (credential_version >= 1)
);

CREATE TRIGGER update_instagram_byo_company_credentials_updated_at
  BEFORE UPDATE ON public.instagram_byo_company_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.instagram_byo_company_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM PUBLIC;
REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM anon;
REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM authenticated;

GRANT ALL ON TABLE public.instagram_byo_company_credentials TO service_role;

CREATE TABLE public.instagram_byo_credential_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL
                 REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  action         TEXT        NOT NULL,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_ig_byo_evt_action
    CHECK (action IN (
      'credentials_set',
      'app_id_replaced',
      'secret_rotated',
      'suat_rotated',
      'validation_failed',
      'validated',
      'enabled',
      'disabled',
      'revoked'
    )),

  CONSTRAINT chk_ig_byo_evt_metadata
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND (
        metadata
        - 'validation_error_code'
        - 'previous_status'
        - 'next_status'
        - 'app_id_changed'
        - 'secret_replaced'
        - 'suat_replaced'
      ) = '{}'::jsonb
      AND (
        NOT jsonb_exists(metadata, 'validation_error_code')
        OR (
          jsonb_typeof(metadata -> 'validation_error_code') = 'string'
          AND (metadata ->> 'validation_error_code') ~ '^[a-z0-9_]{1,64}$'
        )
      )
      AND (
        NOT jsonb_exists(metadata, 'previous_status')
        OR (
          jsonb_typeof(metadata -> 'previous_status') = 'string'
          AND (metadata ->> 'previous_status') IN (
            'saved', 'pending', 'valid', 'failed', 'revoked'
          )
        )
      )
      AND (
        NOT jsonb_exists(metadata, 'next_status')
        OR (
          jsonb_typeof(metadata -> 'next_status') = 'string'
          AND (metadata ->> 'next_status') IN (
            'saved', 'pending', 'valid', 'failed', 'revoked'
          )
        )
      )
      AND (
        NOT jsonb_exists(metadata, 'app_id_changed')
        OR jsonb_typeof(metadata -> 'app_id_changed') = 'boolean'
      )
      AND (
        NOT jsonb_exists(metadata, 'secret_replaced')
        OR jsonb_typeof(metadata -> 'secret_replaced') = 'boolean'
      )
      AND (
        NOT jsonb_exists(metadata, 'suat_replaced')
        OR jsonb_typeof(metadata -> 'suat_replaced') = 'boolean'
      )
    )
);

CREATE INDEX idx_ig_byo_credential_events_company_created
  ON public.instagram_byo_credential_events (company_id, created_at DESC);

ALTER TABLE public.instagram_byo_credential_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM PUBLIC;
REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM anon;
REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM authenticated;

GRANT ALL ON TABLE public.instagram_byo_credential_events TO service_role;

-- Conferência pós-aplicação. Comentada de propósito: não executa com o arquivo.
--
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relname IN (
--      'instagram_byo_company_credentials',
--      'instagram_byo_credential_events'
--    );
--
-- SELECT tablename, policyname
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN (
--      'instagram_byo_company_credentials',
--      'instagram_byo_credential_events'
--    );
--
-- SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND table_name IN (
--      'instagram_byo_company_credentials',
--      'instagram_byo_credential_events'
--    );
--
-- SELECT
--   has_table_privilege('anon', 'public.instagram_byo_company_credentials', 'SELECT'),
--   has_table_privilege('authenticated', 'public.instagram_byo_company_credentials', 'SELECT'),
--   has_table_privilege('service_role', 'public.instagram_byo_company_credentials', 'SELECT'),
--   has_table_privilege('anon', 'public.instagram_byo_credential_events', 'SELECT'),
--   has_table_privilege('authenticated', 'public.instagram_byo_credential_events', 'SELECT'),
--   has_table_privilege('service_role', 'public.instagram_byo_credential_events', 'SELECT');
