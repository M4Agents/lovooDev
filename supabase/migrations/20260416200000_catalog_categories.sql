-- =====================================================
-- CATALOG CATEGORIES
-- Categorias opcionais para produtos e serviços.
-- Multi-tenant: RLS por company_id.
-- Trigger valida cross-tenant antes de vincular.
-- Remove campo legado category TEXT de products/services.
-- =====================================================

-- -----------------------------------------------------------------
-- 1) Tabela catalog_categories
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_categories_type_check CHECK (type IN ('product', 'service')),
  CONSTRAINT uq_catalog_category_name UNIQUE (company_id, type, name)
);

CREATE TRIGGER update_catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE catalog_categories IS
  'Categorias opcionais por empresa para organizar produtos e serviços. Isolamento por company_id + RLS.';

-- -----------------------------------------------------------------
-- 2) Índices
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_catalog_categories_company_type
  ON catalog_categories (company_id, type, sort_order)
  WHERE is_active = true;

-- -----------------------------------------------------------------
-- 3) RLS
-- -----------------------------------------------------------------
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_categories_select ON catalog_categories FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_categories_insert ON catalog_categories FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_categories_update ON catalog_categories FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_categories_delete ON catalog_categories FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

-- -----------------------------------------------------------------
-- 4) FK category_id em products e services (ADD antes do DROP)
-- -----------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id UUID NULL
  REFERENCES catalog_categories(id) ON DELETE SET NULL;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS category_id UUID NULL
  REFERENCES catalog_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id
  ON products (category_id) WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_category_id
  ON services (category_id) WHERE category_id IS NOT NULL;

-- -----------------------------------------------------------------
-- 5) Trigger de integridade cross-tenant
--    Valida que a categoria pertence à mesma empresa e ao tipo correto.
--    SECURITY INVOKER — respeita RLS do chamador.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_catalog_category_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cat_company UUID;
  v_cat_type    TEXT;
  v_expected    TEXT;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id, type
    INTO v_cat_company, v_cat_type
    FROM catalog_categories
   WHERE id = NEW.category_id;

  IF v_cat_company IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Categoria não encontrada.',
      HINT = 'CATALOG_CATEGORY_NOT_FOUND';
  END IF;

  IF v_cat_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'A categoria não pertence a esta empresa.',
      HINT = 'CATALOG_CATEGORY_COMPANY_MISMATCH';
  END IF;

  -- Determina o tipo esperado com base na tabela sendo modificada
  v_expected := TG_TABLE_NAME::TEXT;
  -- products → 'product', services → 'service'
  IF v_expected = 'products' THEN
    v_expected := 'product';
  ELSE
    v_expected := 'service';
  END IF;

  IF v_cat_type IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Tipo da categoria incompatível com o item.',
      HINT = 'CATALOG_CATEGORY_TYPE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_category_company ON products;
CREATE TRIGGER trg_products_category_company
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_category_company();

DROP TRIGGER IF EXISTS trg_services_category_company ON services;
CREATE TRIGGER trg_services_category_company
  BEFORE INSERT OR UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_category_company();

-- -----------------------------------------------------------------
-- 6) Remover campo legado category TEXT
--    Nunca foi exposto na UI nem preenchido pela aplicação.
--    Executado APÓS criação do category_id.
-- -----------------------------------------------------------------
ALTER TABLE products  DROP COLUMN IF EXISTS category;
ALTER TABLE services  DROP COLUMN IF EXISTS category;
