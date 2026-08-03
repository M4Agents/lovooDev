-- =============================================================================
-- Nuvemshop Integration — Migration auxiliar (Fase 2)
-- Campos complementares em nuvemshop_connections
--
-- Adicionados na Fase 2 porque são preenchidos pelo callback OAuth
-- via GET /store da Nuvemshop.
-- =============================================================================

ALTER TABLE public.nuvemshop_connections
  ADD COLUMN IF NOT EXISTS plan_name      TEXT,
  ADD COLUMN IF NOT EXISTS store_whatsapp TEXT;
