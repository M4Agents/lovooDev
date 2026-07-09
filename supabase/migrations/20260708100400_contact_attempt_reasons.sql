-- Motor de Ciclos: tabela de motivos de tentativa de contato
-- Motivos configuráveis por empresa para classificar tentativas

CREATE TABLE public.contact_attempt_reasons (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice de suporte
CREATE INDEX idx_reasons_company
  ON public.contact_attempt_reasons (company_id, active);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public._trg_set_updated_at_attempt_reasons()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_attempt_reasons_updated_at
  BEFORE UPDATE ON public.contact_attempt_reasons
  FOR EACH ROW EXECUTE FUNCTION public._trg_set_updated_at_attempt_reasons();

-- RLS
ALTER TABLE public.contact_attempt_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY reasons_select ON public.contact_attempt_reasons
  FOR SELECT USING (auth_user_is_company_member(company_id));

CREATE POLICY reasons_insert ON public.contact_attempt_reasons
  FOR INSERT WITH CHECK (auth_user_is_company_admin(company_id));

CREATE POLICY reasons_update ON public.contact_attempt_reasons
  FOR UPDATE USING (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));
