-- =============================================================================
-- Hierarquia de categorias Nuvemshop
--
-- nuvemshop_parent_id: ID externo da categoria-pai (string, como vem da API)
-- parent_id:           UUID interno da categoria-pai neste banco
--
-- Ambas são nullable:
--   - null = categoria raiz (tipo de produto: Anéis, Pulseiras, Colar...)
--   - preenchido = subcategoria (material, estilo, linha...)
-- =============================================================================

ALTER TABLE public.catalog_categories
  ADD COLUMN IF NOT EXISTS nuvemshop_parent_id text,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.catalog_categories(id) ON DELETE SET NULL;

-- Índice para navegação na árvore e listagem de filhos por pai
CREATE INDEX IF NOT EXISTS idx_catalog_categories_parent
  ON public.catalog_categories (company_id, parent_id)
  WHERE parent_id IS NOT NULL;

-- Índice para resolver parent_id a partir do nuvemshop_parent_id
CREATE INDEX IF NOT EXISTS idx_catalog_categories_ns_parent
  ON public.catalog_categories (company_id, nuvemshop_parent_id)
  WHERE nuvemshop_parent_id IS NOT NULL;
