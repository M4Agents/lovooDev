-- =====================================================
-- MIGRATION: Helper auth_user_is_partner_for_company
-- Data: 23/06/2026
--
-- Objetivo:
--   Centralizar em um único helper SQL a validação de que o
--   usuário autenticado é um partner com atribuição ativa
--   para uma empresa específica.
--
-- Motivação:
--   Não existe função dedicada para esse fim no projeto.
--   A validação está dispersa em RPCs SECURITY DEFINER
--   (caller_has_permission) e no backend Node.js.
--   Os helpers RLS saneados (auth_user_is_company_member,
--   auth_user_is_company_admin) excluem explicitamente partner.
--
-- Cadeia de validação:
--   A) company_users.role = 'partner' AND is_active = true
--   B) company_users.company_id aponta para empresa com company_type = 'parent'
--   C) partner_company_assignments.company_id = p_company_id AND is_active = true
--   D) A empresa alvo (p_company_id) tem parent_company_id apontando para
--      a mesma parent do partner — evita acesso cross-parent
--
-- Proteção cross-parent:
--   Garante que partner da Parent A jamais acesse empresas
--   vinculadas à Parent B, mesmo que exista linha incorreta
--   em partner_company_assignments.
--
-- Segurança:
--   SECURITY DEFINER: necessário para acessar partner_company_assignments
--   SET search_path = public: previne search_path injection
--   Não usa JWT claim para autorização — baseia-se somente em tabelas
--
-- Impacto:
--   ZERO impacto em comportamento existente — função nova, não utilizada ainda.
--   Será referenciada por auth_user_can_access_funnel (M2).
-- =====================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION auth_user_is_partner_for_company(
  p_company_id UUID
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_users       cu
    JOIN companies           parent_co  ON parent_co.id  = cu.company_id
    JOIN partner_company_assignments pca
                                        ON pca.partner_user_id = cu.user_id
    JOIN companies           target_co  ON target_co.id  = pca.company_id
    WHERE cu.user_id              = auth.uid()
      AND cu.is_active            = true
      AND cu.role                 = 'partner'
      -- (B) partner pertence a uma empresa parent
      AND parent_co.company_type  = 'parent'
      -- (C) atribuição ativa para a empresa alvo
      AND pca.company_id          = p_company_id
      AND pca.is_active           = true
      -- (D) empresa alvo pertence à mesma parent do partner
      AND target_co.parent_company_id = cu.company_id
  );
$$;

COMMENT ON FUNCTION auth_user_is_partner_for_company(UUID) IS
  'Retorna true se auth.uid() é partner com atribuição ativa em p_company_id, '
  'validando toda a cadeia: company_users → parent_co → partner_company_assignments → target_co. '
  'Impede acesso cross-parent (partner de Parent A acessar empresa de Parent B).';
