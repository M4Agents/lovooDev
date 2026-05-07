-- =============================================================================
-- Migration: company_soft_delete_and_admin_rpc
-- Data: 2026-05-24
--
-- O que esta migration faz:
--   1. Adiciona colunas deleted_at / deleted_by em companies (soft delete)
--   2. Cria create_client_company_with_admin_safe — RPC transacional que:
--      - Cria empresa client + trial + vínculo super_admin (igual à existente)
--      - Adicionalmente vincula admin externo via p_admin_user_id (opcional)
--      - Rejeita partner explicitamente (apenas super_admin e system_admin)
--
-- O que esta migration NÃO faz:
--   ✗ NÃO altera RLS
--   ✗ NÃO altera create_client_company_safe (compatibilidade)
--   ✗ NÃO aplica soft delete em empresas existentes
--   ✗ NÃO altera frontend
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. COLUNAS DE SOFT DELETE EM companies
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid        DEFAULT NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.companies.deleted_at IS
  'Soft delete: preenchido quando a empresa foi removida. '
  'Empresas com deleted_at IS NOT NULL devem ser ignoradas nas listagens.';

COMMENT ON COLUMN public.companies.deleted_by IS
  'UUID do usuário que executou o soft delete. Auditoria.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: create_client_company_with_admin_safe
