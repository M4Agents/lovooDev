-- Motor de Ciclos: tabela de eventos da timeline de oportunidade
-- Registra todos os eventos relevantes do ciclo de contato para auditoria e exibição

CREATE TABLE public.opportunity_timeline_events (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_id UUID        NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  actor_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_timeline_events_opportunity
  ON public.opportunity_timeline_events (opportunity_id, created_at DESC);

CREATE INDEX idx_timeline_events_company_type
  ON public.opportunity_timeline_events (company_id, event_type);

-- RLS
ALTER TABLE public.opportunity_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY timeline_events_select ON public.opportunity_timeline_events
  FOR SELECT USING (auth_user_is_company_member(company_id));
