-- =====================================================
-- Relacionamentos do catálogo (alternativa / complementar)
-- Multi-tenant, RLS, XOR origem/destino, índices únicos parciais
-- =====================================================

DO $$ BEGIN
  CREATE TYPE catalog_relation_type AS ENUM ('alternative', 'addon');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS catalog_item_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  relation_type catalog_relation_type NOT NULL,
  source_product_id UUID NULL REFERENCES products(id) ON DELETE CASCADE,
  source_service_id UUID NULL REFERENCES services(id) ON DELETE CASCADE,
  target_product_id UUID NULL REFERENCES products(id) ON DELETE CASCADE,
  target_service_id UUID NULL REFERENCES services(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_rel_source_xor CHECK (
    (source_product_id IS NOT NULL AND source_service_id IS NULL)
    OR (source_product_id IS NULL AND source_service_id IS NOT NULL)
  ),
  CONSTRAINT catalog_rel_target_xor CHECK (
    (target_product_id IS NOT NULL AND target_service_id IS NULL)
    OR (target_product_id IS NULL AND target_service_id IS NOT NULL)
  ),
  CONSTRAINT catalog_rel_no_self CHECK (
    NOT (
      (source_product_id IS NOT NULL AND target_product_id IS NOT NULL
       AND source_product_id = target_product_id
       AND source_service_id IS NULL AND target_service_id IS NULL)
      OR
      (source_service_id IS NOT NULL AND target_service_id IS NOT NULL
       AND source_service_id = target_service_id
       AND source_product_id IS NULL AND target_product_id IS NULL)
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_rel_src_prod
  ON catalog_item_relations (company_id, source_product_id, relation_type)
  WHERE source_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_rel_src_svc
  ON catalog_item_relations (company_id, source_service_id, relation_type)
  WHERE source_service_id IS NOT NULL;

-- Unicidade: mesmo par origem → destino por empresa e tipo (4 combinações XOR)
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_rel_pp
  ON catalog_item_relations (company_id, relation_type, source_product_id, target_product_id)
  WHERE source_product_id IS NOT NULL AND source_service_id IS NULL
    AND target_product_id IS NOT NULL AND target_service_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_rel_ps
  ON catalog_item_relations (company_id, relation_type, source_product_id, target_service_id)
  WHERE source_product_id IS NOT NULL AND source_service_id IS NULL
    AND target_product_id IS NULL AND target_service_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_rel_sp
  ON catalog_item_relations (company_id, relation_type, source_service_id, target_product_id)
  WHERE source_service_id IS NOT NULL AND source_product_id IS NULL
    AND target_product_id IS NOT NULL AND target_service_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_rel_ss
  ON catalog_item_relations (company_id, relation_type, source_service_id, target_service_id)
  WHERE source_service_id IS NOT NULL AND source_product_id IS NULL
    AND target_product_id IS NULL AND target_service_id IS NOT NULL;

COMMENT ON TABLE catalog_item_relations IS
  'Grafo produto/serviço por tenant: alternative (substituto) ou addon (complemento). Filtros de IA/disponibilidade no consumo.';

DROP TRIGGER IF EXISTS update_catalog_item_relations_updated_at ON catalog_item_relations;
CREATE TRIGGER update_catalog_item_relations_updated_at
  BEFORE UPDATE ON catalog_item_relations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------
-- Trigger: coerência de company_id com origem/destino (sem regra comercial)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_catalog_item_relations_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sp UUID;
  v_ss UUID;
  v_tp UUID;
  v_ts UUID;
BEGIN
  IF NEW.source_product_id IS NOT NULL THEN
    SELECT company_id INTO v_sp FROM products WHERE id = NEW.source_product_id;
    IF v_sp IS NULL THEN
      RAISE EXCEPTION 'Produto de origem inválido.';
    END IF;
    IF v_sp IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Produto de origem não pertence à empresa da relação.';
    END IF;
  END IF;

  IF NEW.source_service_id IS NOT NULL THEN
    SELECT company_id INTO v_ss FROM services WHERE id = NEW.source_service_id;
    IF v_ss IS NULL THEN
      RAISE EXCEPTION 'Serviço de origem inválido.';
    END IF;
    IF v_ss IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Serviço de origem não pertence à empresa da relação.';
    END IF;
  END IF;

  IF NEW.target_product_id IS NOT NULL THEN
    SELECT company_id INTO v_tp FROM products WHERE id = NEW.target_product_id;
    IF v_tp IS NULL THEN
      RAISE EXCEPTION 'Produto de destino inválido.';
    END IF;
    IF v_tp IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Produto de destino não pertence à empresa da relação.';
    END IF;
  END IF;

  IF NEW.target_service_id IS NOT NULL THEN
    SELECT company_id INTO v_ts FROM services WHERE id = NEW.target_service_id;
    IF v_ts IS NULL THEN
      RAISE EXCEPTION 'Serviço de destino inválido.';
    END IF;
    IF v_ts IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Serviço de destino não pertence à empresa da relação.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_item_relations_company ON catalog_item_relations;
CREATE TRIGGER trg_catalog_item_relations_company
  BEFORE INSERT OR UPDATE ON catalog_item_relations
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_item_relations_company();

-- -----------------------------------------------------------------
-- RLS (mesmo padrão de products/services)
-- -----------------------------------------------------------------
ALTER TABLE catalog_item_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_item_relations_select ON catalog_item_relations;
DROP POLICY IF EXISTS catalog_item_relations_insert ON catalog_item_relations;
DROP POLICY IF EXISTS catalog_item_relations_update ON catalog_item_relations;
DROP POLICY IF EXISTS catalog_item_relations_delete ON catalog_item_relations;

CREATE POLICY catalog_item_relations_select ON catalog_item_relations FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_relations_insert ON catalog_item_relations FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_relations_update ON catalog_item_relations FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_relations_delete ON catalog_item_relations FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

-- -----------------------------------------------------------------
-- RPC: leitura consolidada por origem (SECURITY INVOKER — respeita RLS)
-- Consumidor (frontend/agente) aplica filtros is_active / available_for_ai / availability em seguida.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_catalog_relations_for_source(
  p_company_id UUID,
  p_source_type TEXT,
  p_source_id UUID,
  p_relation_type catalog_relation_type
)
RETURNS TABLE (
  relation_id UUID,
  sort_order INT,
  target_kind TEXT,
  target_id UUID,
  name TEXT,
  description TEXT,
  availability_status TEXT,
  is_active BOOLEAN,
  available_for_ai BOOLEAN,
  default_price NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.id AS relation_id,
    r.sort_order,
    CASE WHEN r.target_product_id IS NOT NULL THEN 'product' ELSE 'service' END AS target_kind,
    COALESCE(r.target_product_id, r.target_service_id) AS target_id,
    COALESCE(p.name, s.name)::TEXT AS name,
    COALESCE(p.description, s.description)::TEXT AS description,
    COALESCE(p.availability_status, s.availability_status)::TEXT AS availability_status,
    COALESCE(p.is_active, s.is_active) AS is_active,
    COALESCE(p.available_for_ai, s.available_for_ai) AS available_for_ai,
    COALESCE(p.default_price, s.default_price) AS default_price
  FROM catalog_item_relations r
  LEFT JOIN products p ON p.id = r.target_product_id
  LEFT JOIN services s ON s.id = r.target_service_id
  WHERE r.company_id = p_company_id
    AND r.relation_type = p_relation_type
    AND (
      (p_source_type = 'product' AND r.source_product_id = p_source_id AND r.source_service_id IS NULL)
      OR (p_source_type = 'service' AND r.source_service_id = p_source_id AND r.source_product_id IS NULL)
    )
  ORDER BY r.sort_order ASC, r.created_at ASC;
$$;

COMMENT ON FUNCTION list_catalog_relations_for_source IS
  'Lista relações a partir de um item de origem com dados do destino. Menor sort_order = maior prioridade. Filtros comerciais/IA no consumidor.';

GRANT USAGE ON TYPE catalog_relation_type TO authenticated;

GRANT EXECUTE ON FUNCTION list_catalog_relations_for_source(UUID, TEXT, UUID, catalog_relation_type) TO authenticated;
