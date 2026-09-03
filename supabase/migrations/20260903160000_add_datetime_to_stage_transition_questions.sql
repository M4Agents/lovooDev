-- =====================================================
-- MIGRATION: Add datetime field_type to Stage Transition Questions (R1)
-- Data: 03/09/2026
-- Projeto: etzdsywunlpbgxkphuil
-- Objetivo: Adicionar tipo datetime com integração futura ao calendário
--
-- Escopo:
--   1. Adicionar 'datetime' ao CHECK constraint stq_valid_field_type
--   2. Adicionar coluna create_activity_on_answer (BOOLEAN)
--   3. Adicionar CHECK: create_activity_on_answer=true apenas para datetime
--   4. Adicionar UNIQUE INDEX: máximo 1 pergunta com flag por stage
--   5. Estender move_opportunity_v2 com validação datetime
--
-- Estratégia datetime:
--   - Valor recebido: ISO 8601 com timezone explícito (Z ou offset)
--   - Rejeita valores sem timezone (ambíguos)
--   - Validação por TIMESTAMPTZ após verificar formato
--   - Datetime comum: qualquer instante válido
--   - Datetime com create_activity_on_answer=true: >= NOW()
--   - Atividade NÃO é criada no SQL (responsabilidade frontend)
--
-- Imutabilidade:
--   - field_type/options continuam protegidos pelo trigger M7
--   - create_activity_on_answer NÃO é imutável (flexibilidade operacional)
--
-- Multi-tenant:
--   - Todas validações preservadas
--   - Cross-tenant protection mantida
--   - ACL inalterada
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. ESTENDER CHECK CONSTRAINT FIELD_TYPE
-- =====================================================

-- Remover constraint antigo
ALTER TABLE stage_transition_questions 
DROP CONSTRAINT IF EXISTS stq_valid_field_type;

-- Recriar constraint com datetime
ALTER TABLE stage_transition_questions 
ADD CONSTRAINT stq_valid_field_type CHECK (
  field_type IN ('text', 'number', 'boolean', 'select', 'multi_select', 'datetime')
);

COMMENT ON CONSTRAINT stq_valid_field_type ON stage_transition_questions IS
  'R1: field_type aceita text, number, boolean, select, multi_select, datetime. '
  'datetime recebe ISO 8601 com timezone explícito (Z ou offset), validado por TIMESTAMPTZ na RPC.';

-- =====================================================
-- 2. ADICIONAR COLUNA create_activity_on_answer
-- =====================================================

ALTER TABLE stage_transition_questions 
ADD COLUMN create_activity_on_answer BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stage_transition_questions.create_activity_on_answer IS
  'R1: Flag que indica se o frontend deve oferecer criação de atividade após responder pergunta datetime. '
  'Aplicável SOMENTE quando field_type=datetime. '
  'Frontend abre ActivityModal com datetime pré-preenchido. '
  'Atividade NÃO é criada atomicamente na transição (pode ser cancelada sem rollback). '
  'NÃO é imutável (admin pode ajustar comportamento futuro).';

-- =====================================================
-- 3. CHECK CONSTRAINT: flag apenas para datetime
-- =====================================================

ALTER TABLE stage_transition_questions 
ADD CONSTRAINT stq_activity_flag_only_for_datetime CHECK (
  create_activity_on_answer = false OR field_type = 'datetime'
);

COMMENT ON CONSTRAINT stq_activity_flag_only_for_datetime ON stage_transition_questions IS
  'R1: create_activity_on_answer=true só é válido quando field_type=datetime. '
  'Garante integridade semântica: atividades só fazem sentido para campos de data/hora.';

-- =====================================================
-- 4. UNIQUE PARTIAL INDEX: máximo 1 flag por stage
-- =====================================================

CREATE UNIQUE INDEX idx_stq_one_activity_flag_per_stage 
ON stage_transition_questions (funnel_stage_id) 
WHERE active = true AND create_activity_on_answer = true;

COMMENT ON INDEX idx_stq_one_activity_flag_per_stage IS
  'R1: Garante máximo 1 pergunta datetime com create_activity_on_answer=true por stage. '
  'Simplifica UX (evita múltiplos prompts de atividade sequenciais). '
  'R2 pode relaxar essa restrição com UX mais sofisticada.';

