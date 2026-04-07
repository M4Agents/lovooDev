-- =====================================================
-- MIGRATION: BACKFILL COMPANY USERS PERMISSIONS
-- Data: 21/04/2026
-- Objetivo: Preencher company_users.permissions para
--           registros com permissions = '{}' (vazio).
--           Preserva registros com permissions customizadas.
--           Usa os mesmos valores de getDefaultPermissions()
--           em src/services/userApi.ts (linhas 188-303).
-- Afetados: 3 registros (admin em empresas client)
-- =====================================================

UPDATE public.company_users
SET
  permissions = CASE role
    WHEN 'super_admin' THEN '{
      "dashboard":true,"leads":true,"chat":true,"analytics":true,
      "settings":true,"companies":true,"users":true,"financial":true,
      "create_users":true,"edit_users":true,"delete_users":true,
      "impersonate":true,"view_all_leads":true,"edit_all_leads":true,
      "view_financial":true,"edit_financial":true
    }'::jsonb
    WHEN 'admin' THEN '{
      "dashboard":true,"leads":true,"chat":true,"analytics":true,
      "settings":true,"companies":false,"users":true,"financial":false,
      "create_users":true,"edit_users":true,"delete_users":true,
      "impersonate":false,"view_all_leads":true,"edit_all_leads":true,
      "view_financial":false,"edit_financial":false
    }'::jsonb
    WHEN 'partner' THEN '{
      "dashboard":true,"leads":true,"chat":true,"analytics":true,
      "settings":true,"companies":true,"users":true,"financial":false,
      "create_users":true,"edit_users":true,"delete_users":false,
      "impersonate":true,"view_all_leads":true,"edit_all_leads":true,
      "view_financial":false,"edit_financial":false
    }'::jsonb
    WHEN 'manager' THEN '{
      "dashboard":true,"leads":true,"chat":true,"analytics":true,
      "settings":false,"companies":false,"users":false,"financial":false,
      "create_users":false,"edit_users":false,"delete_users":false,
      "impersonate":false,"view_all_leads":true,"edit_all_leads":false,
      "view_financial":false,"edit_financial":false
    }'::jsonb
    WHEN 'seller' THEN '{
      "dashboard":true,"leads":true,"chat":true,"analytics":false,
      "settings":false,"companies":false,"users":false,"financial":false,
      "create_users":false,"edit_users":false,"delete_users":false,
      "impersonate":false,"view_all_leads":false,"edit_all_leads":false,
      "view_financial":false,"edit_financial":false
    }'::jsonb
    ELSE '{
      "dashboard":false,"leads":false,"chat":false,"analytics":false,
      "settings":false,"companies":false,"users":false,"financial":false,
      "create_users":false,"edit_users":false,"delete_users":false,
      "impersonate":false,"view_all_leads":false,"edit_all_leads":false,
      "view_financial":false,"edit_financial":false
    }'::jsonb
  END,
  updated_at = now()
WHERE
  is_active = true
  AND (
    permissions = '{}'::jsonb
    OR permissions IS NULL
    OR NOT (permissions ? 'create_users')
  );
