-- =============================================================================
-- Pop-up de boas-vindas Nuvemshop — configuração por loja
--
-- Uma campanha por empresa e loja conectada.
-- Nesta etapa o recurso nasce desativado: enabled não pode ser true.
-- A restrição chk_nv_welcome_unpublished só deve ser removida quando o
-- formulário público existir. Até lá, nem a API nem o painel publicam.
--
-- Leitura: membro da empresa, admin da empresa pai ou platform admin.
-- Escrita: somente service_role, depois de JWT, papel e conexão ativa.
-- =============================================================================

CREATE TABLE public.nuvemshop_welcome_campaigns (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nuvemshop_store_id    TEXT        NOT NULL,

  enabled               BOOLEAN     NOT NULL DEFAULT false,
  page_rule             TEXT        NOT NULL DEFAULT 'home',

  title                 TEXT,
  description           TEXT,
  image_url             TEXT,
  button_label          TEXT,
  background_color      TEXT,
  text_color            TEXT,
  button_color          TEXT,
  consent_text          TEXT,
  consent_version       TEXT,
  coupon_code           TEXT,
  delay_seconds         INTEGER,
  resurface_days        INTEGER,

  created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nv_welcome_company_store
    UNIQUE (company_id, nuvemshop_store_id),

  CONSTRAINT chk_nv_welcome_unpublished
    CHECK (enabled = false),

  CONSTRAINT chk_nv_welcome_page_home
    CHECK (page_rule = 'home'),

  CONSTRAINT chk_nv_welcome_title
    CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 80),

  CONSTRAINT chk_nv_welcome_description
    CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 400),

  CONSTRAINT chk_nv_welcome_button
    CHECK (button_label IS NULL OR char_length(button_label) BETWEEN 1 AND 40),

  CONSTRAINT chk_nv_welcome_consent
    CHECK (consent_text IS NULL OR char_length(consent_text) BETWEEN 1 AND 600),

  CONSTRAINT chk_nv_welcome_consent_version
    CHECK (consent_version IS NULL OR consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),

  CONSTRAINT chk_nv_welcome_image
    CHECK (
      image_url IS NULL
      OR (char_length(image_url) BETWEEN 1 AND 500 AND image_url ~ '^https://[^[:space:]]+$')
    ),

  CONSTRAINT chk_nv_welcome_background
    CHECK (background_color IS NULL OR background_color ~ '^#[0-9a-f]{6}$'),

  CONSTRAINT chk_nv_welcome_text_color
    CHECK (text_color IS NULL OR text_color ~ '^#[0-9a-f]{6}$'),

  CONSTRAINT chk_nv_welcome_button_color
    CHECK (button_color IS NULL OR button_color ~ '^#[0-9a-f]{6}$'),

  CONSTRAINT chk_nv_welcome_coupon
    CHECK (coupon_code IS NULL OR coupon_code ~ '^[A-Z0-9_-]{3,50}$'),

  CONSTRAINT chk_nv_welcome_delay
    CHECK (delay_seconds IS NULL OR delay_seconds BETWEEN 0 AND 120),

  CONSTRAINT chk_nv_welcome_resurface
    CHECK (resurface_days IS NULL OR resurface_days BETWEEN 1 AND 365)
);

CREATE TRIGGER update_nuvemshop_welcome_campaigns_updated_at
  BEFORE UPDATE ON public.nuvemshop_welcome_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nuvemshop_welcome_campaigns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM PUBLIC;
REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM anon;
REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM authenticated;

GRANT SELECT ON TABLE public.nuvemshop_welcome_campaigns TO authenticated;
GRANT ALL ON TABLE public.nuvemshop_welcome_campaigns TO service_role;

CREATE POLICY "nvwelcome_select_member"
  ON public.nuvemshop_welcome_campaigns
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: sem policy.
-- O backend grava com service_role depois de validar JWT, papel e conexão ativa.
