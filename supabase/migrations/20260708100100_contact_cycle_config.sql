-- Motor de Ciclos: configuração por empresa + colunas de estado em opportunity_funnel_positions
-- Tabela: company_contact_cycle_config (uma linha por empresa)
-- Colunas adicionadas: campos de estado do ciclo em opportunity_funnel_positions

-- 1. Tabela de configuração do ciclo de contato por empresa
CREATE TABLE public.company_contact_cycle_config (
  company_id           UUID        NOT NULL PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled              BOOLEAN     NOT NULL DEFAULT false,
  eligibility_rule     TEXT        NOT NULL DEFAULT 'hours'
                         CHECK (eligibility_rule IN ('hours', 'day_change', 'both')),
  eligibility_hours    INTEGER     NOT NULL DEFAULT 4 CHECK (eligibility_hours > 0),
  show_extra_questions BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RLS
ALTER TABLE public.company_contact_cycle_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_config_select ON public.company_contact_cycle_config
  FOR SELECT USING (auth_user_is_company_member(company_id));

CREATE POLICY cycle_config_insert ON public.company_contact_cycle_config
  FOR INSERT WITH CHECK (auth_user_is_company_admin(company_id));

CREATE POLICY cycle_config_update ON public.company_contact_cycle_config
  FOR UPDATE USING (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- 3. Trigger updated_at
CREATE OR REPLACE FUNCTION public._trg_set_updated_at_contact_cycle_config()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_contact_cycle_config_updated_at
  BEFORE UPDATE ON public.company_contact_cycle_config
  FOR EACH ROW EXECUTE FUNCTION public._trg_set_updated_at_contact_cycle_config();

-- 4. Colunas de estado do ciclo em opportunity_funnel_positions
ALTER TABLE public.opportunity_funnel_positions
  ADD COLUMN IF NOT EXISTS contact_attempts_state    TEXT        DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS current_contact_cycle_id  UUID,
  ADD COLUMN IF NOT EXISTS contact_cycle_opened_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_contact_attempts    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_contact_attempt_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eligible_for_new_cycle_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_cycle_close_reason   TEXT;
