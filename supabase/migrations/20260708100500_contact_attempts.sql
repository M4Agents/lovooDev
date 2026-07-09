-- Motor de Ciclos: tabela de tentativas de contato individuais
-- Cada linha representa uma tentativa dentro de um ciclo

CREATE TABLE public.contact_attempts (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id              UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_id          UUID        NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  cycle_id                UUID        NOT NULL REFERENCES public.contact_attempt_cycles(id) ON DELETE CASCADE,
  actor_id                UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_reason          TEXT        NOT NULL
                            CHECK (trigger_reason IN ('manual', 'whatsapp_sent', 'whatsapp_received', 'system')),
  reason_id               UUID        REFERENCES public.contact_attempt_reasons(id) ON DELETE SET NULL,
  global_attempt_number   INTEGER     NOT NULL,
  attempt_number_in_cycle INTEGER     NOT NULL,
  lead_id                 INTEGER,
  funnel_stage_id         UUID        REFERENCES public.funnel_stages(id) ON DELETE SET NULL,
  whatsapp_message_id     TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at            TIMESTAMPTZ
);

-- Índices de suporte
CREATE INDEX idx_attempts_opportunity
  ON public.contact_attempts (opportunity_id, created_at DESC);

CREATE INDEX idx_attempts_cycle
  ON public.contact_attempts (cycle_id);

CREATE INDEX idx_attempts_actor
  ON public.contact_attempts (actor_id, created_at DESC);

CREATE INDEX idx_attempts_company_created
  ON public.contact_attempts (company_id, created_at DESC);

-- RLS
ALTER TABLE public.contact_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY attempts_select ON public.contact_attempts
  FOR SELECT USING (auth_user_is_company_member(company_id));
