-- =====================================================
-- MIGRATION: Restrição de acesso a leads por responsável
-- Data: 28/05/2026
--
-- Objetivo: Permitir que empresas ativem uma restrição opt-in
--           onde usuários sem view_all_leads só visualizam os
--           leads atribuídos a eles (responsible_user_id = auth.uid()).
--
-- Escopo do enforcement:
--   - Queries diretas via Supabase auth client → protegidas por RLS
--   - exportLeads → protegido automaticamente (auth client)
--   - get_lead_dashboard_stats → protegido (não é SECURITY DEFINER)
--   - Fora do escopo (Fase 2): RPCs SECURITY DEFINER do funil,
--     endpoints backend com service_role (dashboard/leads.ts, etc.)
--
-- Backward compatible: DEFAULT FALSE → nenhuma empresa impactada
--                      antes de ativar o toggle manualmente.
--
-- Não altera leads_support_partner_access (policy de partner/support).
-- =====================================================


-- =====================================================
-- PARTE 1: Coluna na tabela companies
-- =====================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS restrict_leads_to_owner BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN companies.restrict_leads_to_owner IS
  'Quando true, usuários sem view_all_leads em company_users.permissions '
  'só visualizam leads onde responsible_user_id = auth.uid(). '
  'Enforcement via RLS (auth_user_restricted_to_own_leads). '
  'DEFAULT FALSE = sem impacto em empresas existentes.';


-- =====================================================
-- PARTE 2: Função helper auth_user_restricted_to_own_leads
--
-- Retorna TRUE quando:
--   1. A empresa tem restrict_leads_to_owner = true
--   2. O usuário NÃO tem view_all_leads = true em company_users.permissions
--
-- Design:
--   - SECURITY DEFINER: precisa ler companies e company_users
--     sem depender do RLS do caller (que pode ser a própria
--     policy de leads em avaliação).
--   - STABLE: resultado constante para mesmo company_id na
--     mesma transação; PostgreSQL pode memoizar para todas
--     as linhas de uma query filtrada por company_id.
--   - auth.uid() interno: nunca aceita user_id como parâmetro.
--   - Sem risco de recursão: acessa companies e company_users,
--     que não têm policies que consultam leads.
-- =====================================================

CREATE OR REPLACE FUNCTION public.auth_user_restricted_to_own_leads(
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restrict   BOOLEAN;
  v_view_all   BOOLEAN;
BEGIN
  -- 1. A empresa tem a restrição ativa?
  SELECT restrict_leads_to_owner
    INTO v_restrict
    FROM companies
   WHERE id = p_company_id;

  -- Empresa não encontrada ou restrição desligada: sem filtro extra.
  IF NOT COALESCE(v_restrict, false) THEN
    RETURN false;
  END IF;

  -- 2. O usuário autenticado tem view_all_leads nesta empresa?
  --    Lê diretamente de company_users.permissions (JSONB),
  --    mesmo padrão de caller_has_permission.
  SELECT COALESCE((cu.permissions ->> 'view_all_leads')::boolean, false)
    INTO v_view_all
    FROM company_users cu
   WHERE cu.user_id    = auth.uid()
     AND cu.company_id = p_company_id
     AND cu.is_active  = true;

  -- Usuário com view_all_leads ou não encontrado na empresa: sem restrição.
  IF COALESCE(v_view_all, false) THEN
    RETURN false;
  END IF;

  -- Ambas as condições atendidas: restringir ao próprio usuário.
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_restricted_to_own_leads(uuid) TO authenticated;

COMMENT ON FUNCTION public.auth_user_restricted_to_own_leads IS
  'Retorna TRUE quando o usuário autenticado deve ver apenas seus próprios leads. '
  'Condições: companies.restrict_leads_to_owner = true '
  'AND company_users.permissions->view_all_leads != true. '
  'SECURITY DEFINER + auth.uid() interno — nunca aceita user_id externo. '
  'UI helper useLeadPermissions replica a lógica apenas para UX; '
  'esta função é a autoridade de segurança real.';


-- =====================================================
-- PARTE 3: Atualizar policy leads_member_or_parent_admin
--
-- Mudança: adicionar condição de owner restriction ao USING.
--   - USING governa SELECT, UPDATE e DELETE (row visibility).
--   - WITH CHECK governa INSERT (criação de leads) — mantido
--     sem a condição de owner para que sellers possam criar leads.
--
-- Não toca em leads_support_partner_access (policy de partner/support).
-- =====================================================

DROP POLICY IF EXISTS "leads_member_or_parent_admin" ON leads;

CREATE POLICY "leads_member_or_parent_admin"
ON leads FOR ALL TO authenticated
USING (
  -- Pass-through para service_role (backend/automações)
  (current_setting('role'::text) = 'service_role'::text)
  OR (
    auth.uid() IS NOT NULL
    AND (
      -- Trilha 1: membro ativo da empresa
      auth_user_is_company_member(company_id)
      -- Trilha 2: admin da empresa pai
      OR auth_user_is_parent_admin(company_id)
    )
    AND (
      -- Sem restrição: usuário vê todos os leads da empresa
      NOT auth_user_restricted_to_own_leads(company_id)
      -- Com restrição: apenas leads atribuídos ao próprio usuário
      OR responsible_user_id = auth.uid()
    )
  )
)
WITH CHECK (
  -- INSERT e UPDATE de resultado: sem restrição de owner.
  -- Sellers podem criar leads; a restrição é apenas de visibilidade.
  (current_setting('role'::text) = 'service_role'::text)
  OR (
    auth.uid() IS NOT NULL
    AND (
      auth_user_is_company_member(company_id)
      OR auth_user_is_parent_admin(company_id)
    )
  )
);
