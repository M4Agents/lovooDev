-- ============================================================
-- M3 — Alterar tabela companies
-- Data: 2026-04-30
-- Depende de: M2 (plans deve ter ai_plan_id para FK ser relevante)
--
-- Objetivo:
--   1. Expandir CHECK constraint de companies.plan para incluir novos slugs
--   2. Adicionar companies.plan_id FK → plans.id (nullable — transição)
--   3. Manter companies.plan (slug TEXT) temporariamente para compatibilidade
--
-- companies.plan_id = fonte de verdade futura
-- companies.plan    = legado temporário — removido em M7
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. EXPANDIR CHECK CONSTRAINT de companies.plan
--
-- A constraint atual aceita apenas: 'basic', 'pro', 'enterprise'
-- Precisamos incluir os novos slugs: 'starter', 'growth', 'elite'
-- Manter os antigos durante transição (empresas de teste podem ter slugs legados).
-- ══════════════════════════════════════════════════════════════

-- Remover constraint antiga
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_plan_check;

-- Recriar com slugs expandidos
ALTER TABLE public.companies
  ADD CONSTRAINT companies_plan_check
  CHECK (plan IN (
    -- Slugs legados (temporários — removidos junto com companies.plan em M7)
    'basic', 'pro', 'enterprise',
    -- Slugs novos (definitivos)
    'starter', 'growth', 'elite'
  ));

COMMENT ON COLUMN public.companies.plan IS
  'LEGADO TEMPORÁRIO — slug do plano. '
  'Substituído por plan_id (FK). Será removido em M7. '
  'Slugs válidos: starter, growth, pro, elite (novos) | basic, enterprise (legados).';

-- ══════════════════════════════════════════════════════════════
-- 2. ADICIONAR companies.plan_id FK → plans.id
--
-- Nullable agora — será NOT NULL em M7 após seed e validação.
-- ON DELETE SET NULL: empresa não é deletada se o plano for removido.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS plan_id UUID NULL
  REFERENCES public.plans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.companies.plan_id IS
  'FK para plans. Fonte de verdade do plano da empresa (substitui companies.plan). '
  'Nullable durante migração — será NOT NULL após M7. '
  'Populado automaticamente em M4 via lookup por slug.';

-- ══════════════════════════════════════════════════════════════
-- 3. ÍNDICE: plan_id (para JOINs em RPCs de crédito e limite)
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_companies_plan_id ON public.companies (plan_id);

DO $$
BEGIN
  RAISE LOG 'M3 aplicada: companies.plan_id FK adicionado, CHECK constraint expandido para novos slugs';
END;
$$;
