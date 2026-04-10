-- =====================================================
-- MIGRATION: Criar tabela ai_system_policies
-- Data: 2026-04-10
--
-- Propósito:
--   Armazenar as diretrizes globais de comportamento da IA,
--   controladas exclusivamente pela empresa-pai e injetadas
--   automaticamente antes do prompt de TODOS os agentes
--   conversacionais do sistema.
--
-- Segurança:
--   - RLS habilitada sem policies abertas
--   - Apenas service_role acessa (endpoints backend)
--   - Empresas filhas nunca têm acesso a esta tabela
--
-- Constraint:
--   - UNIQUE (company_id) WHERE is_active = true
--   - Garante exatamente 1 policy ativa por empresa-pai
--   - Permite criar nova versão (is_active=false) sem conflito
-- =====================================================

CREATE TABLE IF NOT EXISTS public.ai_system_policies (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exatamente 1 policy ativa por empresa-pai
CREATE UNIQUE INDEX IF NOT EXISTS ai_system_policies_one_active_per_company
  ON public.ai_system_policies(company_id)
  WHERE is_active = true;

-- Nenhuma policy pública — apenas service_role acessa
ALTER TABLE public.ai_system_policies ENABLE ROW LEVEL SECURITY;

-- Trigger de updated_at
CREATE TRIGGER set_updated_at_ai_system_policies
  BEFORE UPDATE ON public.ai_system_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ai_system_policies IS
  'Diretrizes globais de comportamento da IA. Controladas exclusivamente pela empresa-pai. '
  'Injetadas no topo de TODOS os system prompts dos agentes conversacionais. '
  'Nunca expostas a empresas filhas ou ao frontend.';
