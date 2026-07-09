-- Motor de Ciclos: tabela de ciclos de tentativa de contato
-- Um ciclo representa um período ativo de tentativas para uma oportunidade

CREATE TABLE public.contact_attempt_cycles (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_id UUID        NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  opened_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  close_reason   TEXT,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);

-- Garante que só exista um ciclo aberto por oportunidade
CREATE UNIQUE INDEX uq_one_open_cycle_per_opportunity
  ON public.contact_attempt_cycles (opportunity_id)
  WHERE status = 'open';

-- Índices de suporte
CREATE INDEX idx_cycles_opportunity
  ON public.contact_attempt_cycles (opportunity_id, opened_at DESC);

CREATE INDEX idx_cycles_company_status
  ON public.contact_attempt_cycles (company_id, status);

-- RLS
ALTER TABLE public.contact_attempt_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycles_select ON public.contact_attempt_cycles
  FOR SELECT USING (auth_user_is_company_member(company_id));
