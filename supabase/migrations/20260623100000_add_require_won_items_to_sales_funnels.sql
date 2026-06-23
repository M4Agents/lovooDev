-- =====================================================
-- Migration: require_won_items em sales_funnels
-- Objetivo: Permitir que cada funil exija pelo menos
--           um produto/serviço antes de fechar como ganha.
-- Impacto: Sem impacto em dados existentes (DEFAULT false).
-- Multi-tenant: sem mudança de RLS (coluna em tabela já
--              isolada por company_id).
-- =====================================================

ALTER TABLE sales_funnels
  ADD COLUMN IF NOT EXISTS require_won_items BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sales_funnels.require_won_items IS
  'Quando true, exige ao menos um registro em opportunity_items antes de fechar a oportunidade como "won". '
  'Requer entitlement opportunity_items_enabled na empresa. '
  'Configurado via RPC set_funnel_require_won_items (SECURITY DEFINER).';
