-- =====================================================
-- MIGRATION: Fix ACL move_opportunity_v2 (R1 - Correção M4)
-- Data: 20/08/2026
-- Objetivo: Corrigir privilégios herdados de DEFAULT PRIVILEGES
--
-- Problema identificado:
--   - move_opportunity_v2 criada em M4 herdou EXECUTE para anon
--   - DEFAULT PRIVILEGES do Supabase concede EXECUTE a PUBLIC/anon/authenticated
--   - REVOKE ALL FROM PUBLIC foi insuficiente
--
-- Solução:
--   - Remover privilégios de PUBLIC, anon explicitamente
--   - Garantir EXECUTE apenas para authenticated e service_role
--
-- Esta migration é IDEMPOTENTE:
--   - Pode ser aplicada múltiplas vezes sem efeitos colaterais
--   - Não altera lógica da função
--   - Não recria função
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. REMOVER PRIVILÉGIOS INDESEJADOS
-- =====================================================

-- Remover privilégios herdados de DEFAULT PRIVILEGES
REVOKE ALL ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) FROM anon;

-- =====================================================
-- 2. GARANTIR PRIVILÉGIOS CORRETOS
-- =====================================================

-- Authenticated pode executar (usuários humanos autenticados)
-- Service_role pode executar (backend APIs via service_role)
GRANT EXECUTE ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) TO service_role;

-- =====================================================
-- 3. ATUALIZAR COMMENT
-- =====================================================

COMMENT ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) IS
  'R1: Função PARALELA para validação de transition questions sem afetar produção em banco compartilhado. '
  'move_opportunity ORIGINAL permanece intacta para callers produtivos. '
  'Após validação completa em Dev, será promovida para produção (estratégia a definir). '
  'p_transition_answers: [{"question_id": "uuid", "value": "texto"}]. '
  'Tipos suportados: text, number, boolean, select, multi_select. '
  'multi_select: value é JSON array serializado, canonicalização automática conforme ordem de options. '
  'Escopo R1: perguntas aplicadas EXCLUSIVAMENTE em active->active + enable_transition_questions=true. '
  'Won/lost/reopen NÃO são afetados por perguntas na R1. '
  'Valida: JSON structure, UUID format, cross-tenant, required completeness, field_type rules. '
  'Preserva comportamento original: history, status sync, close_cycle_if_open. '
  'SECURITY DEFINER: valida multi-tenant mesmo em service_role. '
  'Early return APÓS auth para não vazar dados cross-tenant. '
  'ACL: anon=NONE, authenticated=EXECUTE (via RLS), service_role=EXECUTE.';
