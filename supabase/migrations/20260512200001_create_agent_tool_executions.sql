-- =====================================================
-- Migration: create_agent_tool_executions
-- Data: 2026-05-12
--
-- Tabela de audit log para execuções de tools pelo agente de IA.
-- Gravada pelo toolExecutor.js (fire-and-forget, nunca bloqueia).
-- Usada para observabilidade e auditoria de ações do agente.
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_tool_executions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL,
  conversation_id UUID,
  agent_id        UUID,

  -- Identificação da tool
  tool_name       VARCHAR(100) NOT NULL,
  tool_input      JSONB,
  tool_output     JSONB,

  -- Resultado
  success         BOOLEAN     NOT NULL DEFAULT false,
  error_code      VARCHAR(100),
  error_message   TEXT,
  is_critical     BOOLEAN     NOT NULL DEFAULT false,

  -- Auditoria
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries de observabilidade
CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_company
  ON agent_tool_executions (company_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_conversation
  ON agent_tool_executions (conversation_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_tool
  ON agent_tool_executions (tool_name, success);

-- RLS: apenas service_role (backend) acessa
ALTER TABLE agent_tool_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_tool_executions_service_role_only"
  ON agent_tool_executions
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE  agent_tool_executions IS 'Audit log de execuções de tools pelo agente de IA. Gravado pelo toolExecutor.js (fire-and-forget).';
COMMENT ON COLUMN agent_tool_executions.is_critical    IS 'true = tool crítica (ação CRM com side-effects); false = leitura ou busca.';
COMMENT ON COLUMN agent_tool_executions.tool_input     IS 'Argumentos sanitizados passados pelo LLM (sem campos proibidos como IDs hardcoded).';
