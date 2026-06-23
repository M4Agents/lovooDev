-- =====================================================
-- Migration: sale_types + opportunity_sale_types
-- Objetivo: Gerenciar tipos de venda por empresa e
--           vinculá-los a oportunidades fechadas como won.
-- Multi-tenant: isolamento por company_id em todas as tabelas.
-- =====================================================

-- ─── Tabela sale_types ───────────────────────────────
CREATE TABLE IF NOT EXISTS sale_types (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT        NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_types_company_active
  ON sale_types (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sale_types_company_sort
  ON sale_types (company_id, sort_order);

COMMENT ON TABLE sale_types IS
  'Tipos de venda configurados por empresa. Vinculáveis a oportunidades no fechamento como won.';

-- Trigger updated_at
CREATE TRIGGER trg_sale_types_updated_at
  BEFORE UPDATE ON sale_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE sale_types ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa
CREATE POLICY sale_types_select ON sale_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
  );

-- INSERT: admin, super_admin, system_admin
CREATE POLICY sale_types_insert ON sale_types
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
  );

-- UPDATE: admin, super_admin, system_admin
CREATE POLICY sale_types_update ON sale_types
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
  );

-- DELETE: admin, super_admin, system_admin
CREATE POLICY sale_types_delete ON sale_types
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
  );


-- ─── Tabela opportunity_sale_types ───────────────────
CREATE TABLE IF NOT EXISTS opportunity_sale_types (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id  UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  sale_type_id    UUID        NOT NULL REFERENCES sale_types(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT opportunity_sale_types_unique UNIQUE (opportunity_id, sale_type_id)
);

CREATE INDEX IF NOT EXISTS idx_opp_sale_types_company_opp
  ON opportunity_sale_types (company_id, opportunity_id);

CREATE INDEX IF NOT EXISTS idx_opp_sale_types_company_type
  ON opportunity_sale_types (company_id, sale_type_id);

COMMENT ON TABLE opportunity_sale_types IS
  'Vínculo N:N entre oportunidades e tipos de venda. Criado via RPC opportunity_add_sale_type.';

COMMENT ON COLUMN opportunity_sale_types.sale_type_id IS
  'ON DELETE RESTRICT: tipos usados historicamente não podem ser excluídos — apenas desativados.';

-- Trigger de validação de company_id (consistência multi-tenant)
CREATE OR REPLACE FUNCTION trg_validate_opp_sale_types_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_opp_company UUID;
  v_type_company UUID;
BEGIN
  SELECT company_id INTO v_opp_company
    FROM opportunities WHERE id = NEW.opportunity_id;

  SELECT company_id INTO v_type_company
    FROM sale_types WHERE id = NEW.sale_type_id;

  IF v_opp_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'company_id inconsistente: oportunidade pertence a empresa diferente';
  END IF;

  IF v_type_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'company_id inconsistente: tipo de venda pertence a empresa diferente';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opp_sale_types_company_check
  BEFORE INSERT ON opportunity_sale_types
  FOR EACH ROW EXECUTE FUNCTION trg_validate_opp_sale_types_company();

-- RLS
ALTER TABLE opportunity_sale_types ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa
CREATE POLICY opp_sale_types_select ON opportunity_sale_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = opportunity_sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
  );

-- INSERT/DELETE somente via RPC SECURITY DEFINER (service_role não é necessário)
-- Políticas restritivas impedem escrita direta pelo frontend
CREATE POLICY opp_sale_types_insert ON opportunity_sale_types
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY opp_sale_types_delete ON opportunity_sale_types
  FOR DELETE
  USING (false);
