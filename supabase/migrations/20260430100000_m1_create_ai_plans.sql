-- ============================================================
-- M1 — Criar tabela ai_plans
-- Data: 2026-04-30
--
-- Objetivo:
--   Criar entidade própria para Planos de IA, separada de plans.
--   Cada Plano CRM (plans) terá exatamente 1 Plano de IA (ai_plans)
--   via FK plans.ai_plan_id → ai_plans.id (adicionada em M2).
--
-- Campos derivados de governança (estimated_tokens, estimated_ai_cost,
-- estimated_profit) NÃO são colunas — são calculados nas RPCs admin-only.
--
-- RLS:
--   SELECT / ALL → auth_user_is_platform_admin() exclusivamente.
--   Empresa filha nunca deve ver dados de ai_plans diretamente.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. TABELA: ai_plans
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_plans (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100)   NOT NULL,
  slug            VARCHAR(50)    NOT NULL,
  monthly_credits INTEGER        NOT NULL DEFAULT 0,
  internal_price  DECIMAL(10,2)  NOT NULL DEFAULT 0 CHECK (internal_price >= 0),
  is_active       BOOLEAN        NOT NULL DEFAULT true,
  sort_order      INTEGER        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by      UUID           REFERENCES auth.users(id),
  updated_by      UUID           REFERENCES auth.users(id),

  CONSTRAINT ai_plans_name_unique UNIQUE (name),
  CONSTRAINT ai_plans_slug_unique UNIQUE (slug),
  CONSTRAINT ai_plans_monthly_credits_non_negative CHECK (monthly_credits >= 0)
);

COMMENT ON TABLE public.ai_plans IS
  'Planos de IA separados dos Planos CRM (plans). '
  'Cada plans tem exatamente 1 ai_plans via plans.ai_plan_id FK. '
  'monthly_credits: cota mensal de créditos de IA do plano. '
  'internal_price: custo interno de governança — não é preço de venda ao cliente.';

COMMENT ON COLUMN public.ai_plans.monthly_credits IS
  'Cota mensal de créditos de IA. Substitui plans.monthly_ai_credits. '
  'Usado por renew_company_credits para repor company_credits.plan_credits.';

COMMENT ON COLUMN public.ai_plans.internal_price IS
  'Custo interno de governança (ex: custo OpenAI estimado). '
  'NOT NULL, DEFAULT 0, CHECK >= 0. Não é preço de venda ao cliente. '
  'Usado apenas em RPCs admin-only para calcular estimated_profit.';

-- ══════════════════════════════════════════════════════════════
-- 2. ÍNDICES
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ai_plans_slug     ON public.ai_plans (slug);
CREATE INDEX IF NOT EXISTS idx_ai_plans_active   ON public.ai_plans (is_active);
CREATE INDEX IF NOT EXISTS idx_ai_plans_sort     ON public.ai_plans (sort_order);

-- ══════════════════════════════════════════════════════════════
-- 3. TRIGGER: updated_at automático
-- ══════════════════════════════════════════════════════════════

CREATE TRIGGER update_ai_plans_updated_at
  BEFORE UPDATE ON public.ai_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ══════════════════════════════════════════════════════════════
-- 4. RLS
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.ai_plans ENABLE ROW LEVEL SECURITY;

-- Somente platform admin pode ver e modificar ai_plans.
-- auth_user_is_platform_admin() verifica:
--   company_users.role IN ('super_admin','system_admin')
--   AND companies.company_type = 'parent'
--   AND company_users.is_active = true
CREATE POLICY "ai_plans_all_platform_admin"
  ON public.ai_plans
  FOR ALL
  TO authenticated
  USING  (public.auth_user_is_platform_admin())
  WITH CHECK (public.auth_user_is_platform_admin());

COMMENT ON POLICY "ai_plans_all_platform_admin" ON public.ai_plans IS
  'Acesso total exclusivo para super_admin ou system_admin em empresa parent. '
  'Empresa filha não enxerga nenhum registro de ai_plans via SELECT direto.';

DO $$
BEGIN
  RAISE LOG 'M1 aplicada: tabela ai_plans criada com RLS, índices e trigger updated_at';
END;
$$;
