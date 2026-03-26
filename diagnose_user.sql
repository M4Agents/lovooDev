-- =====================================================
-- DIAGNÓSTICO: Email karla@m4digital.co
-- =====================================================

-- 1. Verificar se email existe em auth.users
SELECT 
  id,
  email,
  created_at,
  confirmed_at,
  email_confirmed_at,
  last_sign_in_at,
  deleted_at,
  raw_user_meta_data,
  raw_app_meta_data
FROM auth.users
WHERE email = 'karla@m4digital.co';

-- 2. Verificar se existe vínculo em company_users
SELECT 
  cu.id,
  cu.company_id,
  cu.user_id,
  cu.role,
  cu.is_active,
  cu.created_at,
  c.name as company_name,
  c.company_type
FROM company_users cu
LEFT JOIN companies c ON c.id = cu.company_id
WHERE cu.user_id IN (
  SELECT id FROM auth.users WHERE email = 'karla@m4digital.co'
);

-- 3. Query completa de diagnóstico
SELECT 
  au.id as user_id,
  au.email,
  au.created_at as user_created_at,
  au.confirmed_at,
  au.email_confirmed_at,
  au.last_sign_in_at,
  au.deleted_at,
  cu.id as company_user_id,
  cu.company_id,
  cu.role,
  cu.is_active,
  c.name as company_name,
  c.company_type
FROM auth.users au
LEFT JOIN company_users cu ON cu.user_id = au.id
LEFT JOIN companies c ON c.id = cu.company_id
WHERE au.email = 'karla@m4digital.co';

-- =====================================================
-- INTERPRETAÇÃO DOS RESULTADOS:
-- =====================================================
-- 
-- CENÁRIO 1: deleted_at IS NOT NULL
--   → Usuário foi deletado (soft delete)
--   → Solução: Deletar permanentemente no Supabase Dashboard
--
-- CENÁRIO 2: confirmed_at IS NULL
--   → Convite pendente não aceito
--   → Solução: Reenviar convite ou deletar e criar novo
--
-- CENÁRIO 3: company_user_id IS NULL
--   → Usuário existe mas não vinculado a empresa
--   → Solução: Criar vínculo em company_users
--
-- CENÁRIO 4: is_active = false
--   → Usuário existe mas está inativo
--   → Solução: Reativar (UPDATE is_active = true)
--
-- =====================================================
