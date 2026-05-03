-- ============================================================================
-- Migration: create dashboard_ai_prompts
--
-- Tabela de prompts complementares por empresa + tipo de análise.
-- O prompt armazenado aqui complementa o prompt base fixo do backend.
-- NUNCA substitui persona, regras de segurança, schema JSON ou instrução final.
--
-- Acesso:
--   SELECT  — membro ativo da empresa (auth_user_is_company_member)
--   DML     — admin da empresa (auth_user_is_company_admin)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_ai_prompts (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  analysis_type TEXT        NOT NULL,
  custom_prompt TEXT        NOT NULL DEFAULT '',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  updated_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Um prompt por empresa por tipo
  CONSTRAINT uq_dap_company_type UNIQUE (company_id, analysis_type),

  -- Somente tipos MVP suportados
  CONSTRAINT chk_dap_analysis_type CHECK (
    analysis_type IN ('cooling_opportunities', 'conversion_drop', 'funnel_overview')
  ),

  -- Limite de tamanho do complemento
  CONSTRAINT chk_dap_prompt_length CHECK (
    char_length(custom_prompt) <= 1000
  )
);

-- ── Índice ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dap_company_type
  ON public.dashboard_ai_prompts (company_id, analysis_type);

-- ── Trigger updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_dashboard_ai_prompts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dap_updated_at
  BEFORE UPDATE ON public.dashboard_ai_prompts
  FOR EACH ROW EXECUTE FUNCTION update_dashboard_ai_prompts_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.dashboard_ai_prompts ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa pode ler
CREATE POLICY dap_select ON public.dashboard_ai_prompts
  FOR SELECT TO authenticated
  USING (auth_user_is_company_member(company_id));

-- INSERT: somente admin da empresa
CREATE POLICY dap_insert ON public.dashboard_ai_prompts
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_is_company_admin(company_id));

-- UPDATE: somente admin da empresa
CREATE POLICY dap_update ON public.dashboard_ai_prompts
  FOR UPDATE TO authenticated
  USING  (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- DELETE: somente admin da empresa
CREATE POLICY dap_delete ON public.dashboard_ai_prompts
  FOR DELETE TO authenticated
  USING (auth_user_is_company_admin(company_id));

-- ── Comentários ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.dashboard_ai_prompts IS
  'Prompts complementares por empresa para IA Analítica do Dashboard. Complementam o prompt base fixo do backend.';

COMMENT ON COLUMN public.dashboard_ai_prompts.custom_prompt IS
  'Texto complementar (máx. 1000 chars) inserido após TYPE_INSTRUCTIONS e antes do bloco de contexto. Não substitui regras de segurança nem schema JSON.';

COMMENT ON COLUMN public.dashboard_ai_prompts.is_active IS
  'Se false, o complemento é ignorado e apenas o prompt base é usado.';
