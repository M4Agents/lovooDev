-- =============================================================================
-- Nuvemshop Integration — Migration 1/12
-- Tabela: nuvemshop_connections
--
-- Armazena o estado da conexão OAuth Nuvemshop por empresa.
-- Uma empresa pode ter no máximo uma loja Nuvemshop conectada.
-- O access_token é armazenado exclusivamente criptografado (AES-256-GCM).
-- Gravações somente via service_role (backend). Frontend: somente leitura via RLS.
-- =============================================================================

CREATE TABLE public.nuvemshop_connections (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Identificação da loja Nuvemshop
  nuvemshop_store_id    TEXT        NOT NULL,
  store_name            TEXT,
  store_domain          TEXT,
  currency              TEXT,
  country               TEXT,

  -- Autenticação (token nunca exposto ao frontend)
  access_token_enc      TEXT        NOT NULL,
  encryption_version    SMALLINT    NOT NULL DEFAULT 1,

  -- Status da conexão
  status                TEXT        NOT NULL DEFAULT 'active',
  status_reason         TEXT,

  -- Webhooks e scripts registrados na Nuvemshop
  -- webhook_ids: array de objetos { id, topic } registrados
  webhook_ids           JSONB       NOT NULL DEFAULT '[]',
  script_id             TEXT,

  -- Campos de observabilidade operacional
  last_sync_at          TIMESTAMPTZ,
  last_webhook_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error_message    TEXT,

  -- Auditoria
  connected_by          UUID        REFERENCES auth.users(id),
  disconnected_by       UUID        REFERENCES auth.users(id),
  connected_at          TIMESTAMPTZ,
  disconnected_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma empresa → uma loja Nuvemshop
  CONSTRAINT uq_nuvemshop_connections_company
    UNIQUE (company_id),

  CONSTRAINT chk_nuvemshop_connections_status
    CHECK (status IN ('active', 'disconnected', 'suspended', 'error', 'reauth_required'))
);

-- Índices
CREATE INDEX idx_nvconn_company
  ON public.nuvemshop_connections(company_id);

CREATE INDEX idx_nvconn_store_id
  ON public.nuvemshop_connections(nuvemshop_store_id);

CREATE INDEX idx_nvconn_status
  ON public.nuvemshop_connections(status);

-- Trigger updated_at (reutiliza função global do projeto)
CREATE TRIGGER update_nuvemshop_connections_updated_at
  BEFORE UPDATE ON public.nuvemshop_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.nuvemshop_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: membros da empresa, admin da empresa pai, platform admin
CREATE POLICY "nvconn_select_member"
  ON public.nuvemshop_connections
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: exclusivamente service_role (bypass RLS automático)
-- O backend valida autenticação, company_id, role e membership antes de qualquer escrita.
