-- =============================================================================
-- Pop-up de boas-vindas — teste autenticado, ainda sem cadastro público.
--
-- enabled=false permanece na migration anterior. Esta não remove o CHECK.
-- A tabela de teste não é concessão, não guarda cupom e não deve ser lida
-- por cron, fila ou automação futura.
-- A limpeza é a exclusão explícita pelo painel. Nenhum prazo de retenção
-- dos dados reais é aplicado aqui; essa política continua pendente.
--
-- ORDEM: aplicar esta migration aditiva antes de publicar o código que lê
-- promo_consent_text, promo_consent_version, allowed_origins e test_contacts.
-- Sem essas colunas, o painel responde recurso indisponível e não grava
-- por cima do rascunho já salvo.
-- =============================================================================

ALTER TABLE public.nuvemshop_welcome_campaigns
  ADD COLUMN promo_consent_text     TEXT,
  ADD COLUMN promo_consent_version  TEXT,
  ADD COLUMN allowed_origins        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN test_contacts          JSONB  NOT NULL DEFAULT '[]';

CREATE SCHEMA IF NOT EXISTS private;

-- O CHECK roda como quem grava, não como o dono da tabela. service_role
-- precisa de USAGE no schema e de EXECUTE nesta função. private já tem
-- quatro funções SECURITY DEFINER de leads e nenhuma tabela. Essas funções
-- não concedem EXECUTE a service_role nem a PUBLIC, então USAGE não as abre.
-- Não há CREATE, ALL nem EXECUTE em todas as funções.
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.nuvemshop_welcome_origins_valid(origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT origins IS NOT NULL
    AND cardinality(origins) <= 8
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(origins) AS origin
      WHERE origin IS NULL
         OR origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
    );
$$;

REVOKE ALL ON FUNCTION private.nuvemshop_welcome_origins_valid(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.nuvemshop_welcome_origins_valid(text[]) FROM anon;
REVOKE ALL ON FUNCTION private.nuvemshop_welcome_origins_valid(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.nuvemshop_welcome_origins_valid(text[]) TO service_role;

ALTER TABLE public.nuvemshop_welcome_campaigns
  ADD CONSTRAINT chk_nv_welcome_promo_text
    CHECK (promo_consent_text IS NULL OR char_length(promo_consent_text) BETWEEN 1 AND 600),
  ADD CONSTRAINT chk_nv_welcome_promo_version
    CHECK (promo_consent_version IS NULL OR promo_consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  ADD CONSTRAINT chk_nv_welcome_origins
    CHECK (private.nuvemshop_welcome_origins_valid(allowed_origins)),
  ADD CONSTRAINT chk_nv_welcome_test_contacts
    CHECK (jsonb_typeof(test_contacts) = 'array' AND jsonb_array_length(test_contacts) <= 5);

CREATE TABLE public.nuvemshop_welcome_test_submissions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nuvemshop_store_id       TEXT        NOT NULL,
  campaign_id              UUID        REFERENCES public.nuvemshop_welcome_campaigns(id) ON DELETE CASCADE,

  name                     TEXT        NOT NULL,
  email_normalized         TEXT        NOT NULL,
  phone_normalized         TEXT        NOT NULL,
  coupon_consent           BOOLEAN     NOT NULL,
  coupon_consent_version   TEXT,
  promo_consent            BOOLEAN     NOT NULL DEFAULT false,

  identity_result          TEXT        NOT NULL,
  eligibility_result       TEXT        NOT NULL,
  limitation_note          TEXT,
  observed_lead_id         INTEGER     REFERENCES public.leads(id) ON DELETE SET NULL,

  created_by               UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_nv_welcome_test_identity
    CHECK (identity_result IN ('none', 'reuse', 'conflict', 'unavailable')),

  CONSTRAINT chk_nv_welcome_test_eligibility
    CHECK (eligibility_result IN (
      'ineligible_paid',
      'eligible_limited',
      'unavailable',
      'pending_refund_rule',
      'payment_inconclusive',
      'not_evaluated'
    ))
);

CREATE INDEX idx_nv_welcome_test_company_store
  ON public.nuvemshop_welcome_test_submissions (company_id, nuvemshop_store_id, created_at DESC);

ALTER TABLE public.nuvemshop_welcome_test_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nuvemshop_welcome_test_submissions FROM PUBLIC;
REVOKE ALL ON TABLE public.nuvemshop_welcome_test_submissions FROM anon;
REVOKE ALL ON TABLE public.nuvemshop_welcome_test_submissions FROM authenticated;

GRANT SELECT ON TABLE public.nuvemshop_welcome_test_submissions TO authenticated;
GRANT ALL ON TABLE public.nuvemshop_welcome_test_submissions TO service_role;

CREATE POLICY "nvwelcome_test_select_member"
  ON public.nuvemshop_welcome_test_submissions
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: sem policy.
-- O painel apaga pelo backend, depois de JWT, papel e conexão ativa.