-- =====================================================
-- 5. RECRIAR move_opportunity_v2 COM VALIDAÇÃO DATETIME
-- =====================================================

CREATE OR REPLACE FUNCTION public.move_opportunity_v2(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_from_stage_id     UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER,
  p_transition_answers JSONB DEFAULT NULL
)
RETURNS SETOF opportunity_funnel_positions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_company_id          UUID;
  v_actual_from_stage   UUID;
  v_entered_at          TIMESTAMPTZ;
  v_from_stage_type     VARCHAR(50);
  v_to_stage_type       VARCHAR(50);
  v_to_stage_tracks     BOOLEAN;
  v_enable_questions    BOOLEAN;
  v_stage_history_id    UUID;
  v_active_count        INTEGER;
  v_required_count      INTEGER;
  v_question_id         UUID;
  v_value               TEXT;
  v_question_rec        RECORD;
  v_question_ids        UUID[];
  v_provided_ids        UUID[];
  v_value_jsonb         JSONB;
  v_array_elem          RECORD;
  v_array_elem_str      TEXT;
  v_canonical_array     TEXT[];
  v_option_idx          INTEGER;
  v_datetime            TIMESTAMPTZ;
BEGIN
  -- =====================================================
  -- PASSO 1: Ler estado atual e validar posição
  -- =====================================================
  
  SELECT stage_id, entered_stage_at
    INTO v_actual_from_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POSITION_NOT_FOUND: posicao nao encontrada para opportunity_id=% funnel_id=%',
      p_opportunity_id, p_funnel_id;
  END IF;

  -- =====================================================
  -- PASSO 2: Obter company_id e validar ownership
  -- =====================================================
  
  SELECT company_id
    INTO v_company_id
    FROM opportunities
   WHERE id = p_opportunity_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND: oportunidade nao encontrada: %', p_opportunity_id;
  END IF;

  -- Validar que funnel pertence à mesma empresa
  IF NOT EXISTS (
    SELECT 1 FROM sales_funnels
     WHERE id = p_funnel_id AND company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_FUNNEL: funil % nao pertence a empresa %', p_funnel_id, v_company_id;
  END IF;

  -- =====================================================
  -- PASSO 3: Validar autorização humana (se aplicável)
  -- =====================================================
  
  IF auth.uid() IS NOT NULL AND NOT auth_user_can_access_funnel(v_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario nao tem acesso ao funil %', p_funnel_id;
  END IF;

  -- Early return: sem efeito se já está na etapa de destino
  -- IMPORTANTE: early return DEPOIS das validações de auth/multi-tenant
  -- para não vazar dados cross-tenant via timing/comportamento distinguível
  IF v_actual_from_stage = p_to_stage_id THEN
    RETURN QUERY
      SELECT * FROM opportunity_funnel_positions
       WHERE opportunity_id = p_opportunity_id
         AND funnel_id      = p_funnel_id;
    RETURN;
  END IF;

  -- =====================================================
  -- PASSO 4: Validar etapa de origem
  -- =====================================================
  
  -- p_from_stage_id é informativo; a posição real é v_actual_from_stage
  -- Validar que a etapa de origem pertence ao funnel
  SELECT stage_type
    INTO v_from_stage_type
    FROM funnel_stages
   WHERE id        = v_actual_from_stage
     AND funnel_id = p_funnel_id;

  IF v_from_stage_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE_FUNNEL: etapa de origem invalida ou funil incompativel: stage_id=% funnel_id=%',
      v_actual_from_stage, p_funnel_id;
  END IF;

  -- =====================================================
  -- PASSO 5: Validar etapa de destino
  -- =====================================================
  
  SELECT stage_type, track_contact_attempts, enable_transition_questions
    INTO v_to_stage_type, v_to_stage_tracks, v_enable_questions
    FROM funnel_stages
   WHERE id        = p_to_stage_id
     AND funnel_id = p_funnel_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE_FUNNEL: etapa de destino invalida ou funil incompativel: stage_id=% funnel_id=%',
      p_to_stage_id, p_funnel_id;
  END IF;

  -- =====================================================
  -- PASSO 6: Validar perguntas (R1 - SOMENTE active → active)
  -- =====================================================
  
  -- R1: perguntas aplicadas EXCLUSIVAMENTE em transições active → active
  IF v_from_stage_type = 'active' AND v_to_stage_type = 'active' AND v_enable_questions = true THEN
    
    -- Contar perguntas ativas (máximo 15)
    SELECT COUNT(*)
      INTO v_active_count
      FROM stage_transition_questions
     WHERE funnel_stage_id = p_to_stage_id
       AND active = true;
    
    IF v_active_count > 15 THEN
      RAISE EXCEPTION 'TOO_MANY_ACTIVE_QUESTIONS: etapa possui % perguntas ativas (maximo 15)', v_active_count;
    END IF;
    
    -- Contar perguntas required ativas
    SELECT COUNT(*)
      INTO v_required_count
      FROM stage_transition_questions
     WHERE funnel_stage_id = p_to_stage_id
       AND active = true
       AND required = true;
    
    -- Se existem required mas answers NULL, bloquear
    IF v_required_count > 0 AND p_transition_answers IS NULL THEN
      RAISE EXCEPTION 'MISSING_REQUIRED_ANSWER: etapa exige % resposta(s) obrigatoria(s)', v_required_count;
    END IF;
    
    -- Se answers presentes, validar completamente
    IF p_transition_answers IS NOT NULL THEN
      -- Validar formato: deve ser array JSON
      IF jsonb_typeof(p_transition_answers) != 'array' THEN
        RAISE EXCEPTION 'INVALID_TRANSITION_ANSWERS_FORMAT: esperado array JSON';
      END IF;
      
      -- Validar estrutura de cada item ANTES de cast UUID
      FOR v_question_rec IN
        SELECT item FROM jsonb_array_elements(p_transition_answers) item
      LOOP
        -- Validar presença de campos obrigatórios
        IF NOT (v_question_rec.item ? 'question_id' AND v_question_rec.item ? 'value') THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_ANSWERS_FORMAT: item sem question_id ou value';
        END IF;
        
        -- Validar tipos JSON dos campos
        IF jsonb_typeof(v_question_rec.item->'question_id') != 'string' THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_ANSWERS_FORMAT: question_id deve ser string UUID';
        END IF;
        
        IF jsonb_typeof(v_question_rec.item->'value') != 'string' THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_ANSWERS_FORMAT: value deve ser string';
        END IF;
        
        -- Validar formato UUID antes de cast
        IF NOT (v_question_rec.item->>'question_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_ANSWERS_FORMAT: question_id formato UUID invalido';
        END IF;
      END LOOP;
      
      -- Extrair question_ids fornecidos (agora seguro fazer cast)
      v_provided_ids := ARRAY(
        SELECT (item->>'question_id')::UUID
          FROM jsonb_array_elements(p_transition_answers) item
      );
      
      -- Verificar duplicatas
      IF array_length(v_provided_ids, 1) != (SELECT COUNT(DISTINCT q) FROM unnest(v_provided_ids) q) THEN
        RAISE EXCEPTION 'DUPLICATE_QUESTION_ID: question_id duplicada no payload';
      END IF;
      
      -- Validar cada resposta fornecida
      FOR v_question_rec IN
        SELECT 
          (item->>'question_id')::UUID as question_id,
          item->>'value' as value
        FROM jsonb_array_elements(p_transition_answers) item
      LOOP
        v_question_id := v_question_rec.question_id;
        v_value := v_question_rec.value;
        
        -- Buscar pergunta e validar
        SELECT * INTO v_question_rec
          FROM stage_transition_questions
         WHERE id = v_question_id;
        
        IF v_question_rec.id IS NULL THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION: pergunta % nao encontrada', v_question_id;
        END IF;
        
        -- Validar que pergunta pertence à empresa correta
        IF v_question_rec.company_id != v_company_id THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION: pergunta % nao pertence a empresa %', 
            v_question_id, v_company_id;
        END IF;
        
        -- Validar que pergunta pertence à etapa destino
        IF v_question_rec.funnel_stage_id != p_to_stage_id THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION: pergunta % nao pertence a etapa %', 
            v_question_id, p_to_stage_id;
        END IF;
        
        -- Validar que pergunta está ativa
        IF v_question_rec.active = false THEN
          RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION: pergunta % esta inativa', v_question_id;
        END IF;
        
        -- Validar value não vazio
        IF trim(v_value) = '' THEN
          RAISE EXCEPTION 'EMPTY_ANSWER_VALUE: resposta vazia para pergunta %', v_question_id;
        END IF;
        
        -- Validar por tipo
        IF v_question_rec.field_type = 'select' THEN
          -- FAIL-CLOSED: validar configuração da pergunta ANTES de comparar value
          -- Evitar conversão silenciosa de [1, true, "A"] via jsonb_array_elements_text
          IF v_question_rec.options IS NULL THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: pergunta % select sem options', v_question_id;
          END IF;
          
          IF jsonb_typeof(v_question_rec.options) != 'array' THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: pergunta % options nao e array', v_question_id;
          END IF;
          
          IF jsonb_array_length(v_question_rec.options) = 0 THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: pergunta % options vazio', v_question_id;
          END IF;
          
          -- Validar que todos elementos são strings
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_question_rec.options) elem
             WHERE jsonb_typeof(elem) != 'string'
          ) THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: pergunta % options contem tipos nao-string', v_question_id;
          END IF;
          
          -- Agora sim: validar value contra options válidas
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_question_rec.options) opt
             WHERE opt = v_value
          ) THEN
            RAISE EXCEPTION 'INVALID_SELECT_VALUE: valor "%" nao corresponde a opcoes da pergunta %', 
              v_value, v_question_id;
          END IF;
        
        ELSIF v_question_rec.field_type = 'boolean' THEN
          -- Value deve ser "true" ou "false"
          IF v_value NOT IN ('true', 'false') THEN
            RAISE EXCEPTION 'INVALID_BOOLEAN: valor "%" invalido para boolean (esperado "true" ou "false")', 
              v_value;
          END IF;
        
        ELSIF v_question_rec.field_type = 'number' THEN
          -- Value deve ser número válido (formato decimal com ponto)
          IF v_value !~ '^-?\d+(\.\d+)?$' THEN
            RAISE EXCEPTION 'INVALID_NUMBER: valor "%" invalido para number (esperado formato decimal)', 
              v_value;
          END IF;
        
        ELSIF v_question_rec.field_type = 'multi_select' THEN
          -- Parse JSON com tratamento de erro controlado
          BEGIN
            v_value_jsonb := v_value::jsonb;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'INVALID_MULTI_SELECT_FORMAT: valor nao e JSON valido para question_id=%', v_question_id;
          END;
          
          -- Validar tipo array
          IF jsonb_typeof(v_value_jsonb) != 'array' THEN
            RAISE EXCEPTION 'INVALID_MULTI_SELECT_FORMAT: multi_select esperava array JSON para question_id=%', v_question_id;
          END IF;
          
          -- REJEITAR array vazio (opcional sem resposta deve ser OMITIDA, não persistida como [])
          IF jsonb_array_length(v_value_jsonb) = 0 THEN
            IF v_question_rec.required THEN
              RAISE EXCEPTION 'MISSING_REQUIRED_ANSWER: multi_select obrigatorio vazio para question_id=%', v_question_id;
            ELSE
              RAISE EXCEPTION 'EMPTY_ANSWER_VALUE: array vazio nao deve ser persistido - omita resposta opcional para question_id=%', v_question_id;
            END IF;
          END IF;
          
          -- Validar configuração options ANTES de processar elementos
          IF v_question_rec.options IS NULL THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: multi_select sem options para question_id=%', v_question_id;
          END IF;
          
          IF jsonb_typeof(v_question_rec.options) != 'array' THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: multi_select options nao e array para question_id=%', v_question_id;
          END IF;
          
          IF jsonb_array_length(v_question_rec.options) = 0 THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: multi_select options vazio para question_id=%', v_question_id;
          END IF;
          
          -- Validar que todos elementos de options são strings
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_question_rec.options) elem
             WHERE jsonb_typeof(elem) != 'string'
          ) THEN
            RAISE EXCEPTION 'INVALID_TRANSITION_QUESTION_CONFIG: multi_select options contem tipos nao-string para question_id=%', v_question_id;
          END IF;
          
          -- Validar cada elemento do array de resposta
          FOR v_array_elem IN SELECT jsonb_array_elements(v_value_jsonb) elem
          LOOP
            -- Tipo string
            IF jsonb_typeof(v_array_elem.elem) != 'string' THEN
              RAISE EXCEPTION 'INVALID_MULTI_SELECT_VALUE: elemento nao e string para question_id=%', v_question_id;
            END IF;
            
            -- String não vazia
            v_array_elem_str := v_array_elem.elem #>> '{}';
            IF trim(v_array_elem_str) = '' THEN
              RAISE EXCEPTION 'EMPTY_ANSWER_VALUE: elemento vazio em multi_select para question_id=%', v_question_id;
            END IF;
            
            -- Validar opção existe (fail-closed)
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(v_question_rec.options) opt
              WHERE opt = v_array_elem_str
            ) THEN
              RAISE EXCEPTION 'INVALID_SELECT_VALUE: opcao "%" invalida para multi_select question_id=%', 
                v_array_elem_str, v_question_id;
            END IF;
          END LOOP;
          
          -- Validar duplicatas (array deve ter todos elementos únicos)
          IF (
            SELECT COUNT(DISTINCT elem) != COUNT(*)
            FROM jsonb_array_elements_text(v_value_jsonb) elem
          ) THEN
            RAISE EXCEPTION 'INVALID_MULTI_SELECT_VALUE: duplicatas nao permitidas para question_id=%', v_question_id;
          END IF;
          
          -- Canonicalizar: reordenar conforme question.options
          -- Preserva apenas elementos que existem em options, na ordem de options
          v_canonical_array := ARRAY(
            SELECT opt
            FROM jsonb_array_elements_text(v_question_rec.options) opt
            WHERE opt IN (SELECT elem FROM jsonb_array_elements_text(v_value_jsonb) elem)
          );
          
          -- Substituir v_value por versão canônica usando to_jsonb para conversão correta
          v_value := to_jsonb(v_canonical_array)::text;
        
        ELSIF v_question_rec.field_type = 'datetime' THEN
          -- REJEITAR formatos sem timezone (ambíguos)
          -- Aceitar apenas ISO 8601 com Z ou offset explícito
          -- Exemplos válidos: 2026-09-15T17:30:00Z, 2026-09-15T17:30:00.000Z, 2026-09-15T14:30:00-03:00
          -- Rejeitar: 2026-09-15T14:30, 2026-09-15 14:30
          IF NOT (v_value ~ 'T.*[Z]$' OR v_value ~ 'T.*[+-]\d{2}:\d{2}$') THEN
            RAISE EXCEPTION 'INVALID_DATETIME: formato sem timezone explicito "%" para question_id=% (esperado ISO 8601 com Z ou offset)', 
              v_value, v_question_id;
          END IF;
          
          -- Validar parse para TIMESTAMPTZ
          BEGIN
            v_datetime := v_value::timestamptz;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'INVALID_DATETIME: formato invalido "%" para question_id=% (erro de parse)', 
              v_value, v_question_id;
          END;
          
          -- Se create_activity_on_answer=true, datetime deve ser no futuro
          IF v_question_rec.create_activity_on_answer = true AND v_datetime < NOW() THEN
            RAISE EXCEPTION 'DATETIME_IN_PAST: datetime "%" esta no passado para question_id=% (atividades requerem futuro)', 
              v_value, v_question_id;
          END IF;
        
        END IF;
      END LOOP;
      
      -- Validar que todas as required foram fornecidas
      SELECT ARRAY(
        SELECT id FROM stage_transition_questions
         WHERE funnel_stage_id = p_to_stage_id
           AND active = true
           AND required = true
      ) INTO v_question_ids;
      
      IF NOT v_question_ids <@ v_provided_ids THEN
        RAISE EXCEPTION 'MISSING_REQUIRED_ANSWER: nem todas as perguntas obrigatorias foram respondidas';
      END IF;
    END IF;
    
  ELSIF p_transition_answers IS NOT NULL THEN
    -- Fora do escopo R1 (não active→active) mas enviou answers: rejeitar
    RAISE EXCEPTION 'QUESTIONS_NOT_ENABLED: perguntas nao habilitadas para esta transicao (escopo R1: active->active apenas)';
  END IF;

  -- =====================================================
  -- PASSO 7: Inserir histórico de etapa
  -- =====================================================
  
  INSERT INTO opportunity_stage_history (
    company_id, opportunity_id, funnel_id,
    from_stage_id, to_stage_id,
    stage_entered_at, stage_left_at, moved_by, move_type
  ) VALUES (
    v_company_id, p_opportunity_id, p_funnel_id,
    v_actual_from_stage, p_to_stage_id,
    COALESCE(v_entered_at, now()), now(), auth.uid(), 'stage_change'
  )
  RETURNING id INTO v_stage_history_id;

  -- =====================================================
  -- PASSO 8: Inserir respostas (se presentes)
  -- =====================================================
  
  IF p_transition_answers IS NOT NULL AND jsonb_array_length(p_transition_answers) > 0 THEN
    INSERT INTO stage_transition_answers (
      company_id,
      opportunity_id,
      stage_history_id,
      question_id,
      question_label_snapshot,
      value
    )
    SELECT 
      v_company_id,
      p_opportunity_id,
      v_stage_history_id,
      (item->>'question_id')::UUID,
      (SELECT label FROM stage_transition_questions WHERE id = (item->>'question_id')::UUID),
      item->>'value'
    FROM jsonb_array_elements(p_transition_answers) item;
  END IF;

  -- =====================================================
  -- PASSO 9: Atualizar posição atual
  -- =====================================================
  
  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- =====================================================
  -- PASSO 10: Sincronizar status (PRESERVADO)
  -- =====================================================
  
  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities
       SET status            = 'won',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id AND company_id = v_company_id;
    PERFORM close_cycle_if_open(p_opportunity_id, 'opportunity_won', auth.uid());

  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities
       SET status            = 'lost',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id AND company_id = v_company_id;
    PERFORM close_cycle_if_open(p_opportunity_id, 'opportunity_lost', auth.uid());

  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = now()
     WHERE id = p_opportunity_id AND company_id = v_company_id;
    IF NOT COALESCE(v_to_stage_tracks, false) THEN
      PERFORM close_cycle_if_open(
        p_opportunity_id, 'stage_changed_without_tracking', auth.uid()
      );
    END IF;
  END IF;

  -- =====================================================
  -- PASSO 11: Retornar resultado
  -- =====================================================
  
  RETURN QUERY
    SELECT * FROM opportunity_funnel_positions
     WHERE opportunity_id = p_opportunity_id
       AND funnel_id      = p_funnel_id;
