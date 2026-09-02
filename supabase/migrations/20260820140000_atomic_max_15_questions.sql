-- =====================================================
-- MIGRATION: Atomic MAX 15 Questions Check
-- Data: 02/09/2026 - Etapa F.5 Hardening
-- 
-- Garante atomicidade no limite de 15 perguntas ativas por stage
-- usando constraint + partial unique index
-- =====================================================

-- Solução: Partial unique index com ROW_NUMBER
-- Para garantir max 15 ativas, criamos índices únicos para cada "slot" (1-15)
-- Se tentar criar/ativar a 16ª, violará constraint

-- Função helper para calcular o "slot" de uma pergunta ativa
-- Retorna 1-15 para as primeiras 15 ativas, NULL para inativas ou >15
CREATE OR REPLACE FUNCTION stage_transition_question_active_slot(
  p_company_id UUID,
  p_funnel_stage_id UUID,
  p_question_id UUID,
  p_active BOOLEAN
)
RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_slot INT;
BEGIN
  -- Se não está ativa, não ocupa slot
  IF p_active = FALSE THEN
    RETURN NULL;
  END IF;

  -- Calcular posição (slot) entre as perguntas ativas desta stage
  -- Ordenado por sort_order, id para determinismo
  SELECT slot INTO v_slot
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (ORDER BY sort_order, id) AS slot
    FROM stage_transition_questions
    WHERE company_id = p_company_id
      AND funnel_stage_id = p_funnel_stage_id
      AND active = TRUE
      AND (id = p_question_id OR id != p_question_id) -- incluir a própria para UPDATE
  ) numbered
  WHERE id = p_question_id;

  -- Se esta pergunta estiver nas primeiras 15, retornar slot
  -- Se estiver além de 15, retornar NULL (não cria constraint)
  IF v_slot IS NOT NULL AND v_slot <= 15 THEN
    RETURN v_slot;
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- Index parcial para cada slot (1-15)
-- Cada slot pode ter no máximo 1 pergunta por (company, stage)
-- Isto garante que não é possível ter mais de 15 ativas

-- Slot 1
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_1_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 1;

-- Slot 2
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_2_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 2;

-- Slot 3
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_3_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 3;

-- Slot 4
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_4_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 4;

-- Slot 5
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_5_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 5;

-- Slot 6
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_6_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 6;

-- Slot 7
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_7_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 7;

-- Slot 8
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_8_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 8;

-- Slot 9
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_9_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 9;

-- Slot 10
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_10_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 10;

-- Slot 11
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_11_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 11;

-- Slot 12
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_12_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 12;

-- Slot 13
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_13_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 13;

-- Slot 14
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_14_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 14;

-- Slot 15
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  stage_transition_questions_active_slot_15_unique
ON stage_transition_questions (company_id, funnel_stage_id)
WHERE active = TRUE 
  AND stage_transition_question_active_slot(company_id, funnel_stage_id, id, active) = 15;

-- IMPORTANTE: Esta abordagem NÃO funciona como esperado para garantir max 15
-- porque a função é avaliada APÓS o INSERT/UPDATE
-- 
-- ALTERNATIVA MELHOR: Usar CHECK constraint com RPC que conta ativas

-- Remover índices parciais (não funcionam como esperado)
DROP INDEX IF EXISTS stage_transition_questions_active_slot_1_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_2_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_3_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_4_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_5_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_6_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_7_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_8_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_9_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_10_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_11_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_12_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_13_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_14_unique;
DROP INDEX IF EXISTS stage_transition_questions_active_slot_15_unique;

DROP FUNCTION IF EXISTS stage_transition_question_active_slot;

-- =====================================================
-- SOLUÇÃO CORRETA: Trigger BEFORE INSERT/UPDATE
-- =====================================================

