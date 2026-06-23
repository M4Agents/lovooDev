-- =====================================================
-- Migration: RPC set_funnel_require_won_items
-- Objetivo: Configurar require_won_items em um funil
--           com validação de entitlement e de role.
-- Padrão: mesmo modelo de set_company_opportunity_items_enabled.
-- Segurança:
--   - SECURITY DEFINER (usa contexto do sistema)
--   - Valida membership + role (Trilha 1) ou parent admin (Trilha 2)
--   - Valida entitlement: opportunity_items_enabled + plano pro/enterprise
--   - Valida ownership do funil na empresa
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_funnel_require_won_items(
  p_funnel_id  UUID,
  p_company_id UUID,
  p_value      BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan                    TEXT;
  v_opportunity_items_ok    BOOLEAN;
BEGIN
  -- ── Autorização: Trilha 1 (admin direto) ou Trilha 2 (parent admin) ──
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    OR public.auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'REQUIRE_WON_ITEMS_ACCESS_DENIED'
      USING HINT = 'Sem permissão para configurar este funil.';
  END IF;

  -- ── Validar que o funil pertence à empresa ──
  IF NOT EXISTS (
    SELECT 1 FROM sales_funnels
    WHERE id         = p_funnel_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'REQUIRE_WON_ITEMS_FUNNEL_NOT_FOUND'
      USING HINT = 'Funil não encontrado ou não pertence a esta empresa.';
  END IF;

  -- ── Entitlement: só exigir quando habilitando ──
  IF p_value = true THEN
    SELECT plan, opportunity_items_enabled
      INTO v_plan, v_opportunity_items_ok
      FROM companies
     WHERE id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REQUIRE_WON_ITEMS_ACCESS_DENIED'
        USING HINT = 'Empresa não encontrada.';
    END IF;

    IF v_plan NOT IN ('pro', 'enterprise') THEN
      RAISE EXCEPTION 'REQUIRE_WON_ITEMS_NOT_ENTITLED'
        USING HINT = 'Seu plano atual não inclui este recurso. Faça upgrade para Pro ou Enterprise.';
    END IF;

    IF NOT COALESCE(v_opportunity_items_ok, false) THEN
      RAISE EXCEPTION 'REQUIRE_WON_ITEMS_NOT_ENTITLED'
        USING HINT = 'O catálogo de produtos/serviços não está habilitado para esta empresa.';
    END IF;
  END IF;

  -- ── Persistir ──
  UPDATE sales_funnels
     SET require_won_items = p_value,
         updated_at        = now()
   WHERE id         = p_funnel_id
     AND company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_funnel_require_won_items(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_funnel_require_won_items(UUID, UUID, BOOLEAN) TO authenticated;
