-- =====================================================
-- MIGRATION: Fix ACL stage_transition_questions (R1 - Correção M1)
-- Data: 20/08/2026
-- Objetivo: Corrigir privilégios amplos herdados de DEFAULT PRIVILEGES
--
-- Problema:
--   M1 criou a tabela que herdou DEFAULT PRIVILEGES do Supabase:
--   - anon: privilégios amplos (DELETE, INSERT, UPDATE, etc.)
--   - authenticated: privilégios amplos
--
-- Contrato esperado R1:
--   - PUBLIC: nenhum privilégio
--   - anon: nenhum privilégio
--   - authenticated: SELECT somente
--   - service_role: acesso backend necessário (preservado)
--   - RLS permanece habilitada
--
-- Causa raiz:
--   DEFAULT PRIVILEGES no schema public concedem arwdDxt para anon/authenticated
--   em todas as novas tabelas. REVOKE ... FROM PUBLIC não remove grants diretos.
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. REVOGAR PRIVILÉGIOS AMPLOS
-- =====================================================

-- Remover todos os privilégios de PUBLIC (redundante mas explícito)
REVOKE ALL ON stage_transition_questions FROM PUBLIC;

-- Remover todos os privilégios de anon
REVOKE ALL ON stage_transition_questions FROM anon;

-- Remover todos os privilégios de authenticated
REVOKE ALL ON stage_transition_questions FROM authenticated;

-- =====================================================
-- 2. CONCEDER PRIVILÉGIOS CORRETOS
-- =====================================================

-- authenticated: SELECT somente (leitura via RLS policy)
GRANT SELECT ON stage_transition_questions TO authenticated;

-- service_role e postgres: acesso total (backend/admin)
-- (já possuem via DEFAULT PRIVILEGES, mas explícito por clareza)
GRANT ALL ON stage_transition_questions TO service_role;
GRANT ALL ON stage_transition_questions TO postgres;

-- =====================================================
-- 3. COMENTÁRIO
-- =====================================================

COMMENT ON TABLE stage_transition_questions IS 
  'R1: Perguntas de transição por etapa do funil. '
  'Pertencem à ETAPA DESTINO. Máximo de 15 ativas por etapa. '
  'field_type imutável após existir resposta. '
  'SELECT/MULTI_SELECT exigem options (array JSON não vazio). '
  'ACL: anon=NONE, authenticated=SELECT (via RLS), service_role=ALL.';
