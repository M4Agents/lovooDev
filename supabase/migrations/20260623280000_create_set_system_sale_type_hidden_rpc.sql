-- =====================================================
-- Migration: RPC set_system_sale_type_hidden
--
-- Permite que admins ocultem/exibam tipos de venda de
-- sistema. Única via autorizada para alterar is_hidden
-- em sale_types com is_system=true.
-- =====================================================

CREATE OR REPLACE FUNCTION set_system_sale_type_hidden(
  p_company_id  UUID,
  p_sale_type_id UUID,
  p_is_hidden   BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_sale_type sale_types%ROWTYPE;
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
      USING HINT = 'Apenas admins da empresa ou da empresa pai podem ocultar/exibir tipos de venda de sistema.';
  END IF;

  -- 3. Sale type pertence ao company_id
  SELECT * INTO v_sale_type
  FROM sale_types
  WHERE id = p_sale_type_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_TYPE_NOT_FOUND'
      USING HINT = 'Tipo de venda não encontrado para esta empresa.';
  END IF;

  -- 4. Deve ser tipo de sistema
  IF v_sale_type.is_system IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SALE_TYPE_NOT_SYSTEM'
      USING HINT = 'Apenas tipos de venda de sistema podem ser ocultados ou exibidos.';
  END IF;

  -- 5. Atualizar apenas is_hidden.
  --    Sinaliza bypass ao trigger defensivo (que bloquearia UPDATE em tipo de sistema
  --    quando app.system_provision != 'true').
  PERFORM set_config('app.system_provision', 'true', TRUE);

  UPDATE sale_types
  SET
    is_hidden  = p_is_hidden,
    updated_at = NOW()
  WHERE id = p_sale_type_id
    AND company_id = p_company_id;

  PERFORM set_config('app.system_provision', 'false', TRUE);
END;
$$;

COMMENT ON FUNCTION set_system_sale_type_hidden(UUID, UUID, BOOLEAN) IS
  'Oculta ou exibe um tipo de venda de sistema para a empresa. '
  'Altera apenas is_hidden. Não modifica name, is_active, system_key ou outros campos. '
  'Autorizada apenas a admins da empresa ou empresa pai. '
  'Única via autorizada para alterar is_hidden em tipos de sistema.';

-- Segurança: apenas autenticados
REVOKE ALL   ON FUNCTION set_system_sale_type_hidden(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_system_sale_type_hidden(UUID, UUID, BOOLEAN) TO authenticated;
