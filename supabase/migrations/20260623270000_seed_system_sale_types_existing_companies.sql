-- =====================================================
-- Migration: seed de tipos de venda de sistema para
--            empresas existentes
--
-- Executa provision_system_sale_types para cada empresa
-- ativa (deleted_at IS NULL). Idempotente.
-- =====================================================

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id FROM companies WHERE deleted_at IS NULL
  LOOP
    PERFORM provision_system_sale_types(rec.id);
  END LOOP;
END;
$$;
