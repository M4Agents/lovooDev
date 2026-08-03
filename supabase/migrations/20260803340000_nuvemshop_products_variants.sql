-- =============================================================================
-- Nuvemshop Integration — Migration Fase 6
-- Produtos e Variantes
--
-- 1. Adiciona coluna nuvemshop_variants (JSONB) à tabela products.
--    Armazena array normalizado de variantes da Nuvemshop.
--    Estrutura de cada variante:
--      { id, sku, price, promotional_price, stock_management, stock,
--        attributes, weight, position }
--
-- 2. Valida e adiciona UNIQUE(company_id, external_source, external_id) em products.
--    IMPORTANTE: Antes de criar a constraint, verifica se existem tuplas duplicadas.
--    Se houver duplicatas, a migration falha com mensagem clara — NÃO silencia dados.
--
--    Semântica NULL: NULL != NULL em SQL → produtos internos (external_id IS NULL)
--    não conflitam entre si. A constraint é segura para dados existentes sem external_id.
--
-- ── Validação de duplicidades ─────────────────────────────────────────────────
-- Executar antes de aplicar em ambiente com dados:
--   SELECT company_id, external_source, external_id, COUNT(*)
--   FROM products
--   WHERE external_source IS NOT NULL AND external_id IS NOT NULL
--   GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;
-- Se retornar linhas, investigar antes de prosseguir.
-- =============================================================================

-- 1. Coluna nuvemshop_variants
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS nuvemshop_variants JSONB;

COMMENT ON COLUMN public.products.nuvemshop_variants IS
  'Array normalizado de variantes da Nuvemshop. Cada elemento: {id, sku, price, promotional_price, stock_management, stock, attributes, weight, position}. Campo ''id'' preservado para localização por variant_id em opportunity_items (Fase 8+).';

-- 2. Verificar duplicidades antes de criar a constraint
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT company_id, external_source, external_id
    FROM public.products
    WHERE external_source IS NOT NULL
      AND external_id IS NOT NULL
    GROUP BY company_id, external_source, external_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'BLOQUEADO: Existem % grupo(s) de produtos com (company_id, external_source, external_id) duplicados. '
      'Resolver antes de aplicar a constraint UNIQUE. '
      'Query de diagnóstico: SELECT company_id, external_source, external_id, COUNT(*) '
      'FROM products WHERE external_source IS NOT NULL AND external_id IS NOT NULL '
      'GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;',
      v_dup_count;
  END IF;

  RAISE NOTICE 'Sem duplicidades em (company_id, external_source, external_id). Constraint segura para criar.';
END $$;

-- 3. Constraint única para upsert externo
ALTER TABLE public.products
  ADD CONSTRAINT uq_products_external
    UNIQUE (company_id, external_source, external_id);

-- 4. Índice GIN para queries em variantes Nuvemshop
CREATE INDEX IF NOT EXISTS idx_products_nuvemshop_variants
  ON public.products USING GIN (nuvemshop_variants)
  WHERE external_source = 'nuvemshop' AND nuvemshop_variants IS NOT NULL;
