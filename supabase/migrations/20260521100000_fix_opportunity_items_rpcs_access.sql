-- ============================================================
-- Fix: company_user_has_access + set_company_opportunity_items_enabled
--
-- Problemas corrigidos:
--   1. company_user_has_access: faltava is_active = true e Trilha 2
--   2. set_company_opportunity_items_enabled: faltava system_admin e Trilha 2
--
-- Não altera: catalog_categories, billing, plans, trial, create_client_company_safe
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. company_user_has_access
--
-- ANTES: EXISTS sem is_active, sem Trilha 2
-- DEPOIS: is_active = true obrigatório + fallback Trilha 2
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.company_user_has_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_id = p_company_id
        AND user_id    = auth.uid()
        AND is_active  = true
    )
    OR public.auth_user_is_parent_admin(p_company_id)
  )
$$;

REVOKE ALL ON FUNCTION public.company_user_has_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_user_has_access(uuid) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 2. set_company_opportunity_items_enabled
--
-- ANTES: role IN (...) sem system_admin, sem Trilha 2
-- DEPOIS: system_admin adicionado + fallback auth_user_is_parent_admin
--
-- Preservado: lógica de negócio, roles existentes (admin, manager,
-- partner, super_admin, support), checagem de plano via companies.plan
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_company_opportunity_items_enabled(
  p_company_id uuid,
  p_enabled    boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
BEGIN
  -- Autorização: Trilha 1 (membership direto com role admin) ou Trilha 2 (parent admin)
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'manager', 'partner', 'super_admin', 'system_admin', 'support')
    )
    OR public.auth_user_is_parent_admin(p_company_id)
  ) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;

  -- Empresa deve existir
  SELECT plan INTO v_plan FROM companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;

  -- Checagem de plano (preserva lógica original)
  IF p_enabled AND v_plan NOT IN ('pro', 'enterprise') THEN
    PERFORM opp_raise('OPP_PLAN_FEATURE_DENIED', 'Seu plano atual não inclui este recurso.');
  END IF;

  UPDATE companies
  SET opportunity_items_enabled = p_enabled,
      updated_at                = now()
  WHERE id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_opportunity_items_enabled(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_company_opportunity_items_enabled(uuid, boolean) TO authenticated;
