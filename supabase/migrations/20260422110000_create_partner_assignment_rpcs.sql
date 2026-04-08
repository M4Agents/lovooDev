-- =====================================================
-- MIGRATION: RPCs de atribuição de partner
-- Data: 22/04/2026
-- Fases: assign_company_to_partner
--        revoke_company_from_partner
--        get_partner_assigned_companies
--
-- Regras de autorização:
--   - Apenas super_admin e system_admin podem atribuir/revogar
--   - Partner não pode auto-atribuir
--   - Apenas empresas do tipo 'client' podem ser atribuídas
--   - Partner deve ser membro ativo de uma empresa parent
-- =====================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. assign_company_to_partner
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_company_to_partner(
  p_partner_user_id uuid,
  p_company_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_caller_role  text;
  v_partner_role text;
  v_company_type text;
BEGIN
  -- 1. Caller deve estar autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- 2. Caller deve ser super_admin ou system_admin
  SELECT cu.role INTO v_caller_role
    FROM company_users cu
    JOIN companies c ON c.id = cu.company_id AND c.company_type = 'parent'
   WHERE cu.user_id = v_caller_id
     AND cu.is_active = true
     AND cu.role IN ('super_admin', 'system_admin')
   LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: only super_admin or system_admin can assign companies');
  END IF;

  -- 3. Usuário target deve ser um partner ativo em empresa parent
  SELECT cu.role INTO v_partner_role
    FROM company_users cu
    JOIN companies c ON c.id = cu.company_id AND c.company_type = 'parent'
   WHERE cu.user_id = p_partner_user_id
     AND cu.is_active = true
     AND cu.role = 'partner'
   LIMIT 1;

  IF v_partner_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_user is not an active partner in a parent company');
  END IF;

  -- 4. Empresa alvo deve ser do tipo 'client'
  SELECT company_type INTO v_company_type
    FROM companies
   WHERE id = p_company_id;

  IF v_company_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'company not found');
  END IF;

  IF v_company_type <> 'client' THEN
    RETURN jsonb_build_object('success', false, 'error', 'only client companies can be assigned to partners');
  END IF;

  -- 5. Upsert: cria ou reativa
  INSERT INTO public.partner_company_assignments
    (partner_user_id, company_id, assigned_by, is_active)
  VALUES
    (p_partner_user_id, p_company_id, v_caller_id, true)
  ON CONFLICT (partner_user_id, company_id)
  DO UPDATE SET
    is_active   = true,
    assigned_by = v_caller_id,
    assigned_at = now();

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_company_to_partner(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. revoke_company_from_partner
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_company_from_partner(
  p_partner_user_id uuid,
  p_company_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_rows_affected int;
BEGIN
  -- 1. Caller autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- 2. Apenas super_admin ou system_admin
  SELECT cu.role INTO v_caller_role
    FROM company_users cu
    JOIN companies c ON c.id = cu.company_id AND c.company_type = 'parent'
   WHERE cu.user_id = v_caller_id
     AND cu.is_active = true
     AND cu.role IN ('super_admin', 'system_admin')
   LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: only super_admin or system_admin can revoke assignments');
  END IF;

  -- 3. Soft delete: is_active = false (preserva histórico)
  UPDATE public.partner_company_assignments
     SET is_active = false
   WHERE partner_user_id = p_partner_user_id
     AND company_id = p_company_id
     AND is_active = true;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'assignment not found or already revoked');
  END IF;

  RETURN jsonb_build_object('success', true, 'revoked_count', v_rows_affected);

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_company_from_partner(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_partner_assigned_companies
-- Retorna empresas atribuídas a um partner.
-- Permite dois modos:
--   - sem parâmetro: o próprio partner chama (auth.uid())
--   - com p_partner_user_id: super_admin/system_admin consulta outro partner
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_partner_assigned_companies(
  p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  company_id      uuid,
  company_name    text,
  company_type    text,
  assigned_at     timestamptz,
  assigned_by     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid := auth.uid();
  v_effective_id   uuid;
  v_caller_role    text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Se não foi passado um ID, retorna para o próprio caller
  v_effective_id := COALESCE(p_partner_user_id, v_caller_id);

  -- Se o caller está consultando outro usuário, exige super_admin/system_admin
  IF v_effective_id <> v_caller_id THEN
    SELECT cu.role INTO v_caller_role
      FROM company_users cu
      JOIN companies c ON c.id = cu.company_id AND c.company_type = 'parent'
     WHERE cu.user_id = v_caller_id
       AND cu.is_active = true
       AND cu.role IN ('super_admin', 'system_admin')
     LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'forbidden: only super_admin or system_admin can query other partners assignments';
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      pca.company_id,
      c.name      AS company_name,
      c.company_type,
      pca.assigned_at,
      pca.assigned_by
    FROM public.partner_company_assignments pca
    JOIN public.companies c ON c.id = pca.company_id
   WHERE pca.partner_user_id = v_effective_id
     AND pca.is_active = true
   ORDER BY c.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_partner_assigned_companies(uuid) TO authenticated;
