-- =====================================================
-- MIGRATION: Adicionar operating_schedule em company_agent_assignments
-- Data: 2026-05-16
--
-- Propósito:
--   Permitir configuração de faixa horária e dias da semana por assignment
--   de agente de IA. Quando ativo, o conversationRouter verifica o schedule
--   antes de autorizar respostas automáticas.
--
-- Comportamento definido:
--   NULL              → sem restrição (comportamento atual preservado)
--   enabled = false   → sem restrição (agenda desativada)
--   enabled = true + windows = [] → IA bloqueada (fail-safe)
--   enabled = true + windows     → IA responde apenas dentro das janelas
--
-- Estrutura do JSONB:
--   {
--     "enabled": true,
--     "timezone": "America/Sao_Paulo",
--     "windows": [
--       { "day": 1, "start": "08:00", "end": "18:00" }
--     ]
--   }
--   day: 0=Domingo, 1=Segunda, ..., 6=Sábado
--   start/end: formato HH:MM (24h)
--
-- Compatibilidade:
--   ADD COLUMN IF NOT EXISTS com DEFAULT NULL garante que todos os
--   assignments existentes continuem funcionando sem alteração.
--
-- Dependências: company_agent_assignments (já existente)
-- =====================================================

-- ── Bloco 1: Nova coluna em company_agent_assignments ─────────────────────────

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS operating_schedule JSONB DEFAULT NULL;

COMMENT ON COLUMN public.company_agent_assignments.operating_schedule IS
  'Agenda de atendimento do agente. NULL = sem restrição. '
  'Estrutura: { enabled: boolean, timezone: string IANA, windows: [{ day: 0-6, start: HH:MM, end: HH:MM }] }. '
  'enabled=true + windows=[] = bloqueio total (fail-safe). '
  'Verificado pelo conversationRouter antes de autorizar resposta automática.';

-- ── Bloco 2: Ampliar CHECK constraint em agent_processed_messages ─────────────
-- Adiciona 'skipped_out_of_schedule' ao enum de resultados de auditoria.
-- O bloco DO $$ verifica existência antes de remover — seguro para reexecução.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'agent_processed_messages_result_check'
      AND  table_name      = 'agent_processed_messages'
      AND  constraint_type = 'CHECK'
  ) THEN
    ALTER TABLE public.agent_processed_messages
      DROP CONSTRAINT agent_processed_messages_result_check;
  END IF;
END $$;

ALTER TABLE public.agent_processed_messages
  ADD CONSTRAINT agent_processed_messages_result_check
  CHECK (result IN (
    'processed',
    'skipped_no_rule',
    'skipped_ai_inactive',
    'skipped_lock_busy',
    'skipped_out_of_schedule',
    'error'
  ));
