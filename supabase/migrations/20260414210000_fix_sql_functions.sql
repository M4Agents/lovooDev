-- ============================================================
-- BLOCO 2: Saneamento de funções SQL de autorização multi-tenant
-- Escopo: apenas funções auxiliares (sem alterar policies)
-- Idempotente: CREATE OR REPLACE em todas as funções
-- is_super_admin() mantida sem alteração (backward compat)
-- ============================================================

-- ============================================================
-- SEÇÃO 1: auth_user_is_company_admin(uuid)
-- Alteração: adicionar 'system_admin' à lista de roles admin-level
-- Impacto imediato: company_users SELECT e UPDATE (usa essa função)
-- Resultado: system_admin passa a gerenciar membros da própria empresa
-- ============================================================

CREATE OR REPLACE FUNCTION public.auth_user_is_company_admin(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = p_company_id
      AND role       IN ('admin', 'super_admin', 'system_admin')
      AND is_active  = true
  );
$$;

COMMENT ON FUNCTION public.auth_user_is_company_admin(uuid) IS
'Trilha 1: retorna TRUE se o usuário for admin-level (admin, super_admin, system_admin)
ativo na empresa especificada. Sem escalada parent. Não inclui partner.';

-- ============================================================
-- SEÇÃO 2: auth_user_is_platform_admin() — NOVA
-- Retorna TRUE se o usuário for super_admin OU system_admin ativo
-- em qualquer empresa do tipo ''parent''.
-- Uso futuro (Bloco 3): substituir is_super_admin() nas policies de companies.
-- Impacto agora: zero (nenhuma policy usa esta função ainda).
-- ============================================================

CREATE OR REPLACE FUNCTION public.auth_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
    WHERE cu.user_id     = auth.uid()
      AND cu.role        IN ('super_admin', 'system_admin')
      AND cu.is_active   = true
      AND c.company_type = 'parent'
  );
$$;

COMMENT ON FUNCTION public.auth_user_is_platform_admin() IS
'Retorna TRUE se o usuário for super_admin ou system_admin ativo em empresa do tipo parent.
Substitui is_super_admin() nas policies que precisam cobrir ambos os roles (Bloco 3).
Não inclui admin, manager, seller nem partner.';

-- ============================================================
-- SEÇÃO 3: auth_user_is_parent_admin(p_company_id uuid) — NOVA
-- Trilha 2: retorna TRUE se o usuário for super_admin ou system_admin
-- ativo na empresa parent da empresa alvo.
-- Retorna FALSE se:
--   - empresa alvo não tem parent_company_id (é ela própria a parent)
--   - usuário é admin/manager/seller (sem escalada automática)
--   - usuário está inativo
--   - p_company_id não existe no banco
-- Impacto agora: zero (nenhuma policy usa esta função ainda).
-- ============================================================

CREATE OR REPLACE FUNCTION public.auth_user_is_parent_admin(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies child
    JOIN public.company_users cu ON cu.company_id = child.parent_company_id
    WHERE child.id              = p_company_id
      AND child.parent_company_id IS NOT NULL
      AND cu.user_id            = auth.uid()
      AND cu.role               IN ('super_admin', 'system_admin')
      AND cu.is_active          = true
  );
$$;

COMMENT ON FUNCTION public.auth_user_is_parent_admin(uuid) IS
'Trilha 2: retorna TRUE se o usuário for super_admin ou system_admin ativo na empresa
parent da empresa alvo (p_company_id). Retorna FALSE se a empresa alvo não tem
parent_company_id (é ela própria a parent). Não inclui admin, partner nem roles menores.';