--
-- Extensão de create_client_company_safe que aceita p_admin_user_id opcional.
-- Se p_admin_user_id IS NOT NULL:
--   - Vincula o usuário em company_users com role='admin' na empresa criada
--   - Tudo ocorre na mesma transação (atômico)
--
-- Diferença em relação a create_client_company_safe:
--   - Partner NÃO é permitido (rejeita com erro explícito)
--   - Aceita p_admin_user_id para vínculo transacional do admin
--
-- O backend cria o auth.user ANTES de chamar esta RPC.
-- Se a RPC falhar, o backend é responsável por deletar o auth.user criado.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_client_company_with_admin_safe(
  p_parent_company_id uuid,
  p_name              text,
  p_domain            text    DEFAULT NULL,
  p_admin_user_id     uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_caller_role      text;
  v_parent_super_id  uuid;
  v_parent_type      text;
  v_new_company_id   uuid;
  v_growth_plan_id   uuid;
  v_trial_start      timestamptz := now();
  v_trial_end        timestamptz := now() + interval '14 days';
  v_super_perms      jsonb := jsonb_build_object(
    'chat',             true,
    'leads',            true,
    'users',            true,
    'settings',         true,
    'analytics',        true,
    'dashboard',        true,
    'financial',        true,
    'companies',        true,
    'edit_users',       true,
    'create_users',     true,
    'delete_users',     true,
    'impersonate',      true,
    'edit_all_leads',   true,
    'edit_financial',   true,
    'view_all_leads',   true,
    'view_financial',   true
  );
  v_admin_perms      jsonb := jsonb_build_object(
    'chat',             true,
    'leads',            true,
    'users',            true,
    'settings',         true,
    'analytics',        true,
    'dashboard',        true,
    'financial',        false,
    'companies',        false,
    'edit_users',       true,
    'create_users',     true,
    'delete_users',     true,
    'impersonate',      false,
    'edit_all_leads',   true,
    'edit_financial',   false,
    'view_all_leads',   true,
    'view_financial',   false
  );
BEGIN
  -- 1. Caller deve estar autenticado
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- 2. Empresa parent deve existir e ser do tipo 'parent'
  SELECT company_type INTO v_parent_type
    FROM public.companies
   WHERE id = p_parent_company_id;

  IF v_parent_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'parent company not found');
  END IF;

  IF v_parent_type <> 'parent' THEN
    RETURN jsonb_build_object('success', false, 'error', 'target is not a parent company');
  END IF;

  -- 3. Validar role do caller na parent company
  --    Partner NÃO é permitido nesta RPC — use create_client_company_safe para partner
  SELECT cu.role INTO v_caller_role
    FROM public.company_users cu
   WHERE cu.user_id    = v_caller_id
     AND cu.company_id = p_parent_company_id
     AND cu.is_active  = true
   LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'system_admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden: apenas super_admin ou system_admin podem criar empresas client via este endpoint'
    );
  END IF;

  -- 4. Identificar o super_admin da parent (associado à nova empresa)
  SELECT cu.user_id INTO v_parent_super_id
    FROM public.company_users cu
   WHERE cu.company_id = p_parent_company_id
     AND cu.role       = 'super_admin'
     AND cu.is_active  = true
   ORDER BY cu.created_at
   LIMIT 1;

  IF v_parent_super_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no active super_admin found in parent company');
  END IF;

  -- 5. Resolver plano Growth para o trial
  SELECT id INTO v_growth_plan_id
    FROM public.plans
   WHERE slug      = 'growth'
     AND is_active = true
   LIMIT 1;

  IF v_growth_plan_id IS NULL THEN
    RAISE WARNING 'create_client_company_with_admin_safe: plano Growth não encontrado. '
                  'Empresa criada sem trial e sem plan_id.';
  END IF;

  -- 6. Criar a empresa client
  INSERT INTO public.companies (
    name,
    domain,
    plan_id,
    parent_company_id,
    company_type,
    user_id,
    status
  )
  VALUES (
    p_name,
    p_domain,
    v_growth_plan_id,
    p_parent_company_id,
    'client',
    NULL,
    'active'
  )
  RETURNING id INTO v_new_company_id;

  -- 7. Associar super_admin da parent à nova empresa
  INSERT INTO public.company_users (
    company_id, user_id, role, permissions, is_active, created_by, created_at, updated_at
  )
  VALUES (
    v_new_company_id, v_parent_super_id, 'super_admin', v_super_perms,
    true, v_caller_id, now(), now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role        = 'super_admin',
    permissions = v_super_perms,
    is_active   = true,
    updated_at  = now();

  -- 8. Vincular admin externo (se fornecido)
  --    Inserção transacional — se falhar, o INSERT da empresa também é desfeito
  IF p_admin_user_id IS NOT NULL THEN
    INSERT INTO public.company_users (
      company_id, user_id, role, permissions, is_active, created_by, created_at, updated_at
    )
    VALUES (
      v_new_company_id, p_admin_user_id, 'admin', v_admin_perms,
      true, v_caller_id, now(), now()
    )
    ON CONFLICT (company_id, user_id) DO UPDATE SET
      role        = 'admin',
      permissions = v_admin_perms,
      is_active   = true,
      updated_at  = now();
  END IF;

  -- 9. Criar trial de 14 dias (apenas se Growth plan foi encontrado)
  IF v_growth_plan_id IS NOT NULL THEN
    INSERT INTO public.company_subscriptions (
      company_id,
      plan_id,
      status,
      trial_start,
      trial_end,
      trial_extended,
      stripe_subscription_id,
      stripe_price_id,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      billing_cycle
    )
    VALUES (
      v_new_company_id,
      v_growth_plan_id,
      'trialing',
      v_trial_start,
      v_trial_end,
      false,
      NULL,
      NULL,
      NULL,
      NULL,
      false,
      'monthly'
    )
    ON CONFLICT (company_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success',       true,
    'company_id',    v_new_company_id,
    'trial_started', v_growth_plan_id IS NOT NULL,
    'trial_end',     CASE WHEN v_growth_plan_id IS NOT NULL
                       THEN v_trial_end::text
                       ELSE NULL
                     END,
    'admin_linked',  p_admin_user_id IS NOT NULL
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client_company_with_admin_safe(uuid, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.create_client_company_with_admin_safe IS
  'Cria empresa client + trial + super_admin da parent + admin externo opcional. '
  'Tudo em uma única transação atômica. '
  'Apenas super_admin e system_admin podem chamar (partner bloqueado). '
  'p_admin_user_id: auth.user criado pelo backend ANTES de chamar esta RPC. '
  'Se a RPC falhar, o backend é responsável por deletar o auth.user órfão.';


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO FINAL
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE LOG '=== company_soft_delete_and_admin_rpc aplicada com sucesso ===';
  RAISE LOG '  companies.deleted_at: coluna adicionada (soft delete)';
  RAISE LOG '  companies.deleted_by: coluna adicionada (auditoria)';
  RAISE LOG '  create_client_company_with_admin_safe: criada (empresa+trial+admin transacional)';
  RAISE LOG '  create_client_company_safe: NÃO alterada (compatibilidade mantida)';
  RAISE LOG '  RLS: NÃO alterada';
END;
$$;
