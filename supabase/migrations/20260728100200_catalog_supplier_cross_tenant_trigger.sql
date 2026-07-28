-- =====================================================
-- PROTEÇÃO CROSS-TENANT: supplier_id em products e services
-- Garante que supplier_id sempre pertence à mesma company_id
-- do produto ou serviço. Executa BEFORE INSERT OR UPDATE.
-- Reutiliza o padrão de trg_validate_opportunity_items_company.
-- =====================================================

-- -----------------------------------------------------------------
-- 1) Função de validação — SECURITY DEFINER para acesso a suppliers
--    sem depender do RLS ativo na sessão do chamador.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_catalog_supplier_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_company UUID;
BEGIN
  -- Sem vínculo: passa direto.
  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Busca a empresa do fornecedor referenciado.
  SELECT company_id INTO v_supplier_company
  FROM suppliers
  WHERE id = NEW.supplier_id;

  -- Fornecedor inexistente (não deveria ocorrer — FK garante, mas por segurança).
  IF v_supplier_company IS NULL THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Fornecedor inválido ou não encontrado.',
            HINT    = 'CATALOG_SUPPLIER_NOT_FOUND';
  END IF;

  -- Vínculo cross-tenant: bloqueia.
  IF v_supplier_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      USING MESSAGE = 'O fornecedor não pertence a esta empresa.',
            HINT    = 'CATALOG_SUPPLIER_COMPANY_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------
-- 2) Trigger em products
-- -----------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_products_supplier_tenant ON products;

CREATE TRIGGER trg_products_supplier_tenant
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_supplier_tenant();

-- -----------------------------------------------------------------
-- 3) Trigger em services
-- -----------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_services_supplier_tenant ON services;

CREATE TRIGGER trg_services_supplier_tenant
  BEFORE INSERT OR UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_supplier_tenant();
