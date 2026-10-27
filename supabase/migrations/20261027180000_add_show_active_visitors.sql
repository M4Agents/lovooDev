-- Flag por empresa: exibir ou ocultar o badge "visitantes ativos" no CRM.
-- Não altera tracking, gravação de visitors nem analytics.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS show_active_visitors boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.companies.show_active_visitors IS
  'Quando true, o CRM exibe o badge de visitantes ativos no canto da tela. Tracking continua independente.';
