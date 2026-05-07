-- =============================================================================
-- Migration: phase1_is_over_plan_funnels
-- Data: 2026-05-07
--
-- Objetivo:
--   Fase 1 do sistema de controle de limites de plano.
--   Introduz rastreamento de excedência de plano para funis e etapas.
--
-- O que esta migration faz:
--   ✓ Adiciona is_over_plan em sales_funnels e funnel_stages
--   ✓ Cria índices de suporte para consultas de is_over_plan
--   ✓ Cria função recalculate_all_plan_limits(p_company_id)
--   ✓ Cria trigger AFTER UPDATE OF plan_id em companies
--   ✓ Executa backfill para todas as empresas com plano ativo
--
-- Regras de negócio:
--   • Todos os funis contam para o limite (ativos e inativos)
--   • Etapas system (is_system_stage = true) nunca são marcadas is_over_plan
--   • Etapas de funis excedentes ficam com is_over_plan = false
--   • max_* IS NULL = plano ilimitado → todos ficam false
--
-- Não altera:
--   • RLS existente
--   • Triggers enforce_funnel_limit / enforce_funnel_stages_limit
--   • Nenhum dado é deletado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUNAS
-- -----------------------------------------------------------------------------

ALTER TABLE public.sales_funnels
  ADD COLUMN IF NOT EXISTS is_over_plan boolean NOT NULL DEFAULT false;

ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS is_over_plan boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 2. ÍNDICES
-- -----------------------------------------------------------------------------

-- Suporte ao filtro de funis válidos na query de etapas (Bloco B2)
-- e para leitura de status no frontend
CREATE INDEX IF NOT EXISTS idx_sales_funnels_over_plan
  ON public.sales_funnels (company_id, is_over_plan);

-- Suporte ao OFFSET query (Bloco A2): WHERE company_id = ? ORDER BY created_at ASC, id ASC
CREATE INDEX IF NOT EXISTS idx_sales_funnels_created_at_id
  ON public.sales_funnels (company_id, created_at ASC, id ASC);

-- Suporte à leitura de etapas excedentes no frontend
CREATE INDEX IF NOT EXISTS idx_funnel_stages_over_plan
  ON public.funnel_stages (funnel_id, is_over_plan);

-- -----------------------------------------------------------------------------
-- 3. FUNÇÃO: recalculate_all_plan_limits
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_all_plan_limits(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_max_funnels integer;
  v_max_stages  integer;
BEGIN

  -- ── 1. Limites do plano operacional ────────────────────────────────────────
  SELECT pl.max_funnels,
         pl.max_funnel_stages
    INTO v_max_funnels,
         v_max_stages
    FROM public.companies c
    LEFT JOIN public.plans pl
           ON pl.id = c.plan_id
          AND pl.is_active = true
   WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN; -- empresa não encontrada: noop seguro
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOCO A — FUNIS (sales_funnels)
  --
  -- Regra: TODOS os funis contam (ativos e inativos)
  -- Proteção: os N mais antigos por created_at ASC (id ASC como tiebreaker)
  -- ══════════════════════════════════════════════════════════════════════════

  -- A1. Reset sempre executado (idempotência; limpa upgrade de plano automaticamente)
  UPDATE public.sales_funnels
     SET is_over_plan = false
   WHERE company_id = p_company_id;

  -- A2. Marcar excedentes — pulado apenas se max_funnels IS NULL (ilimitado)
  IF v_max_funnels IS NOT NULL THEN
    UPDATE public.sales_funnels sf
       SET is_over_plan = true
      FROM (
        SELECT id
          FROM public.sales_funnels
         WHERE company_id = p_company_id
         ORDER BY created_at ASC, id ASC
        OFFSET v_max_funnels
      ) excedentes
     WHERE sf.id         = excedentes.id
       AND sf.company_id = p_company_id;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOCO B — ETAPAS (funnel_stages)
  --
  -- Regra: avalia apenas etapas de funis válidos (is_over_plan = false)
  -- Etapas de funis excedentes permanecem false (funil já está marcado)
  -- Etapas system (is_system_stage = true) nunca recebem is_over_plan = true
  -- Limite aplicado por funil (PARTITION BY funnel_id)
  -- ══════════════════════════════════════════════════════════════════════════

  -- B1. Reset sempre executado (cobre todos os funis da empresa)
  UPDATE public.funnel_stages fs
     SET is_over_plan = false
    FROM public.sales_funnels sf
   WHERE fs.funnel_id  = sf.id
     AND sf.company_id = p_company_id;

  -- B2. Marcar etapas não-system excedentes — pulado se max_funnel_stages IS NULL
  --     Escopo: apenas funis com is_over_plan = false (resultado de A2, mesma transação)
  IF v_max_stages IS NOT NULL THEN
    UPDATE public.funnel_stages fs
       SET is_over_plan = true
      FROM (
        SELECT ranked.id
          FROM (
            SELECT fs2.id,
                   ROW_NUMBER() OVER (
                     PARTITION BY fs2.funnel_id
                     ORDER BY fs2.position ASC, fs2.id ASC
                   ) AS rn
              FROM public.funnel_stages fs2
              JOIN public.sales_funnels sf2
                ON sf2.id           = fs2.funnel_id
               AND sf2.company_id   = p_company_id
               AND sf2.is_over_plan = false
             WHERE COALESCE(fs2.is_system_stage, false) = false
          ) ranked
         WHERE ranked.rn > v_max_stages
      ) excedentes
     WHERE fs.id = excedentes.id;
  END IF;

  -- Fase 2 (futuro): users e automation_flows
  -- PERFORM public.recalculate_users_over_plan(p_company_id);
  -- PERFORM public.recalculate_automation_flows_over_plan(p_company_id);

END;
$$;

-- -----------------------------------------------------------------------------
-- 4. TRIGGER: AFTER UPDATE OF plan_id ON companies
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_recalculate_funnels_on_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF OLD.plan_id IS DISTINCT FROM NEW.plan_id THEN
    PERFORM public.recalculate_all_plan_limits(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalculate_funnels_on_plan_change ON public.companies;

CREATE TRIGGER recalculate_funnels_on_plan_change
  AFTER UPDATE OF plan_id
  ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recalculate_funnels_on_plan_change();

-- -----------------------------------------------------------------------------
-- 5. BACKFILL
--    Recalcula todas as empresas com plano ativo para popular is_over_plan
--    nos registros já existentes. Idempotente: pode ser re-executado com segurança.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
      FROM public.companies
     WHERE plan_id IS NOT NULL
     ORDER BY created_at ASC
  LOOP
    PERFORM public.recalculate_all_plan_limits(r.id);
  END LOOP;
END;
$$;
