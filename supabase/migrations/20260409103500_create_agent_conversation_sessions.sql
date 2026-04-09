-- =====================================================
-- MIGRATION: Criar tabela agent_conversation_sessions
-- Data: 2026-04-09
-- Etapa: 8/13
--
-- Propósito:
--   Rastreia o ciclo de vida de uma sessão do agente de IA em uma conversa.
--   Uma sessão representa um período contínuo de atividade do agente.
--   Múltiplas sessões por conversa são possíveis (ex: após handoff e retorno).
--
-- Relação com ai_state:
--   ai_state em chat_conversations = estado atual (snapshot)
--   agent_conversation_sessions = histórico completo de sessões (auditoria)
--
-- Status da sessão:
--   active    — agente respondendo ativamente
--   paused    — humano assumiu durante esta sessão
--   completed — sessão encerrada normalmente (lead qualificado, atendido, etc.)
--   abandoned — sessão encerrada sem resolução (timeout, erro, etc.)
--
-- Acesso:
--   SELECT: membros da empresa (monitoramento no painel)
--   INSERT/UPDATE: exclusivamente via service_role (backend)
--
-- Dependências: Migrations 3, 4 (chat_conversations, company_agent_assignments).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_conversation_sessions (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant
  company_id            UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Conversa associada a esta sessão
  conversation_id       UUID          NOT NULL
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,

  -- Assignment ativo durante esta sessão
  assignment_id         UUID          NOT NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE RESTRICT,

  -- Regra de roteamento que originou esta sessão (para auditoria do Router)
  rule_id               UUID          NULL
    REFERENCES public.agent_routing_rules(id) ON DELETE SET NULL,

  -- Ciclo de vida da sessão
  status                TEXT          NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),

  -- Timestamps de início e fim da sessão
  started_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ   NULL,

  -- Motivo do encerramento para análise e diagnóstico
  -- Ex: 'human_handoff', 'lead_qualified', 'timeout', 'max_messages', 'error'
  end_reason            TEXT          NULL,

  -- Contadores de atividade durante a sessão
  messages_sent         INTEGER       NOT NULL DEFAULT 0
                          CHECK (messages_sent >= 0),
  messages_received     INTEGER       NOT NULL DEFAULT 0
                          CHECK (messages_received >= 0),

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Índice principal: sessões ativas de uma empresa
CREATE INDEX IF NOT EXISTS idx_sessions_company_active
  ON public.agent_conversation_sessions (company_id, started_at DESC)
  WHERE status = 'active';

-- Índice para lookup por conversa (painel de detalhes)
CREATE INDEX IF NOT EXISTS idx_sessions_conversation
  ON public.agent_conversation_sessions (conversation_id, started_at DESC);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_agent_session_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.agent_conversation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_agent_session_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_conversation_sessions ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da empresa (painel de monitoramento/histórico)
CREATE POLICY "sessions_select"
  ON public.agent_conversation_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_conversation_sessions.company_id
        AND cu.is_active  IS NOT FALSE
    )
  );

-- INSERT e UPDATE: sem policy para authenticated
-- Apenas service_role (backend/Orchestrator) cria e atualiza sessões.
-- O Orchestrator gerencia o ciclo de vida completo da sessão.

COMMENT ON TABLE public.agent_conversation_sessions IS
  'Histórico de sessões do agente de IA por conversa. '
  'Uma sessão representa um período contínuo de atividade do agente. '
  'Complementa o ai_state em chat_conversations com histórico completo. '
  'INSERT/UPDATE exclusivo via service_role (Orchestrator). '
  'SELECT aberto para membros da empresa (monitoramento).';

COMMENT ON COLUMN public.agent_conversation_sessions.status IS
  'active: agente respondendo. '
  'paused: humano assumiu durante esta sessão. '
  'completed: sessão encerrada com resolução. '
  'abandoned: encerrada sem resolução (timeout, erro, etc.).';

COMMENT ON COLUMN public.agent_conversation_sessions.end_reason IS
  'Motivo do encerramento. Valores sugeridos: '
  'human_handoff, lead_qualified, timeout, max_messages, error, conversation_closed.';
