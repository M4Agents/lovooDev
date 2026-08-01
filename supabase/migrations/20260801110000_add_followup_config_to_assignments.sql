-- =====================================================
-- MIGRATION: Configuração de follow-up por assignment
-- Data: 2026-08-01
--
-- Propósito:
--   Adicionar campos de configuração de follow-up proativo em
--   company_agent_assignments. Permite que cada empresa/assignment
--   tenha threshold, tentativas e intervalo independentes.
--
-- Segurança de rollout:
--   follow_up_enabled = false por default.
--   Nenhuma empresa é ativada automaticamente.
--   Ativação explícita via SQL direto após validação.
--
-- Constraints:
--   Criadas via blocos DO idempotentes.
-- =====================================================

-- Adicionar colunas separadamente (idempotente)
ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS follow_up_absence_hours INTEGER NOT NULL DEFAULT 2;

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS follow_up_max_attempts INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS follow_up_interval_hours NUMERIC NOT NULL DEFAULT 24;

-- Constraints via blocos DO (idempotentes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema   = 'public'
      AND table_name     = 'company_agent_assignments'
      AND constraint_name = 'chk_followup_absence_hours'
  ) THEN
    ALTER TABLE public.company_agent_assignments
      ADD CONSTRAINT chk_followup_absence_hours
        CHECK (follow_up_absence_hours > 0 AND follow_up_absence_hours <= 168);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema   = 'public'
      AND table_name     = 'company_agent_assignments'
      AND constraint_name = 'chk_followup_max_attempts'
  ) THEN
    ALTER TABLE public.company_agent_assignments
      ADD CONSTRAINT chk_followup_max_attempts
        CHECK (follow_up_max_attempts >= 0 AND follow_up_max_attempts <= 10);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema   = 'public'
      AND table_name     = 'company_agent_assignments'
      AND constraint_name = 'chk_followup_interval_hours'
  ) THEN
    ALTER TABLE public.company_agent_assignments
      ADD CONSTRAINT chk_followup_interval_hours
        CHECK (follow_up_interval_hours > 0 AND follow_up_interval_hours <= 720);
  END IF;
END;
$$;

-- Comentários
COMMENT ON COLUMN public.company_agent_assignments.follow_up_enabled IS
  'Habilita follow-up proativo para este assignment. '
  'false por default — ativação explícita por empresa. '
  'Nenhuma empresa é ativada automaticamente por esta migration.';

COMMENT ON COLUMN public.company_agent_assignments.follow_up_absence_hours IS
  'Horas de ausência do lead para disparar follow-up. '
  'Min: 1h, Max: 168h (1 semana). Default: 2h.';

COMMENT ON COLUMN public.company_agent_assignments.follow_up_max_attempts IS
  'Máximo de follow-ups a enviar. 0 = sem follow-up. Max: 10. Default: 3.';

COMMENT ON COLUMN public.company_agent_assignments.follow_up_interval_hours IS
  'Horas entre tentativas de follow-up. Min: 1h, Max: 720h (30 dias). Default: 24h.';
