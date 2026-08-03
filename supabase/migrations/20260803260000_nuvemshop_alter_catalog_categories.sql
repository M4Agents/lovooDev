-- =============================================================================
-- Nuvemshop Integration — Migration R4/6 (revisão fundação)
-- Alterações estruturais: tabela catalog_categories
--
-- Adiciona campos de integração Nuvemshop à categoria.
-- Todos os campos são nullable — sem impacto em dados existentes.
--
-- deleted_at é adicionado para suportar soft delete na reconciliação:
--   - Categorias removidas na Nuvemshop recebem deleted_at = now()
--   - is_active = false
--   - nuvemshop_sync_status = 'deleted'
--   - O dado histórico é preservado (nunca exclusão física por reconciliação)
--   - Se a categoria reaparecer: deleted_at = NULL, is_active = true, status = 'synced'
-- =============================================================================

ALTER TABLE public.catalog_categories
  ADD COLUMN IF NOT EXISTS nuvemshop_category_id  TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_store_id      TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_sync_status   TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at              TIMESTAMPTZ;

ALTER TABLE public.catalog_categories
  ADD CONSTRAINT chk_cat_nuvemshop_sync_status
    CHECK (nuvemshop_sync_status IS NULL OR nuvemshop_sync_status IN ('synced', 'pending', 'error', 'deleted'));

-- Índices
CREATE INDEX IF NOT EXISTS idx_catcat_nuvemshop_category
  ON public.catalog_categories(company_id, nuvemshop_category_id)
  WHERE nuvemshop_category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catcat_nuvemshop_sync_status
  ON public.catalog_categories(company_id, nuvemshop_sync_status)
  WHERE nuvemshop_sync_status IS NOT NULL;

-- Índice para excluir deletados de queries de listagem ativa
CREATE INDEX IF NOT EXISTS idx_catcat_not_deleted
  ON public.catalog_categories(company_id, is_active)
  WHERE deleted_at IS NULL;
