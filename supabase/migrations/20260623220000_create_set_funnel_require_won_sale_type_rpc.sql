-- =====================================================
-- Migration: RPC set_funnel_require_won_sale_type
-- Objetivo: Configurar require_won_sale_type em um funil
--           com validação de role e tipos ativos.
-- Sem restrição de plano — disponível para todos.
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_funnel_require_won_sale_type(
  p_funnel_id  UUID,
  p_company_id UUID,
  p_value      BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Autorização: Trilha 1 ou Trilha 2 ──
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
    RAISE EXCEPTION 'SALE_TYPE_CONFIG_ACCESS_DENIED'
      USING HINT = 'Sem permissão para configurar este funil.';
  END IF;

  -- ── Funil pertence à empresa ──
  IF NOT EXISTS (
    SELECT 1 FROM sales_funnels
    WHERE id         = p_funnel_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'SALE_TYPE_CONFIG_FUNNEL_NOT_FOUND'
      USING HINT = 'Funil não encontrado ou não pertence a esta empresa.';
  END IF;

  -- ── Ao habilitar: exige ao menos um tipo ativo ──
  IF p_value = true THEN
    IF NOT EXISTS (
      SELECT 1 FROM sale_types
      WHERE company_id = p_company_id
        AND is_active  = true
    ) THEN
      RAISE EXCEPTION 'NO_ACTIVE_SALE_TYPES'
        USING HINT = 'Cadastre ou ative ao menos um tipo de venda antes de habilitar esta opção.';
    END IF;
  END IF;

  -- ── Persistir ──
  UPDATE sales_funnels
     SET require_won_sale_type = p_value,
         updated_at            = now()
   WHERE id         = p_funnel_id
     AND company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_funnel_require_won_sale_type(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_funnel_require_won_sale_type(UUID, UUID, BOOLEAN) TO authenticated;
