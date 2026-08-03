-- =============================================================================
-- Nuvemshop Integration — Migration (Fase 5: Categorias)
-- Constraint único para upsert por chave externa Nuvemshop
--
-- O upsert de categorias sincronizadas precisa de uma constraint única em
-- (company_id, nuvemshop_category_id) para que o ON CONFLICT funcione
-- corretamente e substitua a abordagem de SELECT + INSERT/UPDATE manual.
--
-- Também adiciona nuvemshop_store_id como NOT NULL quando nuvemshop_category_id
-- estiver preenchido (garantido via trigger — não aplicável aqui por simples
-- constraint CHECK numa fase futura).
-- =============================================================================

-- Unique constraint para o upsert: chave Nuvemshop por empresa
ALTER TABLE public.catalog_categories
  ADD CONSTRAINT uq_cat_nuvemshop_category
    UNIQUE (company_id, nuvemshop_category_id);

-- Índice auxiliar já existe (criado em 20260803260000), mas garantir
CREATE INDEX IF NOT EXISTS idx_catcat_nuvemshop_store
  ON public.catalog_categories(company_id, nuvemshop_store_id)
  WHERE nuvemshop_store_id IS NOT NULL;
