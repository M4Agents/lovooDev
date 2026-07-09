-- Motor de Ciclos — E4: registra timestamp da última resposta inbound do cliente
-- Campo semanticamente distinto de last_contact_attempt_at (que é outbound)
-- Coluna nullable, sem DEFAULT, sem impacto em registros existentes

ALTER TABLE public.opportunity_funnel_positions
  ADD COLUMN IF NOT EXISTS last_customer_reply_at TIMESTAMPTZ;

-- Rollback:
-- ALTER TABLE public.opportunity_funnel_positions
--   DROP COLUMN IF EXISTS last_customer_reply_at;
