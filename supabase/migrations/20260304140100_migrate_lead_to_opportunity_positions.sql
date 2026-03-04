-- =====================================================
-- MIGRATION: Migrar lead_funnel_positions para opportunity_funnel_positions
-- Data: 04/03/2026
-- Descrição: Renomear tabela e adicionar suporte a oportunidades
-- =====================================================

-- =====================================================
-- PASSO 1: Adicionar coluna opportunity_id à tabela existente
-- =====================================================
ALTER TABLE lead_funnel_positions
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE;

-- =====================================================
-- PASSO 2: Criar índice para opportunity_id
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_lead_funnel_positions_opportunity 
  ON lead_funnel_positions(opportunity_id);

-- =====================================================
-- PASSO 3: Renomear tabela
-- =====================================================
ALTER TABLE lead_funnel_positions 
  RENAME TO opportunity_funnel_positions;

-- =====================================================
-- PASSO 4: Renomear índices existentes
-- =====================================================
ALTER INDEX IF EXISTS idx_lead_funnel_positions_lead 
  RENAME TO idx_opportunity_funnel_positions_lead_legacy;

ALTER INDEX IF EXISTS idx_lead_funnel_positions_funnel 
  RENAME TO idx_opportunity_funnel_positions_funnel;

ALTER INDEX IF EXISTS idx_lead_funnel_positions_stage 
  RENAME TO idx_opportunity_funnel_positions_stage;

ALTER INDEX IF EXISTS idx_lead_funnel_positions_stage_order 
  RENAME TO idx_opportunity_funnel_positions_stage_order;

-- =====================================================
-- PASSO 5: Renomear políticas RLS
-- =====================================================
ALTER POLICY IF EXISTS lead_funnel_positions_select 
  ON opportunity_funnel_positions 
  RENAME TO opportunity_funnel_positions_select;

ALTER POLICY IF EXISTS lead_funnel_positions_insert 
  ON opportunity_funnel_positions 
  RENAME TO opportunity_funnel_positions_insert;

ALTER POLICY IF EXISTS lead_funnel_positions_update 
  ON opportunity_funnel_positions 
  RENAME TO opportunity_funnel_positions_update;

ALTER POLICY IF EXISTS lead_funnel_positions_delete 
  ON opportunity_funnel_positions 
  RENAME TO opportunity_funnel_positions_delete;

-- =====================================================
-- PASSO 6: Renomear trigger
-- =====================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_lead_funnel_positions_updated_at'
  ) THEN
    ALTER TRIGGER update_lead_funnel_positions_updated_at 
      ON opportunity_funnel_positions 
      RENAME TO update_opportunity_funnel_positions_updated_at;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'track_lead_stage_movement'
  ) THEN
    ALTER TRIGGER track_lead_stage_movement 
      ON opportunity_funnel_positions 
      RENAME TO track_opportunity_stage_movement;
  END IF;
END $$;

-- =====================================================
-- PASSO 7: Atualizar comentários
-- =====================================================
COMMENT ON TABLE opportunity_funnel_positions IS 'Posição atual de cada oportunidade em cada funil';
COMMENT ON COLUMN opportunity_funnel_positions.opportunity_id IS 'ID da oportunidade (novo modelo)';
COMMENT ON COLUMN opportunity_funnel_positions.lead_id IS 'ID do lead (legado - será removido após migração completa)';
COMMENT ON COLUMN opportunity_funnel_positions.position_in_stage IS 'Ordem da oportunidade dentro da etapa (para drag & drop)';
