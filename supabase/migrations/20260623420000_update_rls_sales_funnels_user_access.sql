-- =====================================================
-- MIGRATION: Atualizar RLS SELECT de sales_funnels
-- Data: 23/06/2026
--
-- Objetivo:
--   Substituir a policy de SELECT em sales_funnels para usar
--   auth_user_can_access_funnel, que incorpora as regras de
--   controle por usuário (user_funnel_settings + user_allowed_funnels).
--
-- Pré-requisito: M2 (auth_user_can_access_funnel) deve existir.
--
-- Policy atual (criada em 20260414140000):
--   "sf_select_member_or_parent_admin"
--   USING: auth_user_is_company_member(company_id)
--          OR EXISTS (...super_admin/system_admin da parent...)
--
-- Nova política:
--   USING: auth_user_can_access_funnel(company_id, id)
--          OR EXISTS (...super_admin/system_admin da parent — Trilha 2...)
--
--   auth_user_can_access_funnel já cobre:
--     - admin/super_admin/system_admin (Grupo 1)
--     - partner (Grupo 2)
--     - manager/seller com regras de user_funnel_settings (Grupos 3a/3b/3c)
--
--   A Trilha 2 (super_admin/system_admin da empresa PAI) é mantida como
--   condição separada por ser um caso distinto: o usuário tem membership
--   na parent, não na empresa child.
--
-- Impacto em comportamento ATUAL (antes das migrations de settings):
--   Como nenhum usuário terá is_enabled = true, auth_user_can_access_funnel
--   retorna true para todos os membros ativos (Grupo 3a: "sem registro").
--   O comportamento permanece IDÊNTICO ao atual.
--
-- Efeito em cascata:
--   funnel_stages, opportunity_funnel_positions e lead_stage_history
--   fazem JOIN em sales_funnels nas suas próprias policies de RLS.
--   Quando sales_funnels retorna 0 linhas para um funil bloqueado,
--   PostgREST filtra automaticamente os dados dessas tabelas dependentes.
--
-- Políticas de DML (INSERT, UPDATE, DELETE) em sales_funnels:
--   Não alteradas — continuam restritas a admin-level como antes.
-- =====================================================

SET search_path = public;

-- Substituir policy de SELECT
DROP POLICY IF EXISTS "sf_select_member_or_parent_admin" ON sales_funnels;

CREATE POLICY "sf_select_member_or_parent_admin"
ON sales_funnels FOR SELECT TO authenticated
USING (
  -- Trilha 1 + controle por usuário (admin, partner, manager, seller)
  auth_user_can_access_funnel(company_id, id)

  -- Trilha 2: super_admin/system_admin da empresa pai têm acesso irrestrito
  -- (distinto da Trilha 1 — esses usuários têm membership na PARENT, não na child)
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);
