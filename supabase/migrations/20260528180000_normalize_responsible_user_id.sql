-- =============================================================================
-- Migration: normalize_responsible_user_id
-- Data: 2026-05-28
-- Objetivo: Garantir que leads.responsible_user_id armazene exclusivamente
--           auth.users.id, conforme exigido por RLS, hooks, backend APIs e RPCs.
--
-- Contexto:
--   Um bug no frontend causou gravação de company_users.id em vez de
--   auth.users.id em leads.responsible_user_id. Esta migration corrige os
--   dados existentes fazendo o JOIN em company_users para obter o user_id
--   correto, sempre respeitando o company_id do lead (isolamento multi-tenant).
--
-- IMPORTANTE: Antes de executar em qualquer ambiente, rode manualmente a
--   query de validação abaixo e confirme que retorna 0 linhas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRÉ-VALIDAÇÃO (executar manualmente antes de aplicar esta migration)
-- -----------------------------------------------------------------------------
-- Esta query identifica leads com responsible_user_id que aponta para um
-- company_users.id de uma empresa diferente da do lead — o que indicaria
-- inconsistência cross-tenant grave. Se retornar qualquer linha: PARAR.
--
-- SELECT
--   l.id,
--   l.company_id,
--   l.responsible_user_id,
--   cu.user_id,
--   cu.company_id AS cu_company_id
-- FROM leads l
-- JOIN company_users cu
--   ON cu.id = l.responsible_user_id
-- WHERE l.responsible_user_id IS NOT NULL
--   AND cu.company_id <> l.company_id;
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- CORREÇÃO PRINCIPAL
-- Substitui company_users.id → auth.users.id em leads.responsible_user_id.
-- Apenas linhas onde responsible_user_id ainda aponta para company_users.id
-- (identificado via JOIN) e dentro do mesmo company_id.
-- Leads com responsible_user_id NULL não são tocados.
-- -----------------------------------------------------------------------------
UPDATE leads l
SET responsible_user_id = cu.user_id
FROM company_users cu
WHERE cu.id          = l.responsible_user_id
  AND cu.company_id  = l.company_id
  AND l.responsible_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- PÓS-VALIDAÇÃO (executar manualmente após a migration)
-- -----------------------------------------------------------------------------
-- 1. Confirmar que nenhum responsible_user_id ainda aponta para company_users.id.
--    Resultado esperado: 0
--
-- SELECT COUNT(*)
-- FROM leads l
-- JOIN company_users cu
--   ON cu.id = l.responsible_user_id;
--
-- 2. Confirmar que leads com responsible_user_id não nulo apontam para
--    auth.users.id válido.
--    Resultado esperado: COUNT(*) deve igualar o total de leads com
--    responsible_user_id não nulo.
--
-- SELECT COUNT(*)
-- FROM leads l
-- JOIN auth.users u
--   ON u.id = l.responsible_user_id
-- WHERE l.responsible_user_id IS NOT NULL;
--
-- 3. Confirmar que leads sem responsável continuam NULL.
--
-- SELECT COUNT(*)
-- FROM leads
-- WHERE responsible_user_id IS NULL;
-- -----------------------------------------------------------------------------
