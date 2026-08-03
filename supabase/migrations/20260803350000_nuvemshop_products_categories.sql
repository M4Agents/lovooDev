-- =============================================================================
-- Nuvemshop Integration — Migration Fase 6 (ajuste)
-- Preservação de todas as categorias do produto
--
-- A Nuvemshop associa um produto a múltiplas categorias.
-- A coluna category_id em products só comporta uma FK (categoria principal).
-- Para preservar todos os vínculos de categorias retornados pela Nuvemshop:
--
--   nuvemshop_categories JSONB → array de nuvemshop_category_id (strings)
--
-- Uso:
--   - Rastrear todas as categorias do produto na Nuvemshop
--   - Permitir que a reconciliação (Fase 16) atualize category_id caso a
--     categoria principal ainda não estivesse sincronizada na época do upsert
--   - Não substitui category_id; é complementar
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS nuvemshop_categories JSONB;

COMMENT ON COLUMN public.products.nuvemshop_categories IS
  'Array de nuvemshop_category_id (strings) de todas as categorias associadas ao produto na Nuvemshop. '
  'Permite rastreabilidade completa e reconciliação por Fase 16. '
  'category_id (FK) contém apenas a categoria principal já sincronizada.';

-- Índice para queries de reconciliação (localizar produtos por categoria Nuvemshop)
CREATE INDEX IF NOT EXISTS idx_products_nuvemshop_categories
  ON public.products USING GIN (nuvemshop_categories)
  WHERE external_source = 'nuvemshop' AND nuvemshop_categories IS NOT NULL;
