-- MIGRATION: Adicionar coluna metadata em opportunity_stage_history
-- Propósito: armazenar contexto de eventos como lead_reentry (source, lead_entry_id, origin_channel)
-- Sem índice: campo não usado em filtragem, apenas em leitura de detalhe

ALTER TABLE opportunity_stage_history
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN opportunity_stage_history.metadata IS
  'Contexto adicional do evento. Usado por move_type=lead_reentry para armazenar {source, lead_entry_id, origin_channel}.';
