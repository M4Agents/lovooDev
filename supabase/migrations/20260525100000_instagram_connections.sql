-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 1/8)
-- Tabela: instagram_connections
--
-- Armazena as conexões OAuth de contas Instagram Business vinculadas a empresas.
-- Tokens são armazenados encriptados (access_token_enc + encryption_version).
-- =============================================================================

CREATE TABLE public.instagram_connections (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instagram_user_id     TEXT        NOT NULL,
  instagram_username    TEXT        NOT NULL,
  page_id               TEXT,
  access_token_enc      TEXT        NOT NULL,
  encryption_version    SMALLINT    NOT NULL DEFAULT 1,
  token_expires_at      TIMESTAMPTZ,
  scopes                TEXT[],
  status                TEXT        NOT NULL DEFAULT 'active',
  status_reason         TEXT,
  rate_limit_metadata   JSONB       NOT NULL DEFAULT '{}',
  last_error_at         TIMESTAMPTZ,
  connected_by          UUID        REFERENCES auth.users(id),
  disconnected_by       UUID        REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_instagram_connections_company_user
    UNIQUE (company_id, instagram_user_id),

  CONSTRAINT chk_instagram_connections_status
    CHECK (status IN ('active', 'expired', 'revoked', 'error', 'reauth_required', 'limited'))
);

-- Índices
CREATE INDEX idx_igconn_company
  ON public.instagram_connections(company_id);

CREATE INDEX idx_igconn_ig_user_id
  ON public.instagram_connections(instagram_user_id);

CREATE INDEX idx_igconn_status
  ON public.instagram_connections(status);

-- Trigger updated_at
CREATE TRIGGER update_instagram_connections_updated_at
  BEFORE UPDATE ON public.instagram_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: membros da empresa, admin da empresa pai, platform admin
CREATE POLICY "igconn_select_member"
  ON public.instagram_connections
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: somente service_role (bypass RLS automático)
-- Frontend nunca escreve diretamente nesta tabela
