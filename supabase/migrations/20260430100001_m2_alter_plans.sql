-- ============================================================
-- M2 — Alterar tabela plans
-- Data: 2026-04-30
-- Depende de: M1 (ai_plans deve existir para FK ser criada)
--
-- Objetivo:
--   1. Adicionar ai_plan_id FK (nullable — será NOT NULL em M7)
--   2. Adicionar colunas de limites novos (todas nullable = ilimitado)
--   3. Corrigir default de features de array para objeto JSONB
--   4. Marcar monthly_ai_credits como DEPRECATED (fonte migrou para ai_plans)
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. FK: plans.ai_plan_id → ai_plans.id
--
-- Nullable agora — será NOT NULL em M7 após seed e validação completa.
-- ON DELETE SET NULL: se um ai_plan for deletado, o plans perde a referência
-- mas não é deletado (comportamento seguro durante desenvolvimento).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS ai_plan_id UUID NULL
  REFERENCES public.ai_plans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.plans.ai_plan_id IS
  'FK para ai_plans. Relação 1:1 obrigatória. '
  'Nullable durante migração — será NOT NULL após M7. '
  'plans sem ai_plan_id associado não terão créditos mensais de IA.';

-- ══════════════════════════════════════════════════════════════
-- 2. NOVOS LIMITES CRM (todos nullable = ilimitado/custom)
--
-- NULL = ilimitado. Backend deve interpretar NULL como "sem restrição".
-- Usado pelo plano Elite e futuramente por qualquer plano "custom".
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_funnels                    INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_funnel_stages              INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_automation_flows           INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_automation_executions_monthly INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_products                   INTEGER NULL,
  ADD COLUMN IF NOT EXISTS storage_mb                     INTEGER NULL;

COMMENT ON COLUMN public.plans.max_funnels IS 'Limite de funis. NULL = ilimitado.';
COMMENT ON COLUMN public.plans.max_funnel_stages IS 'Limite de etapas por funil. NULL = ilimitado.';
COMMENT ON COLUMN public.plans.max_automation_flows IS 'Limite de fluxos de automação ativos. NULL = ilimitado.';
COMMENT ON COLUMN public.plans.max_automation_executions_monthly IS 'Limite de execuções de automação por mês. NULL = ilimitado.';
COMMENT ON COLUMN public.plans.max_products IS 'Limite de produtos/serviços cadastrados. NULL = ilimitado.';
COMMENT ON COLUMN public.plans.storage_mb IS 'Limite de armazenamento de mídia em MB. NULL = ilimitado.';

-- ══════════════════════════════════════════════════════════════
-- 3. CORRIGIR features: de array JSON para objeto JSON
--
-- O campo features era DEFAULT '[]'::jsonb (array).
-- O novo padrão usa objeto JSONB: { "chave_enabled": true/false }.
-- Atualizar default e registros existentes com array vazio.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ALTER COLUMN features SET DEFAULT '{}'::jsonb;

-- Converter registros existentes que tenham array vazio para objeto vazio
UPDATE public.plans
SET features = '{}'::jsonb
WHERE features = '[]'::jsonb OR features IS NULL;

COMMENT ON COLUMN public.plans.features IS
  'Features booleanas do plano. Objeto JSONB com chaves no padrão snake_case_enabled. '
  'Ausência da chave = false. Backend: COALESCE((features->>''chave'')::boolean, false). '
  'Chaves definidas: opportunity_items_enabled, multiple_agents_enabled, '
  'follow_up_agent_enabled, scheduling_agent_enabled, cycle_report_enabled, '
  'advanced_debug_logs_enabled.';

-- ══════════════════════════════════════════════════════════════
-- 4. DEPRECAR monthly_ai_credits
--
-- A fonte de créditos mensais migra para ai_plans.monthly_credits.
-- A coluna é mantida temporariamente para compatibilidade durante
-- a transição do frontend e RPCs. Será removida em M7.
-- ══════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.plans.monthly_ai_credits IS
  'DEPRECATED — usar ai_plans.monthly_credits via plans.ai_plan_id. '
  'Mantida apenas durante transição. Será removida em M7.';

-- ══════════════════════════════════════════════════════════════
-- 5. ÍNDICE: ai_plan_id (para JOIN em renew_company_credits)
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_plans_ai_plan_id ON public.plans (ai_plan_id);

DO $$
BEGIN
  RAISE LOG 'M2 aplicada: plans recebeu ai_plan_id FK, 6 colunas de limites, features corrigido para objeto JSONB';
END;
$$;
