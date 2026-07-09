-- Motor de Ciclos: adiciona coluna track_contact_attempts em funnel_stages
-- Controla quais etapas do funil habilitam rastreamento de tentativas de contato

ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS track_contact_attempts BOOLEAN NOT NULL DEFAULT false;
