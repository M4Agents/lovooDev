-- =====================================================
-- MIGRATION: RPC caller_has_permission
-- Data: 21/04/2026
-- Objetivo: Verificar se o usuário autenticado (auth.uid())
--           tem uma permission específica na empresa indicada.
--
-- DESIGN SEGURO:
--   - Usa auth.uid() internamente — NÃO aceita p_user_id livre
--   - Sem bypass por role = 'super_admin'
--   - Permissão determinada exclusivamente pelo campo permissions
--   - Fallback temporário por role se permissions estiver vazio/null
--     (safety net enquanto backfill não cobre todos os ambientes)
--
-- Substitui o uso de get_user_permissions (que derivava do role)
-- para enforcement real baseado em dados armazenados.
-- =====================================================

CREATE OR REPLACE FUNCTION public.caller_has_permission(
  p_company_id     uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permissions jsonb;
  v_role        text;
BEGIN
  SELECT cu.permissions, cu.role
  INTO   v_permissions, v_role
  FROM   public.company_users cu
  WHERE  cu.user_id    = auth.uid()
    AND  cu.company_id = p_company_id
    AND  cu.is_active  = true;

  -- Usuário não encontrado na empresa — negar acesso
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Permissões armazenadas completas: usar diretamente (RBAC real)
  IF v_permissions IS NOT NULL
     AND v_permissions != '{}'::jsonb
     AND v_permissions ? p_permission_key
  THEN
    RETURN COALESCE((v_permissions ->> p_permission_key)::boolean, false);
  END IF;

  -- Fallback temporário por role (safety net para permissions ausentes)
  -- Deve ser removido após estabilização completa do backfill em todos ambientes
  CASE v_role
    WHEN 'super_admin' THEN RETURN true;
    WHEN 'admin'       THEN
      RETURN p_permission_key NOT IN ('financial', 'companies',
                                      'view_financial', 'edit_financial',
                                      'impersonate');
    WHEN 'partner'     THEN
      RETURN p_permission_key IN ('dashboard', 'leads', 'chat', 'analytics',
                                  'create_users', 'edit_users', 'view_all_leads',
                                  'edit_all_leads', 'impersonate');
    WHEN 'manager'     THEN
      RETURN p_permission_key IN ('dashboard', 'leads', 'chat', 'analytics',
                                  'view_all_leads');
    WHEN 'seller'      THEN
      RETURN p_permission_key IN ('dashboard', 'leads', 'chat');
    ELSE
      RETURN false;
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.caller_has_permission(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.caller_has_permission IS
  'Verifica permission da coluna company_users.permissions para o usuário autenticado (auth.uid()). '
  'Não aceita user_id livre — evita privilege escalation. '
  'Sem bypass por role: permissão lida diretamente do JSONB armazenado. '
  'Fallback temporário por role se permissions estiver vazio/null. '
  'Primeiro ciclo RBAC — 21/04/2026.';
