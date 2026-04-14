-- =====================================================
-- MIGRATION: ADD 'processing' TO automation_schedules STATUS CHECK
-- Data: 14/04/2026
-- Motivo: O cron process-schedules usa UPDATE status='processing' como
--         lock atômico, mas o CHECK constraint não incluía esse valor,
--         causando violação de constraint (code 23514) e impedindo a
--         retomada de execuções pausadas por nó delay.
-- =====================================================

-- Remover constraint atual
ALTER TABLE automation_schedules
  DROP CONSTRAINT IF EXISTS automation_schedules_status_check;

-- Recriar constraint incluindo 'processing'
ALTER TABLE automation_schedules
  ADD CONSTRAINT automation_schedules_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'failed'));
