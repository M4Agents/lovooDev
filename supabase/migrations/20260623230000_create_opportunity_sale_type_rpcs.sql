-- =====================================================
-- Migration: opportunity_add_sale_type
--            opportunity_remove_sale_type
-- Objetivo: Vincular/desvincular tipos de venda a oportunidades.
-- Segurança: SECURITY DEFINER — único caminho de escrita
--            em opportunity_sale_types (RLS bloqueia direto).
-- =====================================================

-- ─── opportunity_add_sale_type ───────────────────────
CREATE OR REPLACE FUNCTION public.opportunity_add_sale_type(
  p_company_id      UUID,
  p_opportunity_id  UUID,
  p_sale_type_id    UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp_status  VARCHAR(50);
  v_result_id   UUID;
BEGIN
  -- ── Autorização ──
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
    OR public.auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_ACCESS_DENIED'
      USING HINT = 'Sem permissão para modificar esta oportunidade.';
  END IF;

  -- ── Oportunidade existe e pertence à empresa ──
  SELECT status INTO v_opp_status
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_ACCESS_DENIED'
      USING HINT = 'Oportunidade não encontrada ou sem permissão.';
  END IF;

  -- ── Status deve ser open ──
  IF v_opp_status != 'open' THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_NOT_EDITABLE'
      USING HINT = 'Só é possível adicionar tipos de venda a oportunidades em aberto.';
  END IF;

  -- ── Tipo de venda existe, pertence à empresa e está ativo ──
  IF NOT EXISTS (
    SELECT 1 FROM sale_types
    WHERE id         = p_sale_type_id
      AND company_id = p_company_id
      AND is_active  = true
  ) THEN
    RAISE EXCEPTION 'SALE_TYPE_NOT_FOUND'
      USING HINT = 'Tipo de venda não encontrado ou inativo.';
  END IF;

  -- ── Inserção idempotente ──
  INSERT INTO opportunity_sale_types (company_id, opportunity_id, sale_type_id)
  VALUES (p_company_id, p_opportunity_id, p_sale_type_id)
  ON CONFLICT (opportunity_id, sale_type_id) DO UPDATE
    SET created_at = opportunity_sale_types.created_at
  RETURNING id INTO v_result_id;

  RETURN v_result_id;
END;
$$;

REVOKE ALL ON FUNCTION public.opportunity_add_sale_type(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_add_sale_type(UUID, UUID, UUID) TO authenticated;


-- ─── opportunity_remove_sale_type ────────────────────
CREATE OR REPLACE FUNCTION public.opportunity_remove_sale_type(
  p_company_id               UUID,
  p_opportunity_sale_type_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Autorização ──
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
    OR public.auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_ACCESS_DENIED'
      USING HINT = 'Sem permissão para modificar este vínculo.';
  END IF;

  -- ── Remover (valida company_id) ──
  DELETE FROM opportunity_sale_types
  WHERE id         = p_opportunity_sale_type_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_TYPE_LINK_NOT_FOUND'
      USING HINT = 'Vínculo não encontrado ou sem permissão.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.opportunity_remove_sale_type(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_remove_sale_type(UUID, UUID) TO authenticated;
