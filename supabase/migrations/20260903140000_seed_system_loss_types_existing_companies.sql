-- =====================================================
-- Migration: seed de tipos de perda de sistema para
--            empresas existentes
--
-- Executa provision_system_loss_types para cada empresa
-- ativa (deleted_at IS NULL). Idempotente.
-- Espelho de 20260623270000_seed_system_sale_types_existing_companies.sql
-- =====================================================

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id FROM companies WHERE deleted_at IS NULL
  LOOP
    PERFORM provision_system_loss_types(rec.id);
  END LOOP;
END;
$$;
