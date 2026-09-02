-- =====================================================
-- MIGRATION: Enforce Required Questions in move_opportunity v1 (R1 H.1)
-- Data: 02/09/2026 - ETAPA H.1
-- Objetivo: Bloquear bypass de required questions via callers legados
--
-- PROBLEMA:
--   Callers não-humanos (automations, agents, bulk) usam move_opportunity v1
--   que não valida perguntas R1, permitindo bypass silencioso de required
--
-- SOLUÇÃO:
--   Adicionar validação em move_opportunity v1 ANTES de permitir movimento
--   para stages com enable_transition_questions=true E required questions
--
-- REGRA:
--   Se destination stage:
--     - enable_transition_questions = true
--     - possui pergunta ativa com required = true
--   Então: movimento sem respostas (p_transition_answers NULL) é BLOQUEADO
--
-- COMPATIBILIDADE:
--   - Preserva comportamento quando feature disabled
--   - Preserva comportamento quando não há required questions
--   - Preserva comportamento won/lost/reopen (R1 só active→active)
--   - NÃO adiciona flag de bypass controlável pelo caller
--
-- SEGURANÇA:
--   - service_role NÃO bypassa validação
--   - Automations/agents bloqueados se required exists
--   - Enforcement autoritativo no banco
-- =====================================================

SET search_path = public;

-- =====================================================
-- ALTERAR move_opportunity v1 COM ENFORCEMENT
-- =====================================================

CREATE OR REPLACE FUNCTION public.move_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_from_stage_id     UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER
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
  v_required_count      INTEGER;
BEGIN
  -- ===================================================
  -- VALIDAÇÕES EXISTENTES (mantidas)
  -- ===================================================
  
  SELECT stage_id, entered_stage_at
    INTO v_actual_from_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'posicao nao encontrada para opportunity_id=% funnel_id=%',
      p_opportunity_id, p_funnel_id;
  END IF;

  IF v_actual_from_stage = p_to_stage_id THEN
    RETURN QUERY
      SELECT * FROM opportunity_funnel_positions
       WHERE opportunity_id = p_opportunity_id
         AND funnel_id      = p_funnel_id;
    RETURN;
  END IF;

  SELECT company_id
    INTO v_company_id
    FROM opportunities
   WHERE id = p_opportunity_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'oportunidade nao encontrada: %', p_opportunity_id;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT auth_user_can_access_funnel(v_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario nao tem acesso ao funil %', p_funnel_id;
  END IF;

  -- ===================================================
  -- R1 H.1: ENFORCEMENT DE REQUIRED QUESTIONS
  -- ===================================================
  
  -- Obter tipo da stage de origem
  SELECT stage_type
    INTO v_from_stage_type
    FROM funnel_stages
   WHERE id = v_actual_from_stage;

  -- Obter tipo e config da stage de destino
  SELECT stage_type, COALESCE(enable_transition_questions, FALSE)
    INTO v_to_stage_type, v_enable_questions
    FROM funnel_stages
   WHERE id        = p_to_stage_id
     AND funnel_id = p_funnel_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'etapa de destino invalida ou funil incompativel: stage_id=% funnel_id=%',
      p_to_stage_id, p_funnel_id;
  END IF;

  -- R1: Validar required questions SOMENTE para active → active
  -- (won/lost/reopen não afetados)
  IF v_from_stage_type = 'active' AND v_to_stage_type = 'active' THEN
    IF v_enable_questions = TRUE THEN
      -- Contar perguntas ativas required
      SELECT COUNT(*)
        INTO v_required_count
        FROM stage_transition_questions
       WHERE funnel_stage_id = p_to_stage_id
         AND active = TRUE
         AND required = TRUE;

      IF v_required_count > 0 THEN
        -- BLOQUEADOR: stage tem required questions mas caller usa v1 sem respostas
        RAISE EXCEPTION 'REQUIRED_QUESTIONS_NOT_ANSWERED: Etapa destino possui % pergunta(s) obrigatória(s) não respondidas. Use move_opportunity_v2 com respostas ou contate o administrador para ajustar a configuração da etapa.', v_required_count;
      END IF;
    END IF;
  END IF;

  -- ===================================================
  -- LÓGICA ORIGINAL (mantida)
  -- ===================================================

  INSERT INTO opportunity_stage_history (
    company_id, opportunity_id, funnel_id,
    from_stage_id, to_stage_id,
    stage_entered_at, stage_left_at, moved_by, move_type
  ) VALUES (
    v_company_id, p_opportunity_id, p_funnel_id,
    v_actual_from_stage, p_to_stage_id,
    COALESCE(v_entered_at, now()), now(), auth.uid(), 'stage_change'
  );

  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  SELECT track_contact_attempts
    INTO v_to_stage_tracks
    FROM funnel_stages
   WHERE id = p_to_stage_id;

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

  RETURN QUERY
    SELECT * FROM opportunity_funnel_positions
     WHERE opportunity_id = p_opportunity_id
       AND funnel_id      = p_funnel_id;
END;
$$;

-- =====================================================
-- COMENTÁRIO
-- =====================================================

COMMENT ON FUNCTION move_opportunity(UUID, UUID, UUID, UUID, INTEGER) IS
  'R1 H.1: Bloqueador de bypass de required questions. Callers v1 (automations, agents, bulk) não podem mover para stages com required questions ativas. Use move_opportunity_v2 com respostas.';

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- CREATE OR REPLACE preserva grants existentes, mas reforçar explicitamente para clareza
-- Remover privilégios herdados de DEFAULT PRIVILEGES (caso existam)
REVOKE ALL ON FUNCTION public.move_opportunity(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_opportunity(UUID, UUID, UUID, UUID, INTEGER) FROM anon;

-- Authenticated pode executar (usuários humanos autenticados)
-- Service_role pode executar (backend APIs via service_role)
GRANT EXECUTE ON FUNCTION public.move_opportunity(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_opportunity(UUID, UUID, UUID, UUID, INTEGER) TO service_role;
