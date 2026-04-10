-- =====================================================
-- PHASE 3 — Orquestração de Fluxo entre Agentes
--
-- Tabelas:
--   agent_flow_definitions    → configuração do fluxo por empresa
--   conversation_flow_states  → estado atual de cada conversa no fluxo
--
-- RLS:
--   Leitura via membership ativo em company_users (EXISTS, sem LIMIT 1).
--   Mutações somente via service_role (flowOrchestrator, conversationRouter).
--
-- Notas:
--   - agent_flow_definitions.stages é JSONB com schema controlado pelo flowOrchestrator
--   - conversation_flow_states.variables é JSONB com schema controlado (max 2KB)
--   - locked_opportunity_id: oportunidade travada para esta conversa (ownership validado ao travar)
--   - UNIQUE (conversation_id) garante que uma conversa tem no máximo um fluxo ativo
-- =====================================================

-- ── 1. agent_flow_definitions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_flow_definitions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  -- Schema de stages validado pelo flowOrchestrator antes de persistir.
  -- Estrutura esperada: array de { id, label, agent_id, max_attempts,
  --   follow_up_hours, transition_conditions: [{ type, ..., next_stage }] }
  stages      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_flow_definitions IS
  'Definições de fluxo entre agentes IA por empresa. '
  'Cada fluxo define estágios com condições de transição avaliadas pelo flowOrchestrator. '
  'Lógica de fluxo reside 100% no backend — usuário configura via UI (Phase 4).';

CREATE INDEX IF NOT EXISTS agent_flow_def_company_active
  ON public.agent_flow_definitions (company_id, is_active);

CREATE TRIGGER update_agent_flow_definitions_updated_at
  BEFORE UPDATE ON public.agent_flow_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.agent_flow_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_flow_def_select"
  ON public.agent_flow_definitions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.company_users cu
       WHERE cu.user_id    = auth.uid()
         AND cu.company_id = agent_flow_definitions.company_id
         AND cu.is_active  = true
    )
  );

CREATE POLICY "agent_flow_def_write_service_role"
  ON public.agent_flow_definitions
  FOR ALL
  WITH CHECK (false);

-- ── 2. conversation_flow_states ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversation_flow_states (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id       UUID        NOT NULL,  -- ref informativa sem FK para flexibilidade
  flow_definition_id    UUID        NOT NULL REFERENCES public.agent_flow_definitions(id) ON DELETE RESTRICT,
  current_stage_id      TEXT        NOT NULL,  -- id do estágio no JSONB de stages
  -- Oportunidade travada: validada no momento do travamento (ownership check).
  -- NULL = sem oportunidade em foco (agente de qualificação puro, etc.)
  locked_opportunity_id UUID        REFERENCES public.opportunities(id) ON DELETE SET NULL,
  -- Dados de controle de fluxo — NÃO armazenar dados pessoais do lead aqui.
  -- Schema controlado pelo flowOrchestrator (max 2KB).
  -- Campos permitidos: message_count, tool_calls_count, qualification_score,
  --   is_qualified, activity_created, handoff_requested, current_stage_entered_at,
  --   previous_stage_id, entry_message_id.
  variables             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'paused', 'abandoned')),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  -- Garante no máximo um fluxo ativo por conversa
  CONSTRAINT conversation_flow_states_unique_conv UNIQUE (conversation_id)
);

COMMENT ON TABLE public.conversation_flow_states IS
  'Estado atual de cada conversa dentro de um agent_flow_definition. '
  'current_stage_id é o id do estágio ativo no JSONB stages. '
  'variables contém apenas dados de controle de fluxo (não dados pessoais do lead). '
  'locked_opportunity_id é travado na primeira tool que precisar de opportunity_id.';

COMMENT ON COLUMN public.conversation_flow_states.variables IS
  'Schema controlado. Máximo 2KB. Campos permitidos: message_count, tool_calls_count, '
  'qualification_score, is_qualified, activity_created, handoff_requested, '
  'current_stage_entered_at, previous_stage_id, entry_message_id. '
  'NUNCA armazenar dados pessoais (nome, telefone, email, etc.).';

CREATE INDEX IF NOT EXISTS conv_flow_states_company_status
  ON public.conversation_flow_states (company_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS conv_flow_states_flow_def
  ON public.conversation_flow_states (flow_definition_id, status);

ALTER TABLE public.conversation_flow_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_flow_states_select"
  ON public.conversation_flow_states
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.company_users cu
       WHERE cu.user_id    = auth.uid()
         AND cu.company_id = conversation_flow_states.company_id
         AND cu.is_active  = true
    )
  );

CREATE POLICY "conv_flow_states_write_service_role"
  ON public.conversation_flow_states
  FOR ALL
  WITH CHECK (false);

-- ── 3. FK de agent_contact_schedules para agent_flow_definitions (Phase 2 → 3) ───

-- A coluna flow_definition_id já existe em agent_contact_schedules (Phase 2),
-- mas sem FK (a tabela agent_flow_definitions não existia). Adicionamos agora.
ALTER TABLE public.agent_contact_schedules
  ADD CONSTRAINT fk_agent_contact_schedules_flow
  FOREIGN KEY (flow_definition_id)
  REFERENCES public.agent_flow_definitions(id)
  ON DELETE SET NULL;
