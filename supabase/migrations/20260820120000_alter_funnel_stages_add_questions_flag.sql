-- =====================================================
-- MIGRATION: Add enable_transition_questions to funnel_stages (R1)
-- Data: 20/08/2026
-- Objetivo: Adicionar flag de controle de perguntas por etapa
--
-- Escopo R1:
--   - enable_transition_questions BOOLEAN NOT NULL DEFAULT false
--   - Não altera comportamento de etapas existentes (DEFAULT false)
--   - Flag controlada por admin via Settings
--
-- Comportamento:
--   false: movimento normal, perguntas ignoradas
--   true + zero perguntas: movimento normal com warning no admin
--   true + perguntas ativas: valida via move_opportunity
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. ADICIONAR COLUNA
-- =====================================================

ALTER TABLE funnel_stages 
  ADD COLUMN IF NOT EXISTS enable_transition_questions BOOLEAN NOT NULL DEFAULT false;

-- =====================================================
-- 2. COMMENT
-- =====================================================

COMMENT ON COLUMN funnel_stages.enable_transition_questions IS 
  'R1: Habilita perguntas de transição ao mover lead para esta etapa. '
  'false: movimento normal, perguntas ignoradas. '
  'true + zero perguntas: movimento normal (warning no admin). '
  'true + perguntas ativas: RPC move_opportunity valida respostas required.';
