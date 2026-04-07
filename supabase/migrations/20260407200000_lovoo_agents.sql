-- =====================================================
-- Agentes Lovoo — tabelas, índices e RLS
--
-- Duas tabelas:
--   lovoo_agents        → cadastro de agentes (empresa pai)
--   agent_use_bindings  → vínculo global uso → agente (sem company_id)
--
-- RLS:
--   lovoo_agents        → leitura e escrita restritas à empresa pai
--   agent_use_bindings  → leitura para qualquer autenticado, escrita para empresa pai
--
-- Empresa pai: dcc99d3d-9def-4b93-aeb2-1a3be5f15413
-- (UUID fixo — variáveis de ambiente não são acessíveis dentro do SQL/RLS)
-- =====================================================

-- ── 1. Tabela lovoo_agents ────────────────────────────────────────────────────

CREATE TABLE public.lovoo_agents (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Sempre = empresa pai. Semântica: quem administra este agente.
  -- Não é usado para filtrar consumo — agentes são globais.
  name                  TEXT        NOT NULL,
  description           TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  prompt                TEXT,
  knowledge_base        TEXT,                              -- MVP: texto livre
  knowledge_base_config JSONB       NOT NULL DEFAULT '{}', -- reservado para RAG/embeddings futuros
  model                 TEXT        NOT NULL DEFAULT 'gpt-4.1-mini',
  model_config          JSONB       NOT NULL DEFAULT '{}', -- ex.: { "temperature": 0.7, "max_tokens": 1024 }
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lovoo_agents_company_active
  ON public.lovoo_agents (company_id, is_active);

CREATE TRIGGER update_lovoo_agents_updated_at
  BEFORE UPDATE ON public.lovoo_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Tabela agent_use_bindings ──────────────────────────────────────────────
--
-- Binding GLOBAL: 1 uso funcional = 1 agente no SaaS inteiro.
-- Sem company_id — não há isolamento por tenant nesta tabela.

CREATE TABLE public.agent_use_bindings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  use_id     TEXT        NOT NULL,
  agent_id   UUID        NOT NULL REFERENCES public.lovoo_agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_use_bindings_use_id UNIQUE (use_id)
);

CREATE INDEX idx_agent_use_bindings_use_id
  ON public.agent_use_bindings (use_id);

-- ── 3. RLS — lovoo_agents ─────────────────────────────────────────────────────
--
-- Leitura E escrita restritas à empresa pai.
-- Prompts/configurações não ficam expostos a usuários de empresas-clientes.

ALTER TABLE public.lovoo_agents ENABLE ROW LEVEL SECURITY;

-- Bloco reutilizável (macro local) para clareza: usuário é admin da empresa pai?
-- Dois caminhos:
--   a) company_users com role admin/super_admin na empresa pai
--   b) dono legado: companies.user_id + is_super_admin

CREATE POLICY "lovoo_agents_select"
  ON public.lovoo_agents FOR SELECT TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = lovoo_agents.company_id
          AND cu.role       IN ('super_admin', 'admin')
          AND cu.is_active  IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id      = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );

CREATE POLICY "lovoo_agents_insert"
  ON public.lovoo_agents FOR INSERT TO authenticated
  WITH CHECK (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND cu.role       IN ('super_admin', 'admin')
          AND cu.is_active  IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id      = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );

CREATE POLICY "lovoo_agents_update"
  ON public.lovoo_agents FOR UPDATE TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = lovoo_agents.company_id
          AND cu.role       IN ('super_admin', 'admin')
          AND cu.is_active  IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id      = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  )
  WITH CHECK (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
  );

CREATE POLICY "lovoo_agents_delete"
  ON public.lovoo_agents FOR DELETE TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = lovoo_agents.company_id
          AND cu.role       IN ('super_admin', 'admin')
          AND cu.is_active  IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id      = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );

-- ── 4. RLS — agent_use_bindings ───────────────────────────────────────────────
--
-- SELECT: qualquer autenticado — features de qualquer empresa podem ver os bindings
-- WRITE:  apenas empresa pai — mesma lógica, verificação direta via company_users

ALTER TABLE public.agent_use_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_use_bindings_select"
  ON public.agent_use_bindings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "agent_use_bindings_insert"
  ON public.agent_use_bindings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id      = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );

CREATE POLICY "agent_use_bindings_update"
  ON public.agent_use_bindings FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id      = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  )
  WITH CHECK (true);

CREATE POLICY "agent_use_bindings_delete"
  ON public.agent_use_bindings FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id           = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id      = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );
