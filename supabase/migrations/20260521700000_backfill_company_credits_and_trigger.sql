-- =============================================================================
-- Backfill company_credits para empresas sem registro
-- + Trigger AFTER INSERT ON companies para novas empresas
--
-- Problema:
--   A migration 20260424100000 criou a tabela e inseriu linhas para as
--   empresas existentes naquele momento. Empresas criadas depois ficaram
--   sem registro em company_credits, causando 406 no frontend.
--
-- Solução:
--   1. Backfill: inserir linha zerada para todas as empresas sem registro.
--   2. Trigger: garantir que novas empresas sempre tenham linha em company_credits.
-- =============================================================================

-- ── 1. Backfill ───────────────────────────────────────────────────────────────

INSERT INTO public.company_credits (company_id)
SELECT id FROM public.companies
WHERE id NOT IN (SELECT company_id FROM public.company_credits)
ON CONFLICT (company_id) DO NOTHING;

-- ── 2. Função do trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_company_credits_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_credits (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 3. Trigger na tabela companies ───────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_create_company_credits ON public.companies;

CREATE TRIGGER trg_create_company_credits
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.create_company_credits_row();
