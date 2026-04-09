-- =====================================================
-- MIGRATION: Criar tabela agent_handoff_events
-- Data: 2026-04-09
-- Etapa: 9/13
--
-- Propósito:
--   Log imutável de transferências entre IA e humano (e vice-versa).
--   Cada handoff (IA → humano ou humano → IA) gera um registro permanente.
--   Usado para auditoria, análise de qualidade e SLA.
--
-- Imutabilidade:
--   Nenhuma policy UPDATE ou DELETE é criada.
--   Os dados nunca devem ser modificados após inserção.
--   Qualquer "correção" deve ser um novo registro, não um UPDATE.
--
-- Tipos de handoff:
--   'ai_to_human'  — IA pausada, humano assumiu
--   'human_to_ai'  — humano devolveu para IA
--   'ai_to_human_requested' — IA solicitou handoff (can_request_handoff = true)
--
-- Acesso:
--   SELECT: membros da empresa (histórico no painel)
--   INSERT: apenas service_role (backend)
--   UPDATE/DELETE: nenhum (imutável)
--
-- Dependências: Migrations 3, 4 (chat_conversations, company_agent_assignments).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_handoff_events (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant
  company_id            UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Conversa onde o handoff ocorreu
  conversation_id       UUID          NOT NULL
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,

  -- Assignment ativo no momento do handoff
  assignment_id         UUID          NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL,

  -- Sessão associada ao handoff (auditoria completa)
  session_id            UUID          NULL
    REFERENCES public.agent_conversation_sessions(id) ON DELETE SET NULL,

  -- Direção do handoff
  handoff_type          TEXT          NOT NULL
                          CHECK (handoff_type IN (
                            'ai_to_human',              -- humano assumiu manualmente
                            'human_to_ai',              -- humano devolveu para IA
                            'ai_to_human_requested'     -- IA solicitou handoff
                          )),

  -- Usuário que executou a ação (NULL para handoffs automáticos solicitados pela IA)
  triggered_by_user_id  UUID          NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Contexto adicional (motivo, nota do operador, etc.)
  notes                 TEXT          NULL,

  -- Timestamp imutável de quando ocorreu o handoff
  occurred_at           TIMESTAMPTZ   NOT NULL DEFAULT now()

  -- Sem updated_at: este registro nunca deve ser modificado
);

-- Índice para histórico de handoffs por conversa
CREATE INDEX IF NOT EXISTS idx_handoffs_conversation
  ON public.agent_handoff_events (conversation_id, occurred_at DESC);

-- Índice para análise temporal por empresa (métricas de handoff)
CREATE INDEX IF NOT EXISTS idx_handoffs_company_time
  ON public.agent_handoff_events (company_id, occurred_at DESC);

-- Índice para filtrar por tipo de handoff (análise de qualidade)
CREATE INDEX IF NOT EXISTS idx_handoffs_type
  ON public.agent_handoff_events (company_id, handoff_type, occurred_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_handoff_events ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da empresa (auditoria e histórico no painel)
CREATE POLICY "handoff_events_select"
  ON public.agent_handoff_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_handoff_events.company_id
        AND cu.is_active  IS NOT FALSE
    )
  );

-- INSERT: apenas service_role (backend/Orchestrator)
-- Não há policy INSERT para authenticated — handoffs são registrados apenas pelo backend.

-- UPDATE: sem policy (imutabilidade garantida pela ausência de policy)
-- DELETE: sem policy (sem deleção física)

COMMENT ON TABLE public.agent_handoff_events IS
  'Log imutável de transferências entre IA e humano. '
  'Cada handoff gera um registro permanente — sem UPDATE ou DELETE. '
  'Usado para auditoria, SLA e análise de qualidade de atendimento. '
  'INSERT exclusivo via service_role (Orchestrator). '
  'SELECT aberto para membros da empresa.';

COMMENT ON COLUMN public.agent_handoff_events.handoff_type IS
  'ai_to_human: humano assumiu a conversa manualmente. '
  'human_to_ai: humano devolveu para a IA. '
  'ai_to_human_requested: IA solicitou handoff (can_request_handoff = true).';

COMMENT ON COLUMN public.agent_handoff_events.triggered_by_user_id IS
  'Usuário que executou a ação. '
  'NULL para handoffs solicitados automaticamente pela IA.';
