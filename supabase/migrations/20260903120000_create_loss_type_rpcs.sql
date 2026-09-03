-- =====================================================
-- Migration: RPCs de tipos de perda
--
-- opportunity_add_loss_type
-- opportunity_remove_loss_type
-- set_funnel_require_lost_loss_type
-- set_system_loss_type_hidden
--
-- Segurança: SECURITY DEFINER — espelha exatamente as
--            RPCs equivalentes de sale_types.
-- =====================================================

-- ─── opportunity_add_loss_type ───────────────────────
CREATE OR REPLACE FUNCTION opportunity_add_loss_type(
  p_company_id     UUID,
  p_opportunity_id UUID,
  p_loss_type_id   UUID
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

  -- Status deve ser open
  IF v_opp_status != 'open' THEN
    RAISE EXCEPTION 'OPP_OPPORTUNITY_NOT_EDITABLE'
      USING HINT = 'Só é possível adicionar tipos de perda a oportunidades em aberto.';
  END IF;

  -- Visibilidade: tipo deve ser visível
  --   Custom: is_system=false AND is_active=true
  --   Sistema: is_system=true AND is_active=true AND is_hidden=false
  IF NOT EXISTS (
    SELECT 1 FROM loss_types
    WHERE id         = p_loss_type_id
      AND company_id = p_company_id
      AND (
        (is_system = false AND is_active = true)
        OR
        (is_system = true  AND is_active = true AND is_hidden = false)
      )
  ) THEN
    RAISE EXCEPTION 'LOSS_TYPE_NOT_FOUND'
      USING HINT = 'Tipo de perda não encontrado, inativo ou oculto.';
  END IF;

  -- Inserção idempotente
  INSERT INTO opportunity_loss_types (company_id, opportunity_id, loss_type_id)
  VALUES (p_company_id, p_opportunity_id, p_loss_type_id)
  ON CONFLICT (opportunity_id, loss_type_id) DO UPDATE
    SET created_at = opportunity_loss_types.created_at
  RETURNING id INTO v_result_id;

  RETURN v_result_id;
END;
$$;

REVOKE ALL    ON FUNCTION opportunity_add_loss_type(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_add_loss_type(UUID, UUID, UUID) TO authenticated;


-- ─── opportunity_remove_loss_type ────────────────────
CREATE OR REPLACE FUNCTION opportunity_remove_loss_type(
  p_company_id                UUID,
  p_opportunity_loss_type_id  UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      USING HINT = 'Sem permissão para modificar este vínculo.';
  END IF;

  -- Remover (valida company_id)
  DELETE FROM opportunity_loss_types
  WHERE id         = p_opportunity_loss_type_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOSS_TYPE_LINK_NOT_FOUND'
      USING HINT = 'Vínculo não encontrado ou sem permissão.';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION opportunity_remove_loss_type(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_remove_loss_type(UUID, UUID) TO authenticated;


-- ─── set_funnel_require_lost_loss_type ───────────────
-- Ordem dos parâmetros espelha set_funnel_require_won_sale_type:
--   (p_funnel_id, p_company_id, p_value)
CREATE OR REPLACE FUNCTION set_funnel_require_lost_loss_type(
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
    RAISE EXCEPTION 'LOSS_TYPE_CONFIG_ACCESS_DENIED'
      USING HINT = 'Sem permissão para configurar este funil.';
  END IF;

  -- Funil pertence à empresa
  IF NOT EXISTS (
    SELECT 1 FROM sales_funnels
    WHERE id         = p_funnel_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'LOSS_TYPE_CONFIG_FUNNEL_NOT_FOUND'
      USING HINT = 'Funil não encontrado ou não pertence a esta empresa.';
  END IF;

  -- Ao habilitar: deve existir ao menos um tipo visível
  IF p_value = true THEN
    IF NOT EXISTS (
      SELECT 1 FROM loss_types
      WHERE company_id = p_company_id
        AND (
          (is_system = false AND is_active = true)
          OR
          (is_system = true  AND is_active = true AND is_hidden = false)
        )
    ) THEN
      RAISE EXCEPTION 'NO_ACTIVE_LOSS_TYPES'
        USING HINT = 'É necessário ao menos um tipo de perda visível para habilitar esta opção.';
    END IF;
  END IF;

  UPDATE sales_funnels
  SET require_lost_loss_type = p_value,
      updated_at             = now()
  WHERE id         = p_funnel_id
    AND company_id = p_company_id;
END;
$$;

REVOKE ALL    ON FUNCTION set_funnel_require_lost_loss_type(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_funnel_require_lost_loss_type(UUID, UUID, BOOLEAN) TO authenticated;


-- ─── set_system_loss_type_hidden ─────────────────────
CREATE OR REPLACE FUNCTION set_system_loss_type_hidden(
  p_company_id  UUID,
  p_loss_type_id UUID,
  p_is_hidden   BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_loss_type loss_types%ROWTYPE;
BEGIN
  -- 1. Usuário autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING HINT = 'Usuário não autenticado.';
  END IF;

  -- 2. Autorização: admin direto ou parent admin
  IF NOT (
    auth_user_is_company_admin(p_company_id)
    OR auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN'
      USING HINT = 'Apenas admins da empresa ou da empresa pai podem ocultar/exibir tipos de perda de sistema.';
  END IF;

  -- 3. Loss type pertence ao company_id
  SELECT * INTO v_loss_type
  FROM loss_types
  WHERE id = p_loss_type_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOSS_TYPE_NOT_FOUND'
      USING HINT = 'Tipo de perda não encontrado para esta empresa.';
  END IF;

  -- 4. Deve ser tipo de sistema
  IF v_loss_type.is_system IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'LOSS_TYPE_NOT_SYSTEM'
      USING HINT = 'Apenas tipos de perda de sistema podem ser ocultados ou exibidos.';
  END IF;

  -- 5. Atualizar apenas is_hidden.
  --    Sinaliza bypass ao trigger defensivo.
  PERFORM set_config('app.system_provision', 'true', TRUE);

  UPDATE loss_types
  SET
    is_hidden  = p_is_hidden,
    updated_at = NOW()
  WHERE id = p_loss_type_id
    AND company_id = p_company_id;

  PERFORM set_config('app.system_provision', 'false', TRUE);
END;
$$;

COMMENT ON FUNCTION set_system_loss_type_hidden(UUID, UUID, BOOLEAN) IS
  'Oculta ou exibe um tipo de perda de sistema para a empresa. '
  'Altera apenas is_hidden. Não modifica name, is_active, system_key ou outros campos. '
  'Autorizada apenas a admins da empresa ou empresa pai. '
  'Única via autorizada para alterar is_hidden em tipos de sistema.';

REVOKE ALL    ON FUNCTION set_system_loss_type_hidden(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_system_loss_type_hidden(UUID, UUID, BOOLEAN) TO authenticated;
