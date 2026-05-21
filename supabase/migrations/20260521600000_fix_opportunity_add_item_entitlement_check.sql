-- ============================================================
-- Fix: opportunity_add_item — substituir check inline legado
--      por company_has_opportunity_items_entitlement (M5)
--
-- Problema confirmado via runtime (debug da6971):
--   O check inline usava c.plan IN ('pro', 'enterprise'), lista
--   hardcoded que não incluía 'growth'. Com company_enabled = true
--   e plan = 'growth', o banco lançava OPP_PLAN_FEATURE_DENIED.
--
-- Causa: opportunity_add_item nunca foi atualizada no M5.
--   O M5 (20260430100004) corrigiu company_has_opportunity_items_entitlement
--   e get_opportunity_items_entitlement, mas não o check inline
--   desta função.
--
-- Fix: substituir SELECT c.plan + IF inline pelo helper já correto,
--   igual ao padrão usado pelas demais RPCs do mesmo módulo.
--
-- Demais RPCs afetadas: nenhuma — opportunity_sync_totals,
--   opportunity_update_item, opportunity_remove_item,
--   opportunity_set_value_mode, opportunity_set_global_discount e
--   opportunity_set_manual_value já usam o helper corretamente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.opportunity_add_item(
  p_company_id            uuid,
  p_opportunity_id        uuid,
  p_product_id            uuid    DEFAULT NULL,
  p_service_id            uuid    DEFAULT NULL,
  p_quantity              numeric DEFAULT NULL,
  p_unit_price            numeric DEFAULT NULL,
  p_discount_type         text    DEFAULT 'fixed',
  p_discount_value        numeric DEFAULT 0,
  p_name_snapshot         text    DEFAULT NULL,
  p_description_snapshot  text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_opp_status  text;
  v_mode        text;
  v_line_total  numeric;
  v_name        text;
  v_desc        text;
  v_unit        numeric;
  v_line_type   text;
  v_cat_active  boolean;
  v_avail       text;
  -- v_plan e v_co_en removidos: eram usados apenas pelo check inline
  -- legado substituído abaixo pelo helper company_has_opportunity_items_entitlement
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;

  -- ANTES: check inline com lista hardcoded ('pro', 'enterprise')
  --   SELECT c.plan, COALESCE(c.opportunity_items_enabled, false)
  --   INTO v_plan, v_co_en FROM companies c WHERE c.id = p_company_id;
  --   IF NOT (v_co_en AND v_plan IN ('pro', 'enterprise')) THEN ...
  --
  -- DEPOIS: helper M5 — lê plans.features JSONB ou company override
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;

  PERFORM opp_require_company_currency(p_company_id);

  SELECT o.status, o.value_mode INTO v_opp_status, v_mode
  FROM opportunities o
  WHERE o.id = p_opportunity_id AND o.company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF v_opp_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise(
      'OPP_OPPORTUNITY_NOT_EDITABLE',
      'Esta oportunidade não pode ser editada no estado atual.',
      jsonb_build_object('current_status', v_opp_status)
    );
  END IF;

  IF (p_product_id IS NULL) = (p_service_id IS NULL) THEN
    PERFORM opp_raise('OPP_CATALOG_NOT_FOUND', 'Produto ou serviço não encontrado.');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    PERFORM opp_raise('OPP_INVALID_QUANTITY', 'A quantidade deve ser maior que zero.');
  END IF;

  IF p_product_id IS NOT NULL THEN
    v_line_type := 'product';
    SELECT p.name, p.description, p.default_price, p.is_active, p.availability_status
    INTO v_name, v_desc, v_unit, v_cat_active, v_avail
    FROM products p
    WHERE p.id = p_product_id AND p.company_id = p_company_id;
    IF NOT FOUND THEN
      PERFORM opp_raise('OPP_CATALOG_NOT_FOUND', 'Produto ou serviço não encontrado.');
    END IF;
    IF NOT v_cat_active THEN
      PERFORM opp_raise('OPP_CATALOG_ITEM_INACTIVE', 'Este item está inativo e não pode ser usado.');
    END IF;
    IF v_avail NOT IN ('available', 'on_demand') THEN
      PERFORM opp_raise('OPP_CATALOG_NOT_SALEABLE', 'Este item não está disponível para venda.');
    END IF;
  ELSE
    v_line_type := 'service';
    SELECT s.name, s.description, s.default_price, s.is_active, s.availability_status
    INTO v_name, v_desc, v_unit, v_cat_active, v_avail
    FROM services s
    WHERE s.id = p_service_id AND s.company_id = p_company_id;
    IF NOT FOUND THEN
      PERFORM opp_raise('OPP_CATALOG_NOT_FOUND', 'Produto ou serviço não encontrado.');
    END IF;
    IF NOT v_cat_active THEN
      PERFORM opp_raise('OPP_CATALOG_ITEM_INACTIVE', 'Este item está inativo e não pode ser usado.');
    END IF;
    IF v_avail NOT IN ('available', 'on_demand') THEN
      PERFORM opp_raise('OPP_CATALOG_NOT_SALEABLE', 'Este item não está disponível para venda.');
    END IF;
  END IF;

  IF p_unit_price IS NOT NULL THEN
    v_unit := p_unit_price;
  END IF;
  IF v_unit IS NULL OR v_unit < 0 THEN
    PERFORM opp_raise('OPP_INVALID_QUANTITY', 'Preço unitário inválido.');
  END IF;

  v_line_total := (SELECT o_line_total FROM opp_compute_line_total(v_unit, p_quantity, p_discount_type, p_discount_value));

  INSERT INTO opportunity_items (
    company_id, opportunity_id, product_id, service_id, line_type,
    name_snapshot, description_snapshot, unit_price, quantity,
    discount_type, discount_value, line_total
  ) VALUES (
    p_company_id, p_opportunity_id, p_product_id, p_service_id, v_line_type,
    COALESCE(p_name_snapshot, v_name), p_description_snapshot,
    v_unit, p_quantity, p_discount_type, p_discount_value, v_line_total
  ) RETURNING id INTO v_id;

  SELECT value_mode INTO v_mode FROM opportunities WHERE id = p_opportunity_id;
  IF v_mode = 'items' THEN
    PERFORM opportunity_sync_totals(p_company_id, p_opportunity_id);
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.opportunity_add_item(uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_add_item(uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text, text) TO authenticated;
