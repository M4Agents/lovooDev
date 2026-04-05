-- =====================================================
-- CATÁLOGO: products, services, opportunity_items
-- OPORTUNIDADES: value_mode, items_subtotal, desconto global
-- EMPRESAS: opportunity_items_enabled (feature por tenant)
-- Multi-tenant, RLS por company_users, triggers de segurança
-- =====================================================

-- -----------------------------------------------------------------
-- 1) companies: feature flag
-- -----------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS opportunity_items_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.opportunity_items_enabled IS
  'Quando true e plano pro/enterprise, permite composição por itens (RPCs + UI).';

-- -----------------------------------------------------------------
-- 2) opportunities: modo de valor e desconto global
-- -----------------------------------------------------------------
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS value_mode VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS items_subtotal NUMERIC(15,2) NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(15,4) NULL;

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_value_mode_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_value_mode_check
  CHECK (value_mode IN ('manual', 'items'));

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_discount_type_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_discount_type_check
  CHECK (discount_type IS NULL OR discount_type IN ('fixed', 'percent'));

COMMENT ON COLUMN opportunities.value_mode IS 'manual | items — valor oficial em value; items usa linhas + desconto global.';
COMMENT ON COLUMN opportunities.items_subtotal IS 'Soma persistida de line_total quando value_mode=items; NULL em manual.';
COMMENT ON COLUMN opportunities.discount_type IS 'Desconto global na oportunidade (modo items): fixed | percent.';
COMMENT ON COLUMN opportunities.discount_value IS 'Valor do desconto global conforme discount_type.';

-- -----------------------------------------------------------------
-- 3) products
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  default_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  category VARCHAR(120) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  availability_status VARCHAR(30) NOT NULL DEFAULT 'available',
  stock_status VARCHAR(30) NOT NULL DEFAULT 'unknown',
  track_inventory BOOLEAN NOT NULL DEFAULT false,
  ai_notes TEXT NULL,
  available_for_ai BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_default_price_nonneg CHECK (default_price >= 0),
  CONSTRAINT products_availability_check CHECK (
    availability_status IN ('available', 'unavailable', 'on_demand', 'discontinued')
  ),
  CONSTRAINT products_stock_status_check CHECK (
    stock_status IN ('in_stock', 'out_of_stock', 'unknown', 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_company_active ON products(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_company_avail ON products(company_id, availability_status);

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE products IS 'Catálogo de produtos por empresa (composição de oportunidades).';
COMMENT ON COLUMN products.ai_notes IS 'Contexto interno para agente de IA; não exibir ao cliente final na UI pública.';

-- -----------------------------------------------------------------
-- 4) services
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  default_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  category VARCHAR(120) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  availability_status VARCHAR(30) NOT NULL DEFAULT 'available',
  stock_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable',
  track_inventory BOOLEAN NOT NULL DEFAULT false,
  ai_notes TEXT NULL,
  available_for_ai BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT services_default_price_nonneg CHECK (default_price >= 0),
  CONSTRAINT services_availability_check CHECK (
    availability_status IN ('available', 'unavailable', 'on_demand', 'discontinued')
  ),
  CONSTRAINT services_stock_status_check CHECK (
    stock_status IN ('in_stock', 'out_of_stock', 'unknown', 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS idx_services_company ON services(company_id);
CREATE INDEX IF NOT EXISTS idx_services_company_active ON services(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_services_company_avail ON services(company_id, availability_status);

CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE services IS 'Catálogo de serviços por empresa (composição de oportunidades).';

-- -----------------------------------------------------------------
-- 5) opportunity_items
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  product_id UUID NULL REFERENCES products(id) ON DELETE RESTRICT,
  service_id UUID NULL REFERENCES services(id) ON DELETE RESTRICT,
  line_type VARCHAR(20) NOT NULL,
  name_snapshot TEXT NOT NULL,
  description_snapshot TEXT NULL,
  unit_price NUMERIC(15,2) NOT NULL,
  quantity NUMERIC(15,4) NOT NULL,
  discount_type VARCHAR(20) NOT NULL,
  discount_value NUMERIC(15,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_items_line_xor CHECK (
    (product_id IS NOT NULL AND service_id IS NULL)
    OR (product_id IS NULL AND service_id IS NOT NULL)
  ),
  CONSTRAINT opportunity_items_line_type_check CHECK (line_type IN ('product', 'service')),
  CONSTRAINT opportunity_items_discount_type_check CHECK (discount_type IN ('fixed', 'percent')),
  CONSTRAINT opportunity_items_quantity_pos CHECK (quantity > 0),
  CONSTRAINT opportunity_items_unit_price_nonneg CHECK (unit_price >= 0),
  CONSTRAINT opportunity_items_line_total_nonneg CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_opp_items_company_opp ON opportunity_items(company_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_items_opportunity ON opportunity_items(opportunity_id);

COMMENT ON TABLE opportunity_items IS 'Linhas de composição de valor; snapshot obrigatório; cálculos via RPC.';

CREATE TRIGGER update_opportunity_items_updated_at
  BEFORE UPDATE ON opportunity_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------
-- 6) RLS
-- -----------------------------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select ON products FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY products_update ON products FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY products_delete ON products FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

CREATE POLICY services_select ON services FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY services_insert ON services FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY services_update ON services FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY services_delete ON services FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

CREATE POLICY opportunity_items_select ON opportunity_items FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY opportunity_items_insert ON opportunity_items FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY opportunity_items_update ON opportunity_items FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY opportunity_items_delete ON opportunity_items FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

-- -----------------------------------------------------------------
-- 7) Triggers de segurança (tenant / FK)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_opportunity_items_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp_company UUID;
  v_pc UUID;
  v_sc UUID;
BEGIN
  SELECT company_id INTO v_opp_company FROM opportunities WHERE id = NEW.opportunity_id;
  IF v_opp_company IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Oportunidade inválida.', HINT = 'OPP_OPPORTUNITY_ACCESS_DENIED';
  END IF;
  IF v_opp_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION USING MESSAGE = 'O item não pertence a esta empresa.', HINT = 'OPP_ITEM_COMPANY_MISMATCH';
  END IF;

  IF NEW.product_id IS NOT NULL THEN
    SELECT company_id INTO v_pc FROM products WHERE id = NEW.product_id;
    IF v_pc IS NULL OR v_pc IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION USING MESSAGE = 'O produto ou serviço não pertence a esta empresa.', HINT = 'OPP_CATALOG_COMPANY_MISMATCH';
    END IF;
  END IF;

  IF NEW.service_id IS NOT NULL THEN
    SELECT company_id INTO v_sc FROM services WHERE id = NEW.service_id;
    IF v_sc IS NULL OR v_sc IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION USING MESSAGE = 'O produto ou serviço não pertence a esta empresa.', HINT = 'OPP_CATALOG_COMPANY_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_items_company ON opportunity_items;
CREATE TRIGGER trg_opportunity_items_company
  BEFORE INSERT OR UPDATE ON opportunity_items
  FOR EACH ROW EXECUTE FUNCTION trg_validate_opportunity_items_company();
