-- =====================================================================
-- ROLLBACK: M0 + M2 — Remover helpers de acesso a funis
--
-- O que é revertido:
--   M0: auth_user_is_partner_for_company(UUID)
--   M2: auth_user_can_access_funnel(UUID, UUID)
--
-- Executar APÓS os rollbacks de M6 (11, 10, 09) que dependem destes helpers.
-- Ordem correta do rollback completo: 11 → 10 → 09 → 08 → 07 → 06 → 05
--
-- ⚠️  ATENÇÃO: Executar este arquivo SOMENTE após os rollbacks M6a, M6b, M6c.
--     Remover os helpers antes das funções que os referenciam causará erros.
-- =====================================================================

-- Remover helper principal (M2)
-- Usado em: RLS de sales_funnels (M3), guards de Kanban (M6a), Reports (M6b), Dashboard (M6c)
DROP FUNCTION IF EXISTS auth_user_can_access_funnel(UUID, UUID);

-- Remover helper de partner (M0)
-- Usado por: auth_user_can_access_funnel (M2) para validar acesso de partner a empresas atribuídas
DROP FUNCTION IF EXISTS auth_user_is_partner_for_company(UUID);
