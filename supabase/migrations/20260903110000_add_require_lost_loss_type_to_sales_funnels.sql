-- =====================================================
-- Migration: adicionar require_lost_loss_type a sales_funnels
--
-- Quando true, exige ao menos um tipo de perda vinculado
-- em opportunity_loss_types antes de fechar como 'lost'.
-- Espelho de require_won_sale_type (20260623210000).
-- =====================================================

ALTER TABLE sales_funnels
  ADD COLUMN IF NOT EXISTS require_lost_loss_type BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sales_funnels.require_lost_loss_type IS
  'Quando true, exige ao menos um tipo de perda em opportunity_loss_types antes de fechar como lost. '
  'Configurado por funil via RPC set_funnel_require_lost_loss_type.';
