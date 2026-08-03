-- =============================================================================
-- Nuvemshop Integration — Migration R3/6 (revisão fundação)
-- Alterações estruturais: tabela products
--
-- A tabela products já possui um padrão genérico de integração externa:
--   external_source TEXT  → valor: 'nuvemshop'
--   external_id     TEXT  → valor: nuvemshop_product_id (ID externo do produto)
--   external_reference TEXT → valor: livre (ex: SKU, barcode)
--
-- Para Nuvemshop, usaremos esse padrão existente e adicionaremos
-- apenas os campos específicos que ele não cobre:
--   nuvemshop_store_id    → identifica a loja de origem (necessário para multi-loja futura)
--   nuvemshop_sync_status → estado de sincronização Nuvemshop
--
-- NÃO foi adicionado nuvemshop_product_id para evitar duplicação
-- com external_id. Mapeamento: external_source='nuvemshop', external_id=<id_externo>.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS nuvemshop_store_id    TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_sync_status TEXT;

ALTER TABLE public.products
  ADD CONSTRAINT chk_products_nuvemshop_sync_status
    CHECK (nuvemshop_sync_status IS NULL OR nuvemshop_sync_status IN ('synced', 'pending', 'error', 'deleted'));

-- Índice para lookups por produto Nuvemshop (usa padrão existente external_source+external_id)
CREATE INDEX IF NOT EXISTS idx_products_nuvemshop_external
  ON public.products(company_id, external_id)
  WHERE external_source = 'nuvemshop' AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_nuvemshop_sync_status
  ON public.products(company_id, nuvemshop_sync_status)
  WHERE nuvemshop_sync_status IS NOT NULL;
