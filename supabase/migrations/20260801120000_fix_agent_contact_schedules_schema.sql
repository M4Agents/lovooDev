-- =====================================================
-- MIGRATION: Corrigir schema de agent_contact_schedules
-- Data: 2026-08-01
--
-- Contexto:
--   O schema real em produção é o da migration 20260512190000 (simples),
--   não a phase2. Confirmado via readonly query ao banco.
--
--   Problemas identificados:
--   1. agent_id armazena ai_assignment_id (assignment UUID) mas deveria
--      armazenar lovoo_agents.id — sem FK, então não viola constraint.
--      Correção: adicionar assignment_id (semântica correta) e usar agent_id
--      para armazenar lovoo_agents.id going forward.
--   2. Sem índice de deduplicação para status='pending' — risco de duplicatas.
--   3. Sem last_inbound_snapshot para revalidação antes do envio.
--   4. Sem retry_count para separar falhas técnicas de tentativas comerciais.
--
-- Compatibilidade:
--   Tabela vazia (confirmado via readonly query) — sem impacto em dados existentes.
--   Todas as alterações são additive (ADD COLUMN IF NOT EXISTS).
-- =====================================================

-- 1. assignment_id: referência correta para company_agent_assignments
--    (agent_id continua para lovoo_agents.id — sem FK por design original)
ALTER TABLE public.agent_contact_schedules
  ADD COLUMN IF NOT EXISTS assignment_id UUID
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL;

-- 2. last_inbound_snapshot: captura o last_inbound_at no momento da criação
--    Usado pelo processador para detectar se o lead respondeu após a criação
ALTER TABLE public.agent_contact_schedules
  ADD COLUMN IF NOT EXISTS last_inbound_snapshot TIMESTAMPTZ NULL;

-- 3. retry_count: contador de falhas técnicas, separado de attempt_number
--    attempt_number = tentativas comerciais enviadas com sucesso
--    retry_count    = falhas técnicas (LLM, gateway, timeout) — não contam como comercial
ALTER TABLE public.agent_contact_schedules
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- 4. Constraint de retry_count (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema   = 'public'
      AND table_name     = 'agent_contact_schedules'
      AND constraint_name = 'chk_retry_count'
  ) THEN
    ALTER TABLE public.agent_contact_schedules
      ADD CONSTRAINT chk_retry_count
        CHECK (retry_count >= 0 AND retry_count <= 10);
  END IF;
END;
$$;

-- 5. Índice de deduplicação único
--    Impede criação de múltiplos schedules PENDENTES para a mesma
--    (conversa + reason) ao mesmo tempo.
--    Permite: follow_up(pending) + contact_later(pending) coexistir.
--    Permite: novo pending após o anterior ser sent/cancelled/failed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_contact_schedules_dedup
  ON public.agent_contact_schedules (company_id, conversation_id, reason)
  WHERE status = 'pending'
    AND conversation_id IS NOT NULL;

-- 6. Índice para recuperação de schedules presos em processing
CREATE INDEX IF NOT EXISTS idx_agent_contact_schedules_processing
  ON public.agent_contact_schedules (status, processed_at)
  WHERE status = 'processing';

-- Comentários
COMMENT ON COLUMN public.agent_contact_schedules.assignment_id IS
  'UUID de company_agent_assignments. '
  'Separado de agent_id (que armazena lovoo_agents.id). '
  'Preenchido por check-lead-absence a partir de chat_conversations.ai_assignment_id.';

COMMENT ON COLUMN public.agent_contact_schedules.agent_id IS
  'UUID de lovoo_agents (agente base LLM). '
  'Obtido de company_agent_assignments.agent_id no momento da criação. '
  'Sem FK constraint — compatível com o schema original desta tabela.';

COMMENT ON COLUMN public.agent_contact_schedules.last_inbound_snapshot IS
  'Valor de chat_conversations.last_inbound_at no momento da criação do schedule. '
  'Comparado pelo processador antes do LLM: '
  'se last_inbound_at atual > snapshot, o lead respondeu → cancelar sem consumir tentativa.';

COMMENT ON COLUMN public.agent_contact_schedules.retry_count IS
  'Contador de falhas técnicas (gateway, LLM, timeout). '
  'Não incrementa attempt_number. Limite: 10. '
  'Ao atingir, schedule marcado como failed.';

COMMENT ON COLUMN public.agent_contact_schedules.attempt_number IS
  'Número de tentativas comerciais já concluídas com sucesso (sent). '
  'Incrementado apenas quando gateway confirma envio. '
  'Não é incrementado em falhas técnicas (ver retry_count).';
