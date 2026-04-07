-- =====================================================
-- MIGRATION: create_update_company_user_safe
-- Data: 21/04/2026
-- Objetivo: RPC transacional e segura para atualizar company_users.
--   Inclui:
--     - Verificação de permissão edit_users (via caller_has_permission)
--     - Validação de p_role contra roles permitidos por company_type
--     - Bloqueio de promoção indevida para super_admin
--     - Sanitização de p_permissions (strip de chaves críticas para não super_admin)
--   Substitui: UPDATE direto em company_users vindo do frontend.
-- Bloco A / Fase 2 — Ciclo RBAC 2.
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_company_user_safe(
  p_record_id  uuid,
  p_role       text    DEFAULT NULL,
  p_permissions jsonb  DEFAULT NULL,
  p_is_active  boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id   uuid;
  v_company_type text;
  v_caller_role  text;
  v_can_edit     boolean;

  -- Roles permitidos no sistema
  VALID_ROLES    text[] := ARRAY['super_admin', 'admin', 'partner', 'manager', 'seller'];
  -- Roles permitidos em empresas do tipo client
  CLIENT_ROLES   text[] := ARRAY['admin', 'manager', 'seller'];
  -- Permissões críticas: somente super_admin pode conceder
  CRITICAL_KEYS  text[] := ARRAY['companies', 'impersonate'];

  k              text;
  v_new_perms    jsonb;
BEGIN
  -- ─── 1. Localizar o registro alvo e obter company_id + company_type ───────
  SELECT cu.company_id, c.company_type
  INTO   v_company_id, v_company_type
  FROM   public.company_users cu
  JOIN   public.companies     c  ON c.id = cu.company_id
  WHERE  cu.id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registro não encontrado');
  END IF;

  -- ─── 2. Verificar permissão edit_users do caller ──────────────────────────
  SELECT public.caller_has_permission(v_company_id, 'edit_users')
  INTO   v_can_edit;

  IF NOT v_can_edit THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para editar usuários');
  END IF;

  -- ─── 3. Obter role do caller (para validações de escalação) ──────────────
  SELECT cu.role
  INTO   v_caller_role
  FROM   public.company_users cu
  WHERE  cu.user_id    = auth.uid()
    AND  cu.company_id = v_company_id
    AND  cu.is_active  = true;

  -- ─── 4. Validar p_role ────────────────────────────────────────────────────
  IF p_role IS NOT NULL THEN
    -- 4a. Role deve ser reconhecido
    IF NOT (p_role = ANY(VALID_ROLES)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role inválido: %L', p_role)
      );
    END IF;

    -- 4b. Empresas client não podem ter super_admin ou partner
    IF v_company_type = 'client' AND p_role IN ('super_admin', 'partner') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role %L não é permitido em empresa do tipo client', p_role)
      );
    END IF;

    -- 4c. Somente super_admin pode promover alguém para super_admin
    IF p_role = 'super_admin' AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Promoção para super_admin requer ser super_admin'
      );
    END IF;
  END IF;

  -- ─── 5. Sanitizar p_permissions para callers não super_admin ─────────────
  v_new_perms := p_permissions;

  IF p_permissions IS NOT NULL AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
    -- Remover chaves críticas que só super_admin pode conceder
    FOREACH k IN ARRAY CRITICAL_KEYS LOOP
      v_new_perms := v_new_perms - k;
    END LOOP;
  END IF;

  -- ─── 6. UPDATE atômico ────────────────────────────────────────────────────
  UPDATE public.company_users
  SET
    role        = COALESCE(p_role,       role),
    permissions = COALESCE(v_new_perms,  permissions),
    is_active   = COALESCE(p_is_active,  is_active),
    updated_at  = now()
  WHERE id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Atualização não aplicada');
  END IF;

  RETURN jsonb_build_object('success', true, 'record_id', p_record_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.update_company_user_safe IS
  'Atualiza company_users de forma segura e transacional. '
  'Requer permissão edit_users (via company_users.permissions). '
  'Bloqueia promoção indevida para super_admin. '
  'Strip de chaves críticas (companies, impersonate) para callers não super_admin. '
  'Ciclo RBAC 2 / Bloco A / Fase 2 — 21/04/2026.';
