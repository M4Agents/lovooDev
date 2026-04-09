-- =====================================================
-- MIGRATION: Criar tabela company_agent_assignments
-- Data: 2026-04-09
-- Etapa: 4/13
--
-- Propósito:
--   Vincula um lovoo_agent a uma empresa com configurações específicas
--   de canal, capacidades operacionais e política de preços.
--   É a peça central de configuração multi-tenant do agente de conversação.
--
-- Relação com lovoo_agents:
--   lovoo_agents contém o agente base (prompt, knowledge_mode, use_bindings)
--   company_agent_assignments é a instância do agente para a empresa, com
--   configurações específicas de canal, permissões e política de preços.
--
-- Campos principais:
--   agent_id         — FK para lovoo_agents (o agente base)
--   company_id       — empresa dona deste assignment (multi-tenant)
--   channel          — canal onde o agente atua ('whatsapp', 'web', etc.)
--   capabilities     — JSONB com permissões operacionais explícitas
--   price_display_policy — como o agente deve lidar com preços
--   is_active        — se este assignment está habilitado
--
-- RLS:
--   SELECT: qualquer membro da empresa (backend/frontend precisam ler)
--   INSERT/UPDATE: apenas admin/super_admin/system_admin da empresa
--   DELETE: sem policy (sem deleção física — usar is_active = false)
--
-- Dependências: lovoo_agents (migration 20260407200000)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.company_agent_assignments (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant obrigatório
  company_id            UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Agente base que será instanciado para esta empresa
  agent_id              UUID          NOT NULL REFERENCES public.lovoo_agents(id) ON DELETE RESTRICT,

  -- Canal onde este assignment opera
  -- 'whatsapp' para MVP; preparado para 'web', 'email', etc. no futuro
  channel               TEXT          NOT NULL DEFAULT 'whatsapp'
                          CHECK (channel IN ('whatsapp', 'web', 'email', 'sms')),

  -- Nome amigável para identificação no painel admin
  display_name          TEXT          NOT NULL,

  -- Capacidades operacionais do agente neste assignment
  -- Validadas em runtime pelo Orchestrator e ContextBuilder
  -- Não dependem do prompt — são regras de negócio controladas pelo backend
  -- Estrutura esperada:
  --   {
  --     "can_auto_reply": false,        -- responder automaticamente ao lead
  --     "can_send_media": false,        -- enviar mídias autorizadas
  --     "can_inform_prices": false,     -- mencionar preços nas respostas
  --     "can_update_lead": false,       -- escrever em dados do lead (pós-MVP)
  --     "can_update_opportunity": false,-- escrever em oportunidades (pós-MVP)
  --     "can_move_opportunity_stage": false, -- mover etapa (pós-MVP)
  --     "can_request_handoff": true     -- solicitar transferência para humano
  --   }
  capabilities          JSONB         NOT NULL DEFAULT '{
    "can_auto_reply": false,
    "can_send_media": false,
    "can_inform_prices": false,
    "can_update_lead": false,
    "can_update_opportunity": false,
    "can_move_opportunity_stage": false,
    "can_request_handoff": true
  }'::jsonb,

  -- Política de exibição de preços — camada 2 (só ativa se can_inform_prices = true)
  -- disabled: nunca informa preço
  -- fixed_only: apenas preço fixo cadastrado
  -- range_allowed: pode mencionar faixa de preço
  -- consult_only: deve orientar o lead a consultar um humano
  price_display_policy  TEXT          NOT NULL DEFAULT 'disabled'
                          CHECK (price_display_policy IN (
                            'disabled',
                            'fixed_only',
                            'range_allowed',
                            'consult_only'
                          )),

  -- Metadados de controle
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Garante que não há dois assignments do mesmo agente no mesmo canal/empresa
  CONSTRAINT uq_company_agent_channel UNIQUE (company_id, agent_id, channel)
);

-- Índice principal: busca de assignments ativos por empresa e canal
CREATE INDEX IF NOT EXISTS idx_assignments_company_channel
  ON public.company_agent_assignments (company_id, channel)
  WHERE is_active = true;

-- Índice para lookup por agent_id (quais empresas usam um agente)
CREATE INDEX IF NOT EXISTS idx_assignments_agent_id
  ON public.company_agent_assignments (agent_id);

-- Trigger para manter updated_at atualizado
CREATE OR REPLACE FUNCTION public.update_agent_assignment_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON public.company_agent_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_agent_assignment_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.company_agent_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro autenticado da empresa pode ler
-- O backend (service_role) bypassa RLS; esta policy é para o frontend
CREATE POLICY "assignments_select"
  ON public.company_agent_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.is_active  IS NOT FALSE
    )
  );

-- INSERT: apenas admin ou superior da empresa pode criar assignments
CREATE POLICY "assignments_insert"
  ON public.company_agent_assignments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  );

-- UPDATE: apenas admin ou superior da empresa pode alterar
CREATE POLICY "assignments_update"
  ON public.company_agent_assignments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  );

-- Sem policy DELETE: desativação via is_active = false (sem deleção física)

COMMENT ON TABLE public.company_agent_assignments IS
  'Instância de um lovoo_agent configurado para uma empresa específica. '
  'Define canal, capacidades operacionais e política de preços. '
  'É a fonte de verdade do Router para decidir qual agente usar. '
  'Desativação via is_active = false — sem deleção física.';

COMMENT ON COLUMN public.company_agent_assignments.capabilities IS
  'Permissões operacionais do agente neste assignment. '
  'Validadas pelo backend — nunca dependem do prompt. '
  'can_inform_prices + price_display_policy formam a política de preços em duas camadas.';

COMMENT ON COLUMN public.company_agent_assignments.price_display_policy IS
  'Como o agente lida com preços quando can_inform_prices = true. '
  'disabled: jamais menciona preço. '
  'fixed_only: apenas preço fixo oficial. '
  'range_allowed: pode mencionar faixa. '
  'consult_only: orienta a consultar humano.';
