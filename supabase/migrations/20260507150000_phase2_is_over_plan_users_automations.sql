-- =============================================================================
-- MIGRATION: Fase 2 — is_over_plan para company_users e automation_flows
--
-- O QUE ESTA MIGRATION FAZ:
--   ✓ Adiciona is_over_plan em company_users e automation_flows
--   ✓ Cria índices de suporte
--   ✓ Cria função recalculate_users_over_plan(p_company_id)
--   ✓ Cria função recalculate_automation_flows_over_plan(p_company_id)
--   ✓ Atualiza recalculate_all_plan_limits adicionando blocos C e D
--   ✓ Executa backfill para todas as empresas com plano ativo
--
-- REGRAS DE NEGÓCIO:
--   company_users:
--     - Conta: is_active = true AND is_platform_member = false
--     - Proteção: mais antigos por created_at ASC, id ASC
--     - is_over_plan = true NUNCA bloqueia login ou sessão
--
--   automation_flows:
--     - Conta: APENAS is_active = true (consistente com triggers existentes)
--     - Proteção: mais antigos por created_at ASC, id ASC
--     - Flows inativos ficam sempre is_over_plan = false
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUNAS is_over_plan
-- -----------------------------------------------------------------------------

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS is_over_plan boolean NOT NULL DEFAULT false;

ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS is_over_plan boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 2. ÍNDICES
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_company_users_is_over_plan
  ON public.company_users (company_id, is_over_plan)
  WHERE is_over_plan = true;

CREATE INDEX IF NOT EXISTS idx_automation_flows_is_over_plan
  ON public.automation_flows (company_id, is_over_plan)
  WHERE is_over_plan = true;

-- -----------------------------------------------------------------------------
-- 3. FUNÇÃO: recalculate_users_over_plan
--
-- Contagem: is_active = true AND is_platform_member = false
-- Ordenação: created_at ASC, id ASC (usuários mais antigos ficam protegidos)
-- NULL em max_users = ilimitado — apenas reseta, não marca excedentes
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_users_over_plan(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_max_users integer;
BEGIN

  -- Buscar limite do plano
  SELECT pl.max_users
    INTO v_max_users
    FROM public.companies c
    LEFT JOIN public.plans pl
           ON pl.id = c.plan_id
          AND pl.is_active = true
   WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN; -- empresa não encontrada: noop seguro
  END IF;

  -- C1. Reset sempre executado (idempotência; limpa upgrade automaticamente)
  UPDATE public.company_users
     SET is_over_plan = false
   WHERE company_id = p_company_id;

  -- C2. Marcar excedentes — pulado se max_users IS NULL (ilimitado)
  IF v_max_users IS NOT NULL THEN
    UPDATE public.company_users cu
       SET is_over_plan = true
      FROM (
        SELECT id
          FROM public.company_users
         WHERE company_id        = p_company_id
           AND is_active         = true
           AND is_platform_member = false
         ORDER BY created_at ASC, id ASC
        OFFSET v_max_users
      ) excedentes
     WHERE cu.id         = excedentes.id
       AND cu.company_id = p_company_id;
  END IF;

END;
$$;

-- -----------------------------------------------------------------------------
-- 4. FUNÇÃO: recalculate_automation_flows_over_plan
--
-- Contagem: APENAS is_active = true (alinhado com triggers de criação/reativação)
-- Flows inativos ficam sempre is_over_plan = false após reset
-- NULL em max_automation_flows = ilimitado — apenas reseta
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_automation_flows_over_plan(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_max_flows integer;
BEGIN

  -- Buscar limite do plano
  SELECT pl.max_automation_flows
    INTO v_max_flows
    FROM public.companies c
    LEFT JOIN public.plans pl
           ON pl.id = c.plan_id
          AND pl.is_active = true
   WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- D1. Reset sempre executado (inclui flows inativos — todos ficam false)
  UPDATE public.automation_flows
     SET is_over_plan = false
   WHERE company_id = p_company_id;

  -- D2. Marcar excedentes entre flows ATIVOS — pulado se max_automation_flows IS NULL
  IF v_max_flows IS NOT NULL THEN
    UPDATE public.automation_flows af
       SET is_over_plan = true
      FROM (
        SELECT id
          FROM public.automation_flows
         WHERE company_id = p_company_id
           AND is_active  = true
         ORDER BY created_at ASC, id ASC
        OFFSET v_max_flows
      ) excedentes
     WHERE af.id         = excedentes.id
       AND af.company_id = p_company_id;
  END IF;

END;
$$;

-- -----------------------------------------------------------------------------
-- 5. ATUALIZAR recalculate_all_plan_limits — adicionar blocos C e D
--
-- A função existente (Fase 1) já contemplava funis e etapas (blocos A e B).
-- Adicionamos aqui os blocos C (usuários) e D (automações).
-- O trigger recalculate_funnels_on_plan_change já invoca esta função —
-- nenhum novo trigger é necessário.
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
    RETURN;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOCO A — FUNIS (sales_funnels)
  -- Regra: TODOS os funis contam (ativos e inativos)
  -- ══════════════════════════════════════════════════════════════════════════

  UPDATE public.sales_funnels
     SET is_over_plan = false
   WHERE company_id = p_company_id;

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
  -- Regra: apenas etapas de funis válidos (is_over_plan = false)
  -- ══════════════════════════════════════════════════════════════════════════

  UPDATE public.funnel_stages fs
     SET is_over_plan = false
    FROM public.sales_funnels sf
   WHERE fs.funnel_id  = sf.id
     AND sf.company_id = p_company_id;

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

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOCO C — USUÁRIOS (company_users)
  -- Fase 2: is_active = true AND is_platform_member = false
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM public.recalculate_users_over_plan(p_company_id);

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOCO D — AUTOMAÇÕES (automation_flows)
  -- Fase 2: apenas flows is_active = true
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM public.recalculate_automation_flows_over_plan(p_company_id);

END;
$$;

-- -----------------------------------------------------------------------------
-- 6. BACKFILL — recalcular todas as empresas com plano ativo
-- Executado em lote dentro de bloco anônimo para isolar erros por empresa.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
      FROM public.companies
     WHERE plan_id IS NOT NULL
       AND deleted_at IS NULL
     ORDER BY created_at ASC
  LOOP
    BEGIN
      PERFORM public.recalculate_all_plan_limits(r.id);
    EXCEPTION WHEN OTHERS THEN
      -- Erro em uma empresa não interrompe o backfill das demais
      RAISE WARNING 'recalculate_all_plan_limits falhou para company_id=%: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
