-- =============================================================================
-- Múltiplas categorias internas por produto
--
-- category_ids uuid[]: array com todos os UUIDs internos de catalog_categories
--   vinculados ao produto via nuvemshop_categories JSONB.
--
-- Complementa (não substitui) category_id:
--   category_id  = UUID da primeira categoria-raiz encontrada (tipo do produto)
--   category_ids = todos os UUIDs resolvidos (raiz + subcategorias)
--
-- O agente de IA usa category_ids para identificar tipo + atributos do produto.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_ids uuid[];

-- Índice GIN para buscas eficientes por categoria
CREATE INDEX IF NOT EXISTS idx_products_category_ids
  ON public.products USING GIN (category_ids)
  WHERE category_ids IS NOT NULL;
