-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 6/8)
-- Tabela: lead_social_profiles
--
-- Vincula um lead do CRM a um perfil de rede social (ex.: Instagram).
-- Finalidade: deduplicação secundária por perfil social.
-- IMPORTANTE: deduplicação principal continua sendo por telefone.
--
-- Preparada para múltiplos providers futuros via CHECK (provider IN (...)).
-- =============================================================================

CREATE TABLE public.lead_social_profiles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          INTEGER     NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id       UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL,
  provider_user_id TEXT        NOT NULL,
  username         TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_lead_social_profiles_provider
    UNIQUE (company_id, provider, provider_user_id),

  CONSTRAINT chk_lsp_provider
    CHECK (provider IN ('instagram'))
);

-- Índices
CREATE INDEX idx_lsp_lead
  ON public.lead_social_profiles(lead_id);

CREATE INDEX idx_lsp_company_provider
  ON public.lead_social_profiles(company_id, provider, provider_user_id);

-- Trigger updated_at
CREATE TRIGGER update_lead_social_profiles_updated_at
  BEFORE UPDATE ON public.lead_social_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.lead_social_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lsp_select_member"
  ON public.lead_social_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE: somente service_role
