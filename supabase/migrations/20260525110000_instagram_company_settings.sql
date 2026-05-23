-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 2/8)
-- Tabela: instagram_company_settings
--
-- Configurações de comportamento da integração Instagram por empresa.
-- Uma linha por empresa (UNIQUE company_id).
--
-- IMPORTANTE: auto_create_leads = true NUNCA cria lead sem telefone.
-- A validação de telefone obrigatória é responsabilidade do fluxo de criação.
-- =============================================================================

CREATE TABLE public.instagram_company_settings (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_create_leads         BOOLEAN     NOT NULL DEFAULT false,
  allow_private_reply       BOOLEAN     NOT NULL DEFAULT true,
  default_assignee          UUID        REFERENCES auth.users(id),
  conversation_lock_minutes INT         NOT NULL DEFAULT 15,
  notify_on_new_dm          BOOLEAN     NOT NULL DEFAULT true,
  notify_on_new_comment     BOOLEAN     NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_igset_lock_minutes
    CHECK (conversation_lock_minutes BETWEEN 1 AND 120)
);

-- Trigger updated_at
CREATE TRIGGER update_instagram_company_settings_updated_at
  BEFORE UPDATE ON public.instagram_company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.instagram_company_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: membros e admin da empresa pai
CREATE POLICY "igset_select_member"
  ON public.instagram_company_settings
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE: somente service_role
