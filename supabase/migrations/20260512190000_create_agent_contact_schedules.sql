-- =====================================================
-- Migration: create_agent_contact_schedules
-- Data: 2026-05-12
-- Objetivo: Tabela para agendamentos de contato proativo por agentes de IA.
--
-- Processada pelo CRON: api/cron/process-agent-schedules.js (a cada 1 min)
-- Sem alteração de RLS existente, triggers ou stored procedures.
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_contact_schedules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL,
  lead_id           BIGINT,
  conversation_id   UUID,
  agent_id          UUID,
  reason            TEXT,
  message_hint      TEXT,

  -- Controle de tentativas
  attempt_number    INTEGER     NOT NULL DEFAULT 0,
  max_attempts      INTEGER     NOT NULL DEFAULT 3,
  interval_hours    NUMERIC     NOT NULL DEFAULT 24,
  last_attempt_at   TIMESTAMPTZ,
  next_attempt_at   TIMESTAMPTZ,

  -- Agendamento
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  cancel_reason     TEXT,
  processed_at      TIMESTAMPTZ,

  -- Auditoria
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice principal para o CRON (status + scheduled_at)
CREATE INDEX IF NOT EXISTS idx_agent_contact_schedules_cron
  ON agent_contact_schedules (status, scheduled_at)
  WHERE status = 'pending';

-- Índice de suporte para filtragem por empresa
CREATE INDEX IF NOT EXISTS idx_agent_contact_schedules_company
  ON agent_contact_schedules (company_id, status);

-- RLS
ALTER TABLE agent_contact_schedules ENABLE ROW LEVEL SECURITY;

-- Apenas service_role (backend) acessa esta tabela.
-- Nenhum acesso direto via frontend (anon/authenticated).
CREATE POLICY "agent_contact_schedules_service_role_only"
  ON agent_contact_schedules
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE  agent_contact_schedules IS 'Agendamentos de contato proativo por agentes de IA. Processados pelo CRON process-agent-schedules a cada minuto.';
COMMENT ON COLUMN agent_contact_schedules.status        IS 'pending | processing | sent | failed | cancelled';
COMMENT ON COLUMN agent_contact_schedules.message_hint  IS 'Sugestão de conteúdo para a mensagem proativa (não obrigatório).';
COMMENT ON COLUMN agent_contact_schedules.cancel_reason IS 'Motivo do cancelamento ou falha — preenchido automaticamente pelo CRON.';
