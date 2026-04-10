-- =====================================================
-- PHASE 1 — Agent Tools: allowed_tools + agent_tool_executions
--
-- Objetivo:
--   1. Adicionar allowed_tools (JSONB) em lovoo_agents
--      Define quais tools o agente pode chamar via function calling.
--   2. Criar agent_tool_executions para audit log de toda execução de tool.
--
-- RLS:
--   Usa EXISTS para validar membership ativo em company_users.
--   Suporta usuários com múltiplas empresas corretamente.
--
-- Notas:
--   - allowed_tools = [] → agente sem tools (puramente conversacional)
--   - allowed_tools = null → comportamento equivalente a []
--   - agent_tool_executions é append-only (sem UPDATE/DELETE por usuário)
-- =====================================================

-- ── 1. allowed_tools em lovoo_agents ─────────────────────────────────────────

ALTER TABLE public.lovoo_agents
  ADD COLUMN IF NOT EXISTS allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lovoo_agents.allowed_tools IS
  'Lista de tools que este agente pode chamar via function calling OpenAI. '
  'Vazio ([]) = agente puramente conversacional sem capacidade de ação CRM. '
  'Valores válidos: update_lead, add_tag, remove_tag, create_activity, '
  'add_note, move_opportunity, update_opportunity, schedule_contact, request_handoff.';

-- ── 2. Tabela agent_tool_executions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_tool_executions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID        NOT NULL,  -- referência informativa (sem FK para evitar lock)
  agent_id        UUID        NOT NULL REFERENCES public.lovoo_agents(id) ON DELETE CASCADE,
  tool_name       TEXT        NOT NULL,
  -- Argumentos recebidos do LLM. IDs de recursos (lead, opportunity) são
  -- REMOVIDOS antes de persistir — toolExecutor usa apenas IDs do contexto.
  tool_input      JSONB       NOT NULL DEFAULT '{}',
  tool_output     JSONB,
  success         BOOLEAN     NOT NULL,
  -- Códigos de erro padronizados para monitoramento e alertas
  error_code      TEXT        CHECK (error_code IN (
    'cross_tenant_attempt',
    'ownership_validation_failed',
    'tool_not_in_allowlist',
    'validation_error',
    'crm_action_failed',
    'table_not_found',
    'unknown_error'
  )),
  error_message   TEXT,
  is_critical     BOOLEAN     NOT NULL DEFAULT false,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_tool_executions IS
  'Audit log append-only de toda execução de tool pelo agente IA. '
  'Registra tanto execuções bem-sucedidas quanto falhas, incluindo tentativas '
  'de acesso indevido (cross_tenant_attempt, tool_not_in_allowlist).';

-- Índices para queries de monitoramento e relatórios
CREATE INDEX IF NOT EXISTS agent_tool_exec_company_time
  ON public.agent_tool_executions (company_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS agent_tool_exec_agent_time
  ON public.agent_tool_executions (agent_id, executed_at DESC);

-- Índice para alertas de segurança (cross-tenant, allowlist violations)
CREATE INDEX IF NOT EXISTS agent_tool_exec_errors
  ON public.agent_tool_executions (company_id, success, error_code)
  WHERE success = false;

-- ── 3. RLS em agent_tool_executions ──────────────────────────────────────────
-- Nota: Usa EXISTS com company_users para suportar usuários multi-empresa.
-- Não usa LIMIT 1 (retorna false em vez de incorreto com múltiplas linhas).

ALTER TABLE public.agent_tool_executions ENABLE ROW LEVEL SECURITY;

-- Leitura: usuário vê apenas execuções da sua empresa ativa
CREATE POLICY "agent_tool_exec_select"
  ON public.agent_tool_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.company_users cu
       WHERE cu.user_id    = auth.uid()
         AND cu.company_id = agent_tool_executions.company_id
         AND cu.is_active  = true
    )
  );

-- Insert: apenas service_role pode inserir (toolExecutor usa service_role)
-- Usuários autenticados NÃO inserem diretamente.
CREATE POLICY "agent_tool_exec_insert_service_role"
  ON public.agent_tool_executions
  FOR INSERT
  WITH CHECK (false);  -- bloqueado para auth.uid(); service_role bypassa RLS

-- Sem UPDATE nem DELETE para usuários — log é imutável
