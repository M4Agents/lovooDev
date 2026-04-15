-- MIGRATION: Adicionar 'lead_reentry' ao CHECK de move_type em opportunity_stage_history
-- Necessário para que handleLeadReentry possa registrar eventos de reentrada.

ALTER TABLE opportunity_stage_history
  DROP CONSTRAINT IF EXISTS osh_valid_move_type;

ALTER TABLE opportunity_stage_history
  ADD CONSTRAINT osh_valid_move_type CHECK (
    move_type IN ('funnel_entry', 'stage_change', 'won', 'lost', 'reopened', 'lead_reentry')
  );
