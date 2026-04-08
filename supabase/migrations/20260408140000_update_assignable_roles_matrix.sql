-- =====================================================
-- MIGRATION: Substituir check de tier por matriz explícita em update_company_user_safe
-- Data: 08/04/2026
--
-- Contexto:
--   A regra anterior (v_target_tier >= v_caller_tier) bloqueava indevidamente
--   que um admin criasse outro admin (mesmo tier). A nova regra usa matriz
--   explícita callerRole → roles permitidos, alinhada com o frontend.
--
-- Matriz aprovada:
--   super_admin  → super_admin, system_admin, partner, admin, manager, seller
--   system_admin → partner, admin, manager, seller
--   partner      → admin, manager, seller
--   admin        → admin, manager, seller
--   manager      → (nenhum)
--   seller       → (nenhum)
--
-- Restrição de empresa permanece:
--   Roles SaaS (super_admin, system_admin, partner) proibidos em empresa client.
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
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id   uuid;
  v_company_type text;
  v_caller_role  text;
  v_target_role  text;
  v_can_edit     boolean;
  v_allowed_roles text[];

  VALID_ROLES     text[]  := ARRAY['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'];
  CLIENT_ROLES    text[]  := ARRAY['admin', 'manager', 'seller'];
  SAAS_ONLY_ROLES text[]  := ARRAY['super_admin', 'system_admin', 'partner'];
  CRITICAL_KEYS   text[]  := ARRAY['companies', 'impersonate'];

  k               text;
  v_new_perms     jsonb;
BEGIN
  -- ── Carregar empresa e tipo ─────────────────────────────────
  SELECT cu.company_id, c.company_type, cu.role
  INTO   v_company_id, v_company_type, v_target_role
  FROM   public.company_users cu
  JOIN   public.companies     c  ON c.id = cu.company_id
  WHERE  cu.id = p_record_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registro não encontrado');
  END IF;

  -- ── Verificar permissão edit_users ─────────────────────────
  SELECT public.caller_has_permission(v_company_id, 'edit_users')
  INTO   v_can_edit;

  IF NOT v_can_edit THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para editar usuários');
  END IF;

  -- ── Obter role do caller na empresa ────────────────────────
  SELECT cu.role
  INTO   v_caller_role
  FROM   public.company_users cu
  WHERE  cu.user_id    = auth.uid()
    AND  cu.company_id = v_company_id
    AND  cu.is_active  = true;

  -- Parceiro sem entrada direta: buscar via partner_company_assignments
  IF v_caller_role IS NULL THEN
    SELECT cu.role
    INTO   v_caller_role
    FROM   public.partner_company_assignments pca
    JOIN   public.company_users cu
           ON cu.user_id = auth.uid()
           AND cu.is_active = true
    WHERE  pca.partner_user_id = auth.uid()
      AND  pca.company_id      = v_company_id
      AND  pca.is_active       = true
    LIMIT 1;
  END IF;

  -- ── Validações de role (somente se p_role foi fornecido) ───
  IF p_role IS NOT NULL THEN
    -- 1. Role deve ser válido
    IF NOT (p_role = ANY(VALID_ROLES)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role inválido: %L', p_role)
      );
    END IF;

    -- 2. Roles SaaS apenas em empresa parent
    IF v_company_type = 'client' AND p_role = ANY(SAAS_ONLY_ROLES) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   format('Role %L não é permitido em empresa do tipo client', p_role)
      );
    END IF;

    -- 3. Validação por matriz explícita de roles atribuíveis
    --    Espelha exatamente ASSIGNABLE_ROLES_MATRIX do frontend (userApi.ts).
    IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
      v_allowed_roles := CASE v_caller_role
        WHEN 'system_admin' THEN ARRAY['partner', 'admin', 'manager', 'seller']
        WHEN 'partner'      THEN ARRAY['admin', 'manager', 'seller']
        WHEN 'admin'        THEN ARRAY['admin', 'manager', 'seller']
        ELSE ARRAY[]::text[]
      END;

      IF v_caller_role IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error',   'Caller não encontrado na empresa'
        );
      END IF;

      IF NOT (p_role = ANY(v_allowed_roles)) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error',   format(
            'Caller com role %L não pode atribuir role %L',
            v_caller_role, p_role
          )
        );
      END IF;
    END IF;
  END IF;

  -- ── Anti-escalada de permissões ────────────────────────────
  v_new_perms := p_permissions;

  -- Remover chaves críticas se caller não for super_admin.
  IF p_permissions IS NOT NULL AND v_caller_role IS DISTINCT FROM 'super_admin' THEN
    FOREACH k IN ARRAY CRITICAL_KEYS LOOP
      v_new_perms := v_new_perms - k;
    END LOOP;
  END IF;

  -- ── Aplicar atualização ────────────────────────────────────
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
