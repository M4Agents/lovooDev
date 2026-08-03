-- =============================================================================
-- Nuvemshop Integration — Migration R2/6 (revisão fundação)
-- Alterações estruturais: tabela opportunities
--
-- Adiciona campos de integração Nuvemshop à oportunidade.
-- Todos os campos são nullable — sem impacto em dados existentes.
-- Sem regras de negócio: apenas estrutura.
--
-- nuvemshop_order_number é TEXT (não INT) para compatibilidade com
-- formatos que possam conter letras ou prefixos no futuro.
-- =============================================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS nuvemshop_order_id      TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_store_id      TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_order_number  TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_sync_status   TEXT;

ALTER TABLE public.opportunities
  ADD CONSTRAINT chk_opps_nuvemshop_sync_status
    CHECK (nuvemshop_sync_status IS NULL OR nuvemshop_sync_status IN ('synced', 'pending', 'error', 'deleted'));

-- Índices para lookups por integração
CREATE INDEX IF NOT EXISTS idx_opps_nuvemshop_order
  ON public.opportunities(company_id, nuvemshop_order_id)
  WHERE nuvemshop_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opps_nuvemshop_sync_status
  ON public.opportunities(company_id, nuvemshop_sync_status)
  WHERE nuvemshop_sync_status IS NOT NULL;
