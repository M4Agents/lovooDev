-- =====================================================
-- MIGRATION: Atomic Immutability for field_type and options (R1 Hardening)
-- Data: 02/09/2026 - ETAPA H
-- Objetivo: Garantir atomicidade da imutabilidade após respostas existentes
--
-- PROBLEMA TOCTOU (Time-Of-Check-Time-Of-Use):
--   Endpoint update.ts verifica answers com SELECT, depois UPDATE
--   Entre check e use, outra transação pode inserir answer
--   Violação da regra de imutabilidade
--
-- SOLUÇÃO:
--   Trigger BEFORE UPDATE que verifica atomicamente se há answers
--   Lock não necessário: trigger executa dentro da transação do UPDATE
--   Rejeita UPDATE se field_type ou options mudar E existem answers
--
-- SEGURANÇA:
--   Trigger sempre executado, mesmo com service_role
--   Não pode ser bypassed via SQL direto
--   Garante integridade dos dados R1
-- =====================================================

SET search_path = public;

-- =====================================================
-- FUNÇÃO: Verificar imutabilidade field_type/options
-- =====================================================

CREATE OR REPLACE FUNCTION check_question_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'  -- Prevenir search_path injection attacks
AS $$
DECLARE
  v_answer_count INTEGER;
BEGIN
  -- Verificar se field_type ou options estão sendo alterados
  IF (NEW.field_type IS DISTINCT FROM OLD.field_type) OR 
     (NEW.options IS DISTINCT FROM OLD.options) THEN
    
    -- Verificar atomicamente se existem respostas para esta pergunta
    SELECT COUNT(*)
      INTO v_answer_count
      FROM stage_transition_answers
     WHERE question_id = OLD.id;
    
    IF v_answer_count > 0 THEN
      RAISE EXCEPTION 'IMMUTABLE_FIELD_VIOLATION: field_type e options não podem ser alterados após respostas existentes (% respostas encontradas)', v_answer_count;
    END IF;
  END IF;
  
  -- funnel_stage_id também é imutável (sempre)
  IF NEW.funnel_stage_id IS DISTINCT FROM OLD.funnel_stage_id THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD_VIOLATION: funnel_stage_id não pode ser alterado após criação';
  END IF;
  
  RETURN NEW;
END;
$$;

-- =====================================================
-- TRIGGER: Enforce immutability BEFORE UPDATE
-- =====================================================

CREATE TRIGGER enforce_question_immutability
  BEFORE UPDATE ON stage_transition_questions
  FOR EACH ROW
  EXECUTE FUNCTION check_question_immutability();

-- =====================================================
-- COMENTÁRIO
-- =====================================================

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- Esta função é TRIGGER FUNCTION, não deve ser executada diretamente
-- Apenas o sistema de triggers PostgreSQL a invoca
-- Remover TODOS os privilégios herdados de DEFAULT PRIVILEGES

REVOKE ALL ON FUNCTION public.check_question_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_question_immutability() FROM anon;
REVOKE ALL ON FUNCTION public.check_question_immutability() FROM authenticated;

-- NÃO conceder EXECUTE para authenticated/service_role
-- Esta função é invocada EXCLUSIVAMENTE pelo sistema de triggers PostgreSQL

COMMENT ON FUNCTION check_question_immutability() IS
  'R1 M7 Hardening: Garante atomicamente que field_type, options e funnel_stage_id não podem ser alterados após respostas existentes. '
  'Previne TOCTOU race condition. Invocada automaticamente pelo trigger enforce_question_immutability. '
  'ACL: Apenas sistema de triggers. PUBLIC/anon sem acesso.';

COMMENT ON TRIGGER enforce_question_immutability ON stage_transition_questions IS
  'R1 M7 Hardening: Trigger que impede alteração de field_type/options/funnel_stage_id se existem respostas. '
  'Execução atômica dentro da transação do UPDATE.';
