-- =====================================================
-- Migration: create_ai_insight_policies
--
-- Tabela de configuração de políticas de insights por empresa.
-- Permite customização futura dos thresholds sem alterar o código.
-- Valores padrão (fallback) definidos em api/lib/dashboard/insightDefaults.ts.
--
-- RLS:
--   - SELECT: membro ativo da empresa
--   - INSERT/UPDATE: bloqueados (apenas via service_role/migration)
-- =====================================================

-- Tabela
CREATE TABLE IF NOT EXISTS public.ai_insight_policies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  policy_key text        NOT NULL,
  value      numeric     NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, policy_key)
);

-- Índice de acesso por empresa (consulta primária)
CREATE INDEX IF NOT EXISTS idx_ai_insight_policies_company
  ON public.ai_insight_policies (company_id);

-- RLS
ALTER TABLE public.ai_insight_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_insight_policies_select"
  ON public.ai_insight_policies
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- INSERT bloqueado: políticas só criadas via migration ou service_role
CREATE POLICY "ai_insight_policies_insert"
  ON public.ai_insight_policies
  FOR INSERT
  WITH CHECK (false);

-- UPDATE bloqueado: alterações apenas via migration ou service_role
CREATE POLICY "ai_insight_policies_update"
  ON public.ai_insight_policies
  FOR UPDATE
  USING (false);

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_insight_policies_updated_at
  BEFORE UPDATE ON public.ai_insight_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