END;
$$;

-- =====================================================
-- 6. PRESERVAR ACL EXATA DA VERSÃO VIGENTE
-- =====================================================

-- Remover privilégios herdados de DEFAULT PRIVILEGES
REVOKE ALL ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) FROM anon;

-- Conceder privilégios corretos
GRANT EXECUTE ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) TO service_role;

-- =====================================================
-- 7. ATUALIZAR COMMENT
-- =====================================================

COMMENT ON FUNCTION public.move_opportunity_v2(UUID, UUID, UUID, UUID, INTEGER, JSONB) IS
  'R1: Função PARALELA para validação de transition questions sem afetar produção em banco compartilhado. '
  'move_opportunity ORIGINAL permanece intacta para callers produtivos. '
  'Após validação completa em Dev, foi promovida para produção. '
  'p_transition_answers: [{"question_id": "uuid", "value": "texto"}]. '
  'Tipos suportados: text, number, boolean, select, multi_select, datetime. '
  'multi_select: value é JSON array serializado, canonicalização automática conforme ordem de options. '
  'datetime: value é ISO 8601 com timezone explícito (ex: "2026-09-15T17:30:00Z", "2026-09-15T14:30:00-03:00"), validado por regex + TIMESTAMPTZ. '
  'datetime com create_activity_on_answer=true: deve ser >= NOW() (atividade futura). '
  'datetime comum: qualquer instante válido. '
  'Criação de atividade NÃO é responsabilidade desta RPC (frontend posterior). '
  'Escopo R1: perguntas aplicadas EXCLUSIVAMENTE em active->active + enable_transition_questions=true. '
  'Won/lost/reopen NÃO são afetados por perguntas na R1. '
  'Valida: JSON structure, UUID format, cross-tenant, required completeness, field_type rules. '
  'Preserva comportamento original: history, status sync, close_cycle_if_open. '
  'SECURITY DEFINER: valida multi-tenant e auth internamente (não depende de RLS). '
  'Early return APÓS auth para não vazar dados cross-tenant. '
  'ACL: anon=NONE, authenticated=EXECUTE, service_role=EXECUTE.';
