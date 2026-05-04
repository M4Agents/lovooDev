-- =====================================================
-- MIGRATION: Adicionar system_admin ao CHECK de role em company_users
-- =====================================================
-- Problema: a migration 20260422130000_add_system_admin_to_rpcs.sql adicionou
--           system_admin às RPCs mas esqueceu de atualizar a constraint da coluna.
--           Resultado: UPDATE com role='system_admin' falha com violação de check.
-- Solução:  Recriar company_users_role_check incluindo 'system_admin'.
--           Apenas expansão de valores permitidos — sem risco de dados existentes.
-- =====================================================

ALTER TABLE public.company_users
  DROP CONSTRAINT IF EXISTS company_users_role_check;

ALTER TABLE public.company_users
  ADD CONSTRAINT company_users_role_check
  CHECK (role IN (
    'super_admin',
    'system_admin',
    'admin',
    'partner',
    'manager',
    'seller'
  ));

COMMENT ON COLUMN public.company_users.role IS
  'Role do usuário: super_admin, system_admin, admin, partner, manager, seller';