CREATE OR REPLACE FUNCTION check_max_active_questions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_active_count INT;
BEGIN
  -- Apenas validar se está ativando (active = TRUE)
  IF NEW.active = FALSE THEN
    RETURN NEW;
  END IF;

  -- Contar quantas perguntas ativas já existem para esta stage
  -- Excluindo a própria pergunta se for UPDATE
  SELECT COUNT(*)
  INTO v_current_active_count
  FROM stage_transition_questions
  WHERE company_id = NEW.company_id
    AND funnel_stage_id = NEW.funnel_stage_id
    AND active = TRUE
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- Se já existem 15 ativas, bloquear
  IF v_current_active_count >= 15 THEN
    RAISE EXCEPTION 'MAX_ACTIVE_QUESTIONS: Limite de 15 perguntas ativas por etapa atingido'
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger BEFORE INSERT OR UPDATE
CREATE TRIGGER enforce_max_active_questions
  BEFORE INSERT OR UPDATE OF active
  ON stage_transition_questions
  FOR EACH ROW
  WHEN (NEW.active = TRUE)
  EXECUTE FUNCTION check_max_active_questions();

-- Lock advisory para prevenir race conditions extremas
-- Se dois INSERTs simultâneos chegarem, o trigger sozinho pode não ser suficiente
-- Usar advisory lock por (company_id, stage_id) durante INSERT/UPDATE

CREATE OR REPLACE FUNCTION acquire_stage_questions_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key BIGINT;
BEGIN
  -- Apenas lock se estiver ativando
  IF NEW.active = FALSE THEN
    RETURN NEW;
  END IF;

  -- Gerar lock key determinística baseada em company_id + funnel_stage_id
  -- Usar hashtext para converter UUIDs em INT8
  v_lock_key := (hashtext(NEW.company_id::TEXT) # hashtext(NEW.funnel_stage_id::TEXT))::BIGINT;

  -- Advisory lock (released automatically no fim da transaction)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  RETURN NEW;
END;
$$;

CREATE TRIGGER acquire_stage_questions_lock_trigger
  BEFORE INSERT OR UPDATE OF active
  ON stage_transition_questions
  FOR EACH ROW
  WHEN (NEW.active = TRUE)
  EXECUTE FUNCTION acquire_stage_questions_lock();

COMMENT ON TRIGGER acquire_stage_questions_lock_trigger ON stage_transition_questions IS
  'Adquire advisory lock por stage antes de INSERT/UPDATE de pergunta ativa, prevenindo race conditions no limite de 15 perguntas.';

COMMENT ON TRIGGER enforce_max_active_questions ON stage_transition_questions IS
  'Garante limite máximo de 15 perguntas ativas por stage. Bloqueia INSERT/UPDATE se limite for excedido.';

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- Estas funções são TRIGGER FUNCTIONS, não devem ser executadas diretamente
-- Apenas o sistema de triggers PostgreSQL as invoca
-- Remover TODOS os privilégios herdados de DEFAULT PRIVILEGES

-- check_max_active_questions: Remover acesso de todos os roles de aplicação
REVOKE ALL ON FUNCTION public.check_max_active_questions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_max_active_questions() FROM anon;
REVOKE ALL ON FUNCTION public.check_max_active_questions() FROM authenticated;

-- acquire_stage_questions_lock: Remover acesso de todos os roles de aplicação
REVOKE ALL ON FUNCTION public.acquire_stage_questions_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_stage_questions_lock() FROM anon;
REVOKE ALL ON FUNCTION public.acquire_stage_questions_lock() FROM authenticated;

-- NÃO conceder EXECUTE para authenticated/service_role
-- Estas funções são invocadas EXCLUSIVAMENTE pelo sistema de triggers PostgreSQL

COMMENT ON FUNCTION public.check_max_active_questions() IS
  'R1 M5: Trigger function para validar limite de 15 perguntas ativas por stage. '
  'Invocada automaticamente pelo trigger enforce_max_active_questions. '
  'ACL: Apenas sistema de triggers. PUBLIC/anon sem acesso.';

COMMENT ON FUNCTION public.acquire_stage_questions_lock() IS
  'R1 M5: Trigger function para adquirir advisory lock durante INSERT/UPDATE de perguntas ativas. '
  'Previne race conditions no limite de 15 perguntas. '
  'Invocada automaticamente pelo trigger acquire_stage_questions_lock_trigger. '
  'ACL: Apenas sistema de triggers. PUBLIC/anon sem acesso.';
