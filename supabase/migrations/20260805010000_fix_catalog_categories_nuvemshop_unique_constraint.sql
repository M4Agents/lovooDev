-- =============================================================================
-- Correção: substituir partial index por UNIQUE constraint completa
--
-- Contexto:
--   O partial index (WHERE nuvemshop_category_id IS NOT NULL) não é compatível
--   com ON CONFLICT (company_id, nuvemshop_category_id) do Supabase JS.
--   PostgreSQL só aceita partial index no ON CONFLICT com a cláusula WHERE
--   explícita no SQL, que o Supabase JS não gera automaticamente.
--
-- Solução:
--   Trocar pelo constraint completo. NULLs são considerados distintos no
--   PostgreSQL, portanto múltiplas linhas com nuvemshop_category_id = NULL
--   são permitidas (comportamento correto para categorias manuais).
-- =============================================================================

-- 1. Remover o partial index existente
DROP INDEX IF EXISTS public.uq_catalog_categories_nuvemshop;

-- 2. Criar constraint completa
ALTER TABLE public.catalog_categories
  ADD CONSTRAINT uq_catalog_categories_nuvemshop
  UNIQUE (company_id, nuvemshop_category_id);
