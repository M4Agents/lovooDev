-- =====================================================
-- MIGRATION: Atomic Reorder Questions RPC
-- Data: 02/09/2026 - Etapa F.5 Hardening
--
-- RPC atômico para reordenar perguntas
-- All-or-nothing: todos updates ou nenhum
-- =====================================================

CREATE OR REPLACE FUNCTION reorder_stage_transition_questions(
  p_company_id UUID,
  p_funnel_stage_id UUID,
  p_question_order JSONB  -- [{ "id": "uuid", "sort_order": 0 }, ...]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'  -- Prevenir search_path injection attacks
AS $$
DECLARE
  v_item JSONB;
  v_question_id UUID;
  v_sort_order INT;
  v_ids UUID[];
  v_existing_count INT;
  v_unique_count INT;
  v_invalid_stage_count INT;
  v_invalid_company_count INT;
  v_updated_count INT := 0;
BEGIN
  -- Validação 1: p_question_order deve ser array
  IF jsonb_typeof(p_question_order) != 'array' THEN
    RAISE EXCEPTION 'INVALID_INPUT: question_order deve ser um array'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validação 2: não pode ser vazio
  IF jsonb_array_length(p_question_order) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: question_order não pode ser vazio'
      USING ERRCODE = 'P0001';
  END IF;

  -- Extrair IDs para validação
  SELECT array_agg((item->>'id')::UUID)
  INTO v_ids
  FROM jsonb_array_elements(p_question_order) AS item;

  -- Validação 3: verificar IDs duplicados
  SELECT COUNT(DISTINCT id_elem)
  INTO v_unique_count
  FROM unnest(v_ids) AS id_elem;

  IF v_unique_count != array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'DUPLICATE_QUESTION_ID: question_order contém IDs duplicados'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validação 4: todas perguntas devem existir
  SELECT COUNT(*)
  INTO v_existing_count
  FROM stage_transition_questions
  WHERE id = ANY(v_ids);

  IF v_existing_count != array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'UNKNOWN_QUESTION: Uma ou mais perguntas não foram encontradas'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validação 5: todas devem pertencer à mesma stage
  SELECT COUNT(*)
  INTO v_invalid_stage_count
  FROM stage_transition_questions
  WHERE id = ANY(v_ids)
    AND funnel_stage_id != p_funnel_stage_id;

  IF v_invalid_stage_count > 0 THEN
    RAISE EXCEPTION 'INVALID_STAGE: Uma ou mais perguntas não pertencem à etapa especificada'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validação 6: todas devem pertencer à mesma company
  SELECT COUNT(*)
  INTO v_invalid_company_count
  FROM stage_transition_questions
  WHERE id = ANY(v_ids)
    AND company_id != p_company_id;

  IF v_invalid_company_count > 0 THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Uma ou mais perguntas pertencem a outra empresa'
      USING ERRCODE = 'P0001';
  END IF;

  -- Advisory lock para prevenir reorders concorrentes na mesma stage
  PERFORM pg_advisory_xact_lock(
    (hashtext(p_company_id::TEXT) # hashtext(p_funnel_stage_id::TEXT))::BIGINT
  );

  -- Atualizar sort_order de cada pergunta (all-or-nothing dentro desta transaction)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_question_order)
  LOOP
    v_question_id := (v_item->>'id')::UUID;
    v_sort_order := (v_item->>'sort_order')::INT;

    -- UPDATE atômico
    UPDATE stage_transition_questions
    SET sort_order = v_sort_order
    WHERE id = v_question_id
      AND company_id = p_company_id
      AND funnel_stage_id = p_funnel_stage_id;

    -- Verificar se o UPDATE afetou 1 linha
    IF NOT FOUND THEN
      RAISE EXCEPTION 'UPDATE_FAILED: Erro ao atualizar pergunta %', v_question_id
        USING ERRCODE = 'P0001';
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  -- Retornar sucesso
  RETURN jsonb_build_object(
    'ok', true,
    'updated_count', v_updated_count
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Qualquer erro faz ROLLBACK automático da transaction
    RAISE;
END;
$$;

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- Remover privilégios herdados de DEFAULT PRIVILEGES
REVOKE ALL ON FUNCTION reorder_stage_transition_questions(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION reorder_stage_transition_questions(UUID, UUID, JSONB) FROM anon;

-- Authenticated pode executar (authorization é feita no endpoint backend)
-- Service_role pode executar (backend APIs)
GRANT EXECUTE ON FUNCTION reorder_stage_transition_questions(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_stage_transition_questions(UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION reorder_stage_transition_questions IS
  'R1 M6: Reordena perguntas de transição atomicamente. '
  'Validação: IDs únicos, mesma stage, mesma company. All-or-nothing com rollback automático. '
  'SECURITY DEFINER: authorization feita antes da chamada no backend. '
  'ACL: anon=NONE, authenticated=EXECUTE, service_role=EXECUTE.';
