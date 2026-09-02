-- =====================================================
-- MIGRATION M9: Enforce Required Questions in bulk_move_opportunities (R1 H.1)
-- Data: 02/09/2026 - ETAPA I
-- Objetivo: Adicionar enforcement de required questions em operações bulk
--
-- DEPENDÊNCIAS:
--   - M3 (20260820120000): funnel_stages.enable_transition_questions
--   - M1 (20260820100000): stage_transition_questions
--   - M8 (20260820170000): move_opportunity v1 com enforcement (padrão)
--   - 20260424200000: bulk_move_opportunities_rpc (migration histórica)
--
-- PROBLEMA:
--   Bulk operations podem bypass required questions usando RPC pré-R1
--
-- SOLUÇÃO:
--   Recriar bulk_move_opportunities com enforcement similar ao move_opportunity v1
--
-- REGRA:
--   Se destination stage:
--     - enable_transition_questions = true
--     - possui pergunta ativa com required = true
--     - transição é active → active
--   Então: BLOQUEAR operação bulk completamente (all-or-nothing)
--
-- SEGURANÇA:
--   - service_role NÃO bypassa validação
--   - Operação all-or-nothing: se bloqueia, NENHUMA opportunity move
--   - Mensagem clara para admin fazer movimentações individuais
-- =====================================================

SET search_path = public;

-- =====================================================
-- RECRIAR bulk_move_opportunities COM ENFORCEMENT
-- =====================================================

DROP FUNCTION IF EXISTS public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]);

CREATE FUNCTION public.bulk_move_opportunities(
  p_company_id       UUID,
  p_actor_user_id    UUID,
  p_from_funnel_id   UUID,
  p_from_stage_id    UUID,
  p_to_funnel_id     UUID,
  p_to_stage_id      UUID,
  p_opportunity_ids  UUID[]
)
RETURNS TABLE(
  opportunity_id UUID,
  success        BOOLEAN,
  error_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_to_stage_type       VARCHAR(50);
  v_from_stage_type     VARCHAR(50);
  v_enable_questions    BOOLEAN;
  v_required_count      INTEGER;
BEGIN
  -- -------------------------------------------------------
  -- Passo 1: Validar membership do ator.
  -- -------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM company_users
     WHERE user_id    = p_actor_user_id
       AND company_id = p_company_id
       AND is_active  = true
  ) THEN
    RAISE EXCEPTION 'bulk_move_opportunities: ator não encontrado ou inativo na empresa: %', p_actor_user_id;
  END IF;

  -- -------------------------------------------------------
  -- Passo 2: Validar etapas origem e destino
  -- -------------------------------------------------------
  
  -- Obter tipo da stage de origem
  SELECT stage_type
    INTO v_from_stage_type
    FROM funnel_stages
   WHERE id = p_from_stage_id;

  IF v_from_stage_type IS NULL THEN
    RAISE EXCEPTION 'bulk_move_opportunities: etapa de origem não encontrada: %', p_from_stage_id;
  END IF;

  -- Obter tipo e config da stage de destino
  SELECT stage_type, COALESCE(enable_transition_questions, FALSE)
    INTO v_to_stage_type, v_enable_questions
    FROM funnel_stages
   WHERE id = p_to_stage_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'bulk_move_opportunities: etapa de destino não encontrada: %', p_to_stage_id;
  END IF;

  -- -------------------------------------------------------
  -- Passo 2.5: R1 H.1 ENFORCEMENT DE REQUIRED QUESTIONS
  -- -------------------------------------------------------
  
  -- Validar required questions SOMENTE para active → active
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
        -- BLOQUEADOR: stage tem required questions mas operação bulk não suporta respostas
        RAISE EXCEPTION 'BULK_REQUIRED_QUESTIONS_NOT_ANSWERED: Operação em massa bloqueada. Etapa destino possui % pergunta(s) obrigatória(s). Movimentações individuais com respostas são necessárias.', v_required_count;
      END IF;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Passo 3: Registrar histórico de movimentação.
  -- -------------------------------------------------------
  INSERT INTO opportunity_stage_history (
    company_id, opportunity_id, funnel_id,
    from_stage_id, to_stage_id,
    stage_entered_at, stage_left_at, moved_by, move_type
  )
  SELECT
    p_company_id,
    opp.opp_id,
    p_from_funnel_id,
    p_from_stage_id,
    p_to_stage_id,
    pos.entered_stage_at,
    now(),
    p_actor_user_id,
    'stage_change'
  FROM unnest(p_opportunity_ids) AS opp(opp_id)
  LEFT JOIN opportunity_funnel_positions pos
         ON pos.opportunity_id = opp.opp_id
        AND pos.funnel_id = p_from_funnel_id;

  -- -------------------------------------------------------
  -- Passo 4: Atualizar posições.
  -- -------------------------------------------------------
  UPDATE opportunity_funnel_positions ofp
     SET funnel_id         = p_to_funnel_id,
         stage_id          = p_to_stage_id,
         position_in_stage = 0,
         entered_stage_at  = now()
   WHERE ofp.funnel_id = p_from_funnel_id
     AND ofp.stage_id  = p_from_stage_id
     AND ofp.opportunity_id = ANY(p_opportunity_ids);

  -- -------------------------------------------------------
  -- Passo 5: Atualizar status das oportunidades conforme tipo da etapa de destino.
  -- -------------------------------------------------------
  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities o
       SET status            = 'won',
           closed_at         = COALESCE(o.closed_at, now()),
           actual_close_date = COALESCE(o.actual_close_date, (now())::date),
           updated_at        = now()
     WHERE o.id = ANY(p_opportunity_ids)
       AND o.company_id = p_company_id;

  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities o
       SET status            = 'lost',
           closed_at         = COALESCE(o.closed_at, now()),
           actual_close_date = COALESCE(o.actual_close_date, (now())::date),
           updated_at        = now()
     WHERE o.id = ANY(p_opportunity_ids)
       AND o.company_id = p_company_id;

  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities o
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = now()
     WHERE o.id = ANY(p_opportunity_ids)
       AND o.company_id = p_company_id;
  END IF;

  -- -------------------------------------------------------
  -- Passo 6: Retornar sucesso para cada opportunity movida.
  -- -------------------------------------------------------
  RETURN QUERY
  SELECT opp.opp_id, true, NULL::TEXT
  FROM unnest(p_opportunity_ids) AS opp(opp_id);
END;
$$;

-- =====================================================
-- COMENTÁRIO
-- =====================================================

COMMENT ON FUNCTION bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) IS
  'R1 H.1 M9: Operação bulk com enforcement de required questions. Bloqueia completamente (all-or-nothing) se destination stage tem required questions ativas.';

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- CREATE OR REPLACE preserva grants existentes, mas reforçar explicitamente para clareza
-- Remover privilégios herdados de DEFAULT PRIVILEGES (caso existam)
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM anon;

-- Authenticated pode executar (usuários humanos autenticados)
-- Service_role pode executar (backend APIs via service_role)
GRANT EXECUTE ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) TO service_role;
