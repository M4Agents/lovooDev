-- =====================================================
-- PHASE 2 — Engine Temporal: agent_contact_schedules
--
-- Objetivo:
--   Tabela de agendamentos de contato para agentes IA.
--   Cobre: follow-up automático, contact later, retry com controle de tentativas.
--
-- Deduplicação:
--   Dois índices UNIQUE parciais (WHERE status='pending') para evitar
--   schedules duplicados sem impedir múltiplos reasons diferentes.
--
-- RLS:
--   Leitura por membership ativo em company_users.
--   Insert/Update somente via service_role (crons e toolExecutor).
--
-- Notas:
--   - next_attempt_at calculado pelo cron após cada tentativa
--   - message_hint: contexto para o agente que fará o contato (não é dado pessoal)
--   - created_by: 'agent' (via tool), 'system' (cron check-lead-absence), 'human' (UI futura)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_contact_schedules (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id             UUID        NOT NULL REFERENCES public.leads(id)     ON DELETE CASCADE,
  conversation_id     UUID,       -- referência informativa sem FK para evitar lock em deletes de conversa
  agent_id            UUID        REFERENCES public.lovoo_agents(id) ON DELETE SET NULL,
  flow_definition_id  UUID,       -- Phase 3: referência a agent_flow_definitions
  source_agent_id     UUID,       -- agente que criou (via tool schedule_contact)
  reason              TEXT        NOT NULL
                        CHECK (reason IN ('follow_up', 'contact_later', 'retry', 'reengagement')),
  scheduled_at        TIMESTAMPTZ NOT NULL,
  last_attempt_at     TIMESTAMPTZ,
  next_attempt_at     TIMESTAMPTZ,   -- atualizado pelo cron após cada tentativa
  attempt_number      INTEGER     NOT NULL DEFAULT 0,
  max_attempts        INTEGER     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  interval_hours      INTEGER     NOT NULL DEFAULT 24 CHECK (interval_hours BETWEEN 1 AND 720),
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'expired', 'failed')),
  cancel_reason       TEXT,       -- motivo se cancelado/expirado (ex: 'max_attempts_reached', 'lead_responded')
  created_by          TEXT        NOT NULL DEFAULT 'system'
                        CHECK (created_by IN ('agent', 'system', 'human')),
  message_hint        TEXT,       -- contexto para o agente que fará o contato (max 300 chars)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.agent_contact_schedules IS
  'Agendamentos de contato para agentes IA: follow-up, contact later e retry. '
  'Processado pelo cron process-agent-schedules (a cada minuto). '
  'check-lead-absence (a cada 30 min) cria registros automáticos de follow_up.';

-- ── Índices de deduplicação (WHERE status = pending) ─────────────────────────
-- Previne múltiplos schedules PENDENTES com o mesmo motivo para a mesma conversa.
-- Permite: pending contact_later + pending follow_up (reasons diferentes).
-- Permite: novo schedule após o anterior ser enviado/cancelado/expirado.

CREATE UNIQUE INDEX IF NOT EXISTS agent_contact_schedules_dedup_conv
  ON public.agent_contact_schedules (company_id, conversation_id, reason)
  WHERE status = 'pending' AND conversation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_contact_schedules_dedup_no_conv
  ON public.agent_contact_schedules (company_id, lead_id, reason)
  WHERE status = 'pending' AND conversation_id IS NULL;

-- ── Índice para o cron process-agent-schedules ───────────────────────────────

CREATE INDEX IF NOT EXISTS agent_contact_schedules_cron_idx
  ON public.agent_contact_schedules (company_id, status, scheduled_at)
  WHERE status = 'pending';

-- ── Índice para check-lead-absence ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS agent_contact_schedules_lead_pending
  ON public.agent_contact_schedules (company_id, lead_id, status)
  WHERE status = 'pending';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_contact_schedules ENABLE ROW LEVEL SECURITY;

-- Leitura: usuário vê apenas schedules da sua empresa ativa
-- Usa EXISTS com company_users para suportar usuários multi-empresa.
CREATE POLICY "agent_contact_schedules_select"
  ON public.agent_contact_schedules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.company_users cu
       WHERE cu.user_id    = auth.uid()
         AND cu.company_id = agent_contact_schedules.company_id
         AND cu.is_active  = true
    )
  );

-- Insert/Update: apenas service_role (crons e toolExecutor)
CREATE POLICY "agent_contact_schedules_insert_service_role"
  ON public.agent_contact_schedules
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "agent_contact_schedules_update_service_role"
  ON public.agent_contact_schedules
  FOR UPDATE
  USING (false);
