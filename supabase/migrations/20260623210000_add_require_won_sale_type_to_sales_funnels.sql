-- =====================================================
-- Migration: sales_funnels.require_won_sale_type
-- Objetivo: Permitir que cada funil exija ao menos um
--           tipo de venda antes de fechar como won.
-- Impacto: Sem impacto em funis existentes (DEFAULT false).
-- =====================================================

ALTER TABLE sales_funnels
  ADD COLUMN IF NOT EXISTS require_won_sale_type BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sales_funnels.require_won_sale_type IS
  'Quando true, exige ao menos um tipo de venda em opportunity_sale_types '
  'antes de fechar a oportunidade como won. '
  'Configurado via RPC set_funnel_require_won_sale_type (SECURITY DEFINER). '
  'Disponível para todos os planos.';
