-- =====================================================
-- RPCs: composição de valor em oportunidades (SECURITY DEFINER)
-- Erros: HINT = código OPP_* (contrato frontend)
-- =====================================================

CREATE OR REPLACE FUNCTION opp_raise(p_code text, p_msg text, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_detail IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = p_msg, HINT = p_code, DETAIL = p_detail::text;
  ELSE
    RAISE EXCEPTION USING MESSAGE = p_msg, HINT = p_code;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION company_user_has_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.company_id = p_company_id AND cu.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION company_has_opportunity_items_entitlement(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_en boolean;
BEGIN
  SELECT c.plan, COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan, v_en
  FROM companies c
  WHERE c.id = p_company_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN v_en AND v_plan IN ('pro', 'enterprise');
END;
$$;

CREATE OR REPLACE FUNCTION get_opportunity_items_entitlement(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_en boolean;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_access');
  END IF;
  SELECT c.plan, COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan, v_en
  FROM companies c WHERE c.id = p_company_id;
  RETURN jsonb_build_object(
    'allowed', v_en AND v_plan IN ('pro', 'enterprise'),
    'plan', v_plan,
    'company_enabled', v_en,
    'plan_ok', v_plan IN ('pro', 'enterprise')
  );
END;
$$;

-- -----------------------------------------------------------------
-- Cálculo de line_total (subtotal arredondado; depois desconto)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opp_compute_line_total(
  p_unit_price numeric,
  p_quantity numeric,
  p_discount_type text,
  p_discount_value numeric,
  OUT o_line_total numeric
)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  subtotal numeric;
  disc_abs numeric;
BEGIN
  subtotal := round(p_unit_price * p_quantity, 2);
  IF p_discount_type = 'fixed' THEN
    IF p_discount_value < 0 OR p_discount_value > subtotal THEN
      PERFORM opp_raise(
        'OPP_DISCOUNT_EXCEEDS_SUBTOTAL',
        'O desconto não pode ser maior que o subtotal.',
        jsonb_build_object('scope', 'line')
      );
    END IF;
    o_line_total := round(subtotal - p_discount_value, 2);
  ELSIF p_discount_type = 'percent' THEN
    IF p_discount_value < 0 OR p_discount_value > 100 THEN
      PERFORM opp_raise('OPP_INVALID_DISCOUNT_PERCENT', 'Informe um percentual entre 0 e 100.');
    END IF;
    disc_abs := round(subtotal * p_discount_value / 100.0, 2);
    o_line_total := round(subtotal - disc_abs, 2);
  ELSE
    PERFORM opp_raise('OPP_INVALID_VALUE_MODE', 'Tipo de desconto inválido na linha.');
  END IF;
  IF o_line_total < 0 THEN
    o_line_total := 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION opp_compute_global_value(
  p_items_subtotal numeric,
  p_discount_type text,
  p_discount_value numeric
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  disc_abs numeric;
  v numeric;
BEGIN
  IF p_discount_type = 'fixed' THEN
    IF p_discount_value < 0 OR p_discount_value > p_items_subtotal THEN
      PERFORM opp_raise(
        'OPP_DISCOUNT_EXCEEDS_SUBTOTAL',
        'O desconto não pode ser maior que o subtotal.',
        jsonb_build_object('scope', 'global')
      );
    END IF;
    v := round(p_items_subtotal - p_discount_value, 2);
  ELSIF p_discount_type = 'percent' THEN
    IF p_discount_value < 0 OR p_discount_value > 100 THEN
      PERFORM opp_raise('OPP_INVALID_DISCOUNT_PERCENT', 'Informe um percentual entre 0 e 100.');
    END IF;
    disc_abs := round(p_items_subtotal * p_discount_value / 100.0, 2);
    v := round(p_items_subtotal - disc_abs, 2);
  ELSE
    PERFORM opp_raise('OPP_INVALID_VALUE_MODE', 'Tipo de desconto global inválido.');
  END IF;
  IF v < 0 THEN
    v := 0;
  END IF;
  RETURN v;
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_sync_totals
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_sync_totals(p_company_id uuid, p_opportunity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  r RECORD;
  v_lt numeric;
  v_items_sum numeric;
  v_dt text;
  v_dv numeric;
  v_val numeric;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;

  SELECT o.value_mode, o.discount_type, o.discount_value
  INTO v_mode, v_dt, v_dv
  FROM opportunities o
  WHERE o.id = p_opportunity_id AND o.company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;

  IF v_mode <> 'items' THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id, unit_price, quantity, discount_type, discount_value FROM opportunity_items
    WHERE opportunity_id = p_opportunity_id AND company_id = p_company_id
  LOOP
    v_lt := (SELECT o_line_total FROM opp_compute_line_total(r.unit_price, r.quantity, r.discount_type, r.discount_value));
    UPDATE opportunity_items SET line_total = v_lt, updated_at = now() WHERE id = r.id;
  END LOOP;

  SELECT COALESCE(round(sum(line_total), 2), 0) INTO v_items_sum
  FROM opportunity_items
  WHERE opportunity_id = p_opportunity_id AND company_id = p_company_id;

  SELECT discount_type, discount_value INTO v_dt, v_dv
  FROM opportunities WHERE id = p_opportunity_id;

  IF v_dt IS NULL THEN
    v_dt := 'fixed';
    v_dv := 0;
  END IF;

  v_val := opp_compute_global_value(v_items_sum, v_dt, COALESCE(v_dv, 0));

  UPDATE opportunities
  SET items_subtotal = v_items_sum,
      value = v_val,
      discount_type = v_dt,
      discount_value = COALESCE(v_dv, 0),
      updated_at = now()
  WHERE id = p_opportunity_id AND company_id = p_company_id;
END;
$$;

-- -----------------------------------------------------------------
-- Validação de moeda empresa
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opp_require_company_currency(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  SELECT trim(default_currency::text) INTO v_cur FROM companies WHERE id = p_company_id;
  IF v_cur IS NULL OR length(v_cur) <> 3 THEN
    PERFORM opp_raise('OPP_COMPANY_CURRENCY_INVALID', 'Configuração de moeda da empresa inválida. Contate o suporte.');
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_add_item
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_add_item(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_product_id uuid DEFAULT NULL,
  p_service_id uuid DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_discount_type text DEFAULT 'fixed',
  p_discount_value numeric DEFAULT 0,
  p_name_snapshot text DEFAULT NULL,
  p_description_snapshot text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_opp_status text;
  v_mode text;
  v_line_total numeric;
  v_name text;
  v_desc text;
  v_unit numeric;
  v_line_type text;
  v_cat_active boolean;
  v_avail text;
  v_plan text;
  v_co_en boolean;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  SELECT c.plan, COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan, v_co_en FROM companies c WHERE c.id = p_company_id;
  IF NOT (v_co_en AND v_plan IN ('pro', 'enterprise')) THEN
    IF NOT v_co_en THEN
      PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
    ELSE
      PERFORM opp_raise('OPP_PLAN_FEATURE_DENIED', 'Seu plano atual não inclui este recurso.');
    END IF;
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

-- -----------------------------------------------------------------
-- opportunity_update_item
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_update_item(
  p_company_id uuid,
  p_item_id uuid,
  p_unit_price numeric DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp uuid;
  v_mode text;
  v_status text;
  v_u numeric;
  v_q numeric;
  v_dt text;
  v_dv numeric;
  v_lt numeric;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;
  PERFORM opp_require_company_currency(p_company_id);

  SELECT oi.opportunity_id, oi.unit_price, oi.quantity, oi.discount_type, oi.discount_value, o.status, o.value_mode
  INTO v_opp, v_u, v_q, v_dt, v_dv, v_status, v_mode
  FROM opportunity_items oi
  JOIN opportunities o ON o.id = oi.opportunity_id
  WHERE oi.id = p_item_id AND oi.company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_ITEM_NOT_FOUND', 'Item não encontrado.');
  END IF;
  IF v_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_NOT_EDITABLE', 'Esta oportunidade não pode ser editada no estado atual.');
  END IF;

  IF p_unit_price IS NOT NULL THEN v_u := p_unit_price; END IF;
  IF p_quantity IS NOT NULL THEN
    IF p_quantity <= 0 THEN
      PERFORM opp_raise('OPP_INVALID_QUANTITY', 'A quantidade deve ser maior que zero.');
    END IF;
    v_q := p_quantity;
  END IF;
  IF p_discount_type IS NOT NULL THEN v_dt := p_discount_type; END IF;
  IF p_discount_value IS NOT NULL THEN v_dv := p_discount_value; END IF;

  v_lt := (SELECT o_line_total FROM opp_compute_line_total(v_u, v_q, v_dt, v_dv));

  UPDATE opportunity_items
  SET unit_price = v_u, quantity = v_q, discount_type = v_dt, discount_value = v_dv,
      line_total = v_lt, updated_at = now()
  WHERE id = p_item_id AND company_id = p_company_id;

  IF v_mode = 'items' THEN
    PERFORM opportunity_sync_totals(p_company_id, v_opp);
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_remove_item
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_remove_item(p_company_id uuid, p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp uuid;
  v_mode text;
  v_status text;
  v_cnt int;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;

  SELECT oi.opportunity_id, o.value_mode, o.status
  INTO v_opp, v_mode, v_status
  FROM opportunity_items oi
  JOIN opportunities o ON o.id = oi.opportunity_id
  WHERE oi.id = p_item_id AND oi.company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_ITEM_NOT_FOUND', 'Item não encontrado.');
  END IF;
  IF v_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_NOT_EDITABLE', 'Esta oportunidade não pode ser editada no estado atual.');
  END IF;

  DELETE FROM opportunity_items WHERE id = p_item_id AND company_id = p_company_id;

  IF v_mode = 'items' THEN
    SELECT count(*) INTO v_cnt FROM opportunity_items WHERE opportunity_id = v_opp AND company_id = p_company_id;
    IF v_cnt = 0 THEN
      UPDATE opportunities
      SET items_subtotal = 0, value = 0, updated_at = now()
      WHERE id = v_opp AND company_id = p_company_id;
    ELSE
      PERFORM opportunity_sync_totals(p_company_id, v_opp);
    END IF;
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_set_value_mode
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_set_value_mode(p_company_id uuid, p_opportunity_id uuid, p_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_cnt int;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;
  PERFORM opp_require_company_currency(p_company_id);

  SELECT status INTO v_status FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF v_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_NOT_EDITABLE', 'Esta oportunidade não pode ser editada no estado atual.');
  END IF;

  IF p_mode NOT IN ('manual', 'items') THEN
    PERFORM opp_raise('OPP_INVALID_VALUE_MODE', 'Modo de valor inválido.');
  END IF;

  IF p_mode = 'items' THEN
    SELECT count(*) INTO v_cnt FROM opportunity_items WHERE opportunity_id = p_opportunity_id AND company_id = p_company_id;
    IF v_cnt < 1 THEN
      PERFORM opp_raise('OPP_NO_LINES_FOR_ITEMS_MODE', 'Inclua pelo menos um item para usar o modo por itens.');
    END IF;
    UPDATE opportunities
    SET value_mode = 'items',
        discount_type = COALESCE(discount_type, 'fixed'),
        discount_value = COALESCE(discount_value, 0),
        items_subtotal = NULL,
        updated_at = now()
    WHERE id = p_opportunity_id AND company_id = p_company_id;
    PERFORM opportunity_sync_totals(p_company_id, p_opportunity_id);
  ELSE
    UPDATE opportunities
    SET value_mode = 'manual',
        items_subtotal = NULL,
        discount_type = NULL,
        discount_value = NULL,
        updated_at = now()
    WHERE id = p_opportunity_id AND company_id = p_company_id;
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_set_global_discount
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_set_global_discount(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_discount_type text,
  p_discount_value numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_status text;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;
  PERFORM opp_require_company_currency(p_company_id);

  SELECT value_mode, status INTO v_mode, v_status
  FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF v_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_NOT_EDITABLE', 'Esta oportunidade não pode ser editada no estado atual.');
  END IF;
  IF v_mode <> 'items' THEN
    PERFORM opp_raise('OPP_WRONG_VALUE_MODE', 'Esta ação não está disponível no modo de valor atual.');
  END IF;

  UPDATE opportunities
  SET discount_type = p_discount_type,
      discount_value = p_discount_value,
      updated_at = now()
  WHERE id = p_opportunity_id AND company_id = p_company_id;

  PERFORM opportunity_sync_totals(p_company_id, p_opportunity_id);
END;
$$;

-- -----------------------------------------------------------------
-- opportunity_set_manual_value
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION opportunity_set_manual_value(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_value numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_status text;
BEGIN
  IF NOT company_user_has_access(p_company_id) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF NOT company_has_opportunity_items_entitlement(p_company_id) THEN
    PERFORM opp_raise('OPP_FEATURE_NOT_ENABLED', 'Recurso não habilitado para esta empresa.');
  END IF;
  PERFORM opp_require_company_currency(p_company_id);

  SELECT value_mode, status INTO v_mode, v_status
  FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF v_status IS DISTINCT FROM 'open' THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_NOT_EDITABLE', 'Esta oportunidade não pode ser editada no estado atual.');
  END IF;
  IF v_mode <> 'manual' THEN
    PERFORM opp_raise('OPP_WRONG_VALUE_MODE', 'Esta ação não está disponível no modo de valor atual.');
  END IF;
  IF p_value < 0 THEN
    PERFORM opp_raise('OPP_INVALID_QUANTITY', 'Valor inválido.');
  END IF;

  UPDATE opportunities SET value = round(p_value, 2), updated_at = now()
  WHERE id = p_opportunity_id AND company_id = p_company_id;
END;
$$;

-- -----------------------------------------------------------------
-- GRANTS (cliente anon/authenticated)
-- -----------------------------------------------------------------
GRANT EXECUTE ON FUNCTION opp_raise(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION company_user_has_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION company_has_opportunity_items_entitlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_opportunity_items_entitlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION opp_require_company_currency(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_sync_totals(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_add_item(uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_update_item(uuid, uuid, numeric, numeric, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_remove_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_set_value_mode(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_set_global_discount(uuid, uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION opportunity_set_manual_value(uuid, uuid, numeric) TO authenticated;

-- -----------------------------------------------------------------
-- Habilitar/desabilitar composição por itens na empresa (gestores)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_company_opportunity_items_enabled(p_company_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.company_id = p_company_id
      AND cu.user_id = auth.uid()
      AND cu.is_active = true
      AND cu.role IN ('admin', 'manager', 'partner', 'super_admin', 'support')
  ) THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  SELECT plan INTO v_plan FROM companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    PERFORM opp_raise('OPP_OPPORTUNITY_ACCESS_DENIED', 'Oportunidade não encontrada ou sem permissão.');
  END IF;
  IF p_enabled AND v_plan NOT IN ('pro', 'enterprise') THEN
    PERFORM opp_raise('OPP_PLAN_FEATURE_DENIED', 'Seu plano atual não inclui este recurso.');
  END IF;
  UPDATE companies
  SET opportunity_items_enabled = p_enabled, updated_at = now()
  WHERE id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_company_opportunity_items_enabled(uuid, boolean) TO authenticated;
