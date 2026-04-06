-- =====================================================
-- CAMPOS DE INTEGRAÇÃO EXTERNA: products e services
-- external_source, external_id, external_reference
-- Opcionais, nullable, sem constraint única por ora.
-- =====================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS external_source    TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_id        TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_reference TEXT NULL;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS external_source    TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_id        TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_reference TEXT NULL;

COMMENT ON COLUMN products.external_source    IS 'Identificador do sistema externo (ex: shopify, bling, tiny).';
COMMENT ON COLUMN products.external_id        IS 'ID do item no sistema externo.';
COMMENT ON COLUMN products.external_reference IS 'Referência livre (SKU, slug, código interno externo).';

COMMENT ON COLUMN services.external_source    IS 'Identificador do sistema externo (ex: shopify, bling, tiny).';
COMMENT ON COLUMN services.external_id        IS 'ID do item no sistema externo.';
COMMENT ON COLUMN services.external_reference IS 'Referência livre (SKU, slug, código interno externo).';
