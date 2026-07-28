-- =====================================================
-- CATÁLOGO: novos campos de fornecedor, preço de custo e foto
-- Adiciona supplier_id, cost_price, supplier_product_code e
-- primary_image_url nas tabelas products e services.
-- =====================================================

-- -----------------------------------------------------------------
-- products
-- -----------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supplier_id            UUID         NULL
    REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_price             NUMERIC(15,2) NULL,
  ADD COLUMN IF NOT EXISTS supplier_product_code  VARCHAR(150)  NULL,
  ADD COLUMN IF NOT EXISTS primary_image_url      TEXT          NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_cost_price_nonneg;

ALTER TABLE products
  ADD CONSTRAINT products_cost_price_nonneg
  CHECK (cost_price IS NULL OR cost_price >= 0);

COMMENT ON COLUMN products.supplier_id           IS 'FK para tabela suppliers. Opcional — produto sem fornecedor é válido.';
COMMENT ON COLUMN products.cost_price            IS 'Preço de custo do produto (informativo, não afeta valor da oportunidade).';
COMMENT ON COLUMN products.supplier_product_code IS 'Código identificador do produto no catálogo do fornecedor.';
COMMENT ON COLUMN products.primary_image_url     IS 'URL pública da foto principal do produto (Supabase Storage).';

CREATE INDEX IF NOT EXISTS idx_products_supplier
  ON products (supplier_id) WHERE supplier_id IS NOT NULL;

-- -----------------------------------------------------------------
-- services
-- -----------------------------------------------------------------
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS supplier_id            UUID         NULL
    REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_price             NUMERIC(15,2) NULL,
  ADD COLUMN IF NOT EXISTS supplier_product_code  VARCHAR(150)  NULL,
  ADD COLUMN IF NOT EXISTS primary_image_url      TEXT          NULL;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_cost_price_nonneg;

ALTER TABLE services
  ADD CONSTRAINT services_cost_price_nonneg
  CHECK (cost_price IS NULL OR cost_price >= 0);

COMMENT ON COLUMN services.supplier_id           IS 'FK para tabela suppliers. Opcional.';
COMMENT ON COLUMN services.cost_price            IS 'Preço de custo do serviço (informativo).';
COMMENT ON COLUMN services.supplier_product_code IS 'Código identificador do serviço no catálogo do fornecedor.';
COMMENT ON COLUMN services.primary_image_url     IS 'URL pública da foto/imagem principal do serviço (Supabase Storage).';

CREATE INDEX IF NOT EXISTS idx_services_supplier
  ON services (supplier_id) WHERE supplier_id IS NOT NULL;
