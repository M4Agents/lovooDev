-- =====================================================
-- Migration: atualizar RPCs para filtro de visibilidade
--
-- opportunity_add_sale_type: rejeitar tipo oculto/inativo
-- set_funnel_require_won_sale_type: validar tipo visível
--
-- Regra de visibilidade:
--   Custom: is_system=false AND is_active=true
--   Sistema: is_system=true AND is_active=true AND is_hidden=false
-- =====================================================

-- =====================================================
-- opportunity_add_sale_type
-- =====================================================
CREATE OR REPLACE FUNCTION opportunity_add_sale_type(
  p_company_id     UUID,
  p_opportunity_id UUID,
  p_sale_type_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp_status VARCHAR(50);
  v_result_id  UUID;
BEGIN
  -- Autorização: membro ativo da empresa ou parent admin
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
    OR auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_ACCESS_DENIED'
      USING HINT = 'Sem permissão para modificar esta oportunidade.';
  END IF;

  -- Oportunidade existe e pertence à empresa
  SELECT status INTO v_opp_status
  FROM opportunities
  WHERE id         = p_opportunity_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_ACCESS_DENIED'
      USING HINT = 'Oportunidade não encontrada ou sem permissão.';
  END IF;

  IF v_opp_status != 'open' THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_NOT_EDITABLE'
      USING HINT = 'Só é possível adicionar tipos de venda a oportunidades em aberto.';
  END IF;

  -- Visibilidade: tipo deve ser visível
  --   Custom: is_system=false AND is_active=true
  --   Sistema: is_system=true AND is_active=true AND is_hidden=false
  IF NOT EXISTS (
    SELECT 1 FROM sale_types
    WHERE id         = p_sale_type_id
      AND company_id = p_company_id
      AND (
        (is_system = false AND is_active = true)
        OR
        (is_system = true  AND is_active = true AND is_hidden = false)
      )
  ) THEN
    RAISE EXCEPTION 'SALE_TYPE_NOT_FOUND'
      USING HINT = 'Tipo de venda não encontrado, inativo ou oculto.';
  END IF;

  INSERT INTO opportunity_sale_types (company_id, opportunity_id, sale_type_id)
  VALUES (p_company_id, p_opportunity_id, p_sale_type_id)
  ON CONFLICT (opportunity_id, sale_type_id) DO UPDATE
    SET created_at = opportunity_sale_types.created_at
  RETURNING id INTO v_result_id;

  RETURN v_result_id;
END;
$$;

REVOKE ALL    ON FUNCTION opportunity_add_sale_type(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_add_sale_type(UUID, UUID, UUID) TO authenticated;

-- =====================================================
-- set_funnel_require_won_sale_type
-- =====================================================
CREATE OR REPLACE FUNCTION set_funnel_require_won_sale_type(
  p_funnel_id  UUID,
  p_company_id UUID,
  p_value      BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Autorização: admin da empresa ou parent admin
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    OR auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'SALE_TYPE_CONFIG_ACCESS_DENIED'
      USING HINT = 'Sem permissão para configurar este funil.';
  END IF;

  -- Funil pertence à empresa
  IF NOT EXISTS (
    SELECT 1 FROM sales_funnels
    WHERE id         = p_funnel_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'SALE_TYPE_CONFIG_FUNNEL_NOT_FOUND'
      USING HINT = 'Funil não encontrado ou não pertence a esta empresa.';
  END IF;

  -- Ao habilitar: deve existir ao menos um tipo visível
  IF p_value = true THEN
    IF NOT EXISTS (
      SELECT 1 FROM sale_types
      WHERE company_id = p_company_id
        AND (
          (is_system = false AND is_active = true)
          OR
          (is_system = true  AND is_active = true AND is_hidden = false)
        )
    ) THEN
      RAISE EXCEPTION 'NO_ACTIVE_SALE_TYPES'
        USING HINT = 'É necessário ao menos um tipo de venda visível para habilitar esta opção.';
    END IF;
  END IF;

  UPDATE sales_funnels
  SET require_won_sale_type = p_value,
      updated_at            = now()
  WHERE id         = p_funnel_id
    AND company_id = p_company_id;
END;
$$;

REVOKE ALL    ON FUNCTION set_funnel_require_won_sale_type(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_funnel_require_won_sale_type(UUID, UUID, BOOLEAN) TO authenticated;
