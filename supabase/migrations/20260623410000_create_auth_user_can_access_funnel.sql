-- =====================================================
-- MIGRATION: Helper auth_user_can_access_funnel
-- Data: 23/06/2026
-- Rev:  23/06/2026 — C1: adicionado Grupo 1.5 (Trilha 2 centralizada)
--
-- Objetivo:
--   Helper centralizado que determina se o usuário autenticado
--   tem acesso a um funil específico de uma empresa.
--   Toda validação de acesso a funis deve usar esta função.
--
-- Pré-requisitos:
--   M0: auth_user_is_partner_for_company
--   M1: user_funnel_settings, user_allowed_funnels
--
-- Regras definitivas por role:
--
--   admin / super_admin / system_admin (membership direta — Trilha 1):
--     Acesso total. Nunca restringido por user_funnel_settings.
--     Exige company_users.company_id = p_company_id, is_active = true.
--
--   super_admin / system_admin (empresa PAI → FILHA — Trilha 2):
--     Acesso total via parent_company_id.
--     Ex: super_admin da parent acessa empresa client.
--     Centralizado aqui para que M6a/M6b/M6c herdem automaticamente.
--
--   partner:
--     Acesso total nas empresas atribuídas via partner_company_assignments.
--     NÃO tem company_users na empresa client (apenas na parent).
--     Validado por auth_user_is_partner_for_company(p_company_id).
--
--   manager / seller:
--     Grupo 3a: sem registro em user_funnel_settings OU is_enabled = false → acesso total
--     Grupo 3b: is_enabled = true + zero linhas em user_allowed_funnels → acesso total
--     Grupo 3c: is_enabled = true + funil na lista → acesso permitido
--     Grupo 3d: is_enabled = true + funil NOT na lista → acesso negado
--
-- Impacto:
--   ZERO impacto enquanto user_funnel_settings estiver vazia.
--   Todos os usuários caem em Grupo 3a (sem registro) → acesso total.
--
-- Segurança:
--   SECURITY DEFINER: acessa user_funnel_settings e user_allowed_funnels
--   SET search_path = public: previne search_path injection
--   STABLE: seguro para uso em RLS policies (sem side effects)
-- =====================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION auth_user_can_access_funnel(
  p_company_id UUID,
  p_funnel_id  UUID
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (

    -- ── Grupo 1: admin / super_admin / system_admin (Trilha 1 — membership direta) ──
    -- Membership direta na empresa alvo com role elevado.
    -- Nunca restringidos por user_funnel_settings.
    EXISTS (
      SELECT 1
      FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = p_company_id
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )

    -- ── Grupo 1.5: super_admin / system_admin via Trilha 2 (empresa PAI → FILHA) ──
    -- Cenário: usuário tem role elevado na empresa PAI e acessa empresa FILHA (client).
    -- Sem este grupo, RPCs protegidas por auth_user_can_access_funnel bloqueavam
    -- super_admin/system_admin da parent que não possuem membership direta na client.
    -- Centralizado aqui para herança automática por M6a / M6b / M6c.
    OR EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN companies child ON child.id = p_company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role       IN ('super_admin', 'system_admin')
        AND cu.company_id = child.parent_company_id
    )

    -- ── Grupo 2: partner ─────────────────────────────────────────────────
    -- Partner NÃO tem company_users na empresa client (apenas na parent).
    -- Validado via auth_user_is_partner_for_company (pré-req M0).
    -- Acesso total nas empresas atribuídas — não filtrado por user_funnel_settings.
    OR auth_user_is_partner_for_company(p_company_id)

    -- ── Grupo 3a: manager/seller sem controle ativado → acesso total ─────
    -- "Sem registro" ou "is_enabled = false" → comportamento atual preservado.
    OR (
      EXISTS (
        SELECT 1
        FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = p_company_id
          AND cu.is_active  = true
          AND cu.role IN ('manager', 'seller')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM user_funnel_settings ufs
        WHERE ufs.user_id    = auth.uid()
          AND ufs.company_id = p_company_id
          AND ufs.is_enabled = true
      )
    )

    -- ── Grupo 3b: manager/seller, is_enabled = true mas sem lista ────────
    -- is_enabled = true + zero linhas em user_allowed_funnels → acesso total.
    -- "Array vazio" semântica: controle ativo sem restrição específica.
    OR (
      EXISTS (
        SELECT 1
        FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = p_company_id
          AND cu.is_active  = true
          AND cu.role IN ('manager', 'seller')
      )
      AND EXISTS (
        SELECT 1
        FROM user_funnel_settings ufs
        WHERE ufs.user_id    = auth.uid()
          AND ufs.company_id = p_company_id
          AND ufs.is_enabled = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM user_allowed_funnels uaf
        WHERE uaf.user_id    = auth.uid()
          AND uaf.company_id = p_company_id
      )
    )

    -- ── Grupo 3c: manager/seller, is_enabled = true, funil na lista ──────
    -- Acesso somente ao funil explicitamente permitido.
    OR EXISTS (
      SELECT 1
      FROM company_users       cu
      JOIN user_allowed_funnels uaf
        ON uaf.user_id    = cu.user_id
       AND uaf.company_id = cu.company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = p_company_id
        AND cu.is_active  = true
        AND cu.role IN ('manager', 'seller')
        AND uaf.funnel_id = p_funnel_id
    )

  );
$$;

COMMENT ON FUNCTION auth_user_can_access_funnel(UUID, UUID) IS
  'Helper centralizado de acesso a funis. '
  'admin/super_admin/system_admin (Trilha 1): acesso total com membership direta. '
  'super_admin/system_admin (Trilha 2): acesso total via parent_company_id → empresa filha. '
  'partner: acesso total nas empresas atribuídas (via auth_user_is_partner_for_company). '
  'manager/seller: segue user_funnel_settings — sem registro ou is_enabled=false = acesso total; '
  'is_enabled=true sem lista = acesso total; is_enabled=true com lista = apenas funis listados.';
