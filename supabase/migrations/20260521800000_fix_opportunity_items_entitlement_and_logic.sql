-- =============================================================================
-- Fix: opportunity_items entitlement — OR → AND
--
-- Problema:
--   As funções company_has_opportunity_items_entitlement e
--   get_opportunity_items_entitlement usavam OR:
--
--     RETURN v_plan_feature_enabled OR v_company_override;
--
--   Com todos os planos tendo plans.features.opportunity_items_enabled = true,
--   setar companies.opportunity_items_enabled = false não desabilitava o recurso
--   (true OR false = true), impossibilitando o opt-out da empresa.
--
-- Correção:
--   Trocar OR por AND. Novo comportamento:
--
--     plano permite + empresa ativou   = allowed true   ✓
--     plano permite + empresa desativou = allowed false  ✓ (opt-out funcionando)
--     plano não permite + empresa ativou  = allowed false ✓
--     plano não permite + empresa desativou = allowed false ✓
--
-- Impacto verificado:
--   Empresas com opportunity_items_enabled = true: todas têm plan_feature_ok = true.
--   Com AND: true AND true = true → nenhuma empresa perde acesso.
--   Empresa com opportunity_items_enabled = false (Locadora Obra Fácil):
--   true AND false = false → opt-out passa a funcionar corretamente.
--
-- Não altera: RLS, schema, outros RPCs, frontend.
-- =============================================================================


-- ── 1. company_has_opportunity_items_entitlement ──────────────────────────────

CREATE OR REPLACE FUNCTION public.company_has_opportunity_items_entitlement(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_feature_enabled  BOOLEAN;
  v_company_override      BOOLEAN;
  v_plan_id               UUID;
BEGIN
  -- Buscar feature do plano + escolha da empresa
  SELECT
    c.plan_id,
    COALESCE((pl.features->>'opportunity_items_enabled')::boolean, false),
    COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan_id, v_plan_feature_enabled, v_company_override
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Feature habilitada SOMENTE SE o plano suporta E a empresa optou por usar.
  -- Empresa sem plan_id: plan_feature_enabled = false → sempre false.
  RETURN v_plan_feature_enabled AND v_company_override;
END;
$$;


-- ── 2. get_opportunity_items_entitlement ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_opportunity_items_entitlement(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_feature_enabled  BOOLEAN;
  v_company_override      BOOLEAN;
  v_plan_id               UUID;
  v_plan_slug             TEXT;
BEGIN
  IF NOT public.company_user_has_access(p_company_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_access');
  END IF;

  SELECT
    c.plan_id,
    pl.slug,
    COALESCE((pl.features->>'opportunity_items_enabled')::boolean, false),
    COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan_id, v_plan_slug, v_plan_feature_enabled, v_company_override
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  RETURN jsonb_build_object(
    'allowed',          v_plan_feature_enabled AND v_company_override,
    'plan_id',          v_plan_id,
    'plan_slug',        v_plan_slug,
    'plan_feature_ok',  v_plan_feature_enabled,
    'company_enabled',  v_company_override,
    'plan_ok',          v_plan_feature_enabled
  );
END;
$$;
