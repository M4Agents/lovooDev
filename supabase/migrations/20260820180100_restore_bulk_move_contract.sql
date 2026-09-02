-- =====================================================
-- MIGRATION M9.1: Restore bulk_move_opportunities Contract (R1 H.1 FIX-FORWARD)
-- Data: 02/09/2026 - ETAPA J.11
-- Objetivo: Restaurar contrato legado preservando enforcement R1
--
-- DEPENDÊNCIAS:
--   - M9 (20260820180000): enforcement implementado mas contrato quebrado
--   - 20260424200000: contrato original (moved_count, moved_ids)
--
-- PROBLEMA M9:
--   Return type alterado de TABLE(moved_count, moved_ids) para
--   TABLE(opportunity_id, success, error_message) quebrou callers:
--     - api/funnel/bulk-move-opportunities/index.js
--     - src/components/SalesFunnel/BulkMoveOpportunitiesModal.tsx
--
-- SOLUÇÃO M9.1:
--   Restaurar exatamente o contrato original (20260424200000) MAS
--   manter enforcement R1 de required questions (M9 linhas 100-119) E
--   corrigir ACL para prevenir bypass da API backend
--
-- CONTRATO RESTAURADO:
--   RETURNS TABLE (moved_count INTEGER, moved_ids UUID[])
--   p_opportunity_ids UUID[] DEFAULT NULL (comportamento original)
--
-- ENFORCEMENT R1 PRESERVADO:
--   - Bloqueia active → active quando destination stage tem required questions
--   - service_role NÃO bypassa validação
--   - All-or-nothing: EXCEPTION antes de qualquer escrita
--   - Mensagem orienta para movimentações individuais
--
-- ACL CORRIGIDA (HARDENING):
--   - authenticated REVOKED (era GRANT na M9 e original)
--   - Apenas service_role pode executar (design arquitetural)
--   - API backend realiza TODA autorização (JWT + membership + role)
--   - RPC não possui autorização interna (confia em service_role caller)
-- =====================================================

SET search_path = public;

-- =====================================================
-- RECRIAR bulk_move_opportunities COM CONTRATO LEGADO + ENFORCEMENT R1
-- =====================================================

DROP FUNCTION IF EXISTS public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]);

CREATE FUNCTION public.bulk_move_opportunities(
  p_company_id       UUID,
  p_actor_user_id    UUID,
  p_from_funnel_id   UUID,
  p_from_stage_id    UUID,
  p_to_funnel_id     UUID,
  p_to_stage_id      UUID,
  p_opportunity_ids  UUID[] DEFAULT NULL
)
RETURNS TABLE (moved_count INTEGER, moved_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_ids                 UUID[];
  v_count               INTEGER;
  v_to_stage_type       VARCHAR(50);
  v_from_stage_type     VARCHAR(50);
  v_enable_questions    BOOLEAN;
  v_required_count      INTEGER;
BEGIN
  -- -------------------------------------------------------
  -- Passo 1: Resolver lista real de IDs válidos.
  -- Valida company_id, funnel_id e stage_id no banco.
  -- Filtra somente IDs do array recebido quando fornecido.
  -- Se p_opportunity_ids IS NULL, move TODOS da etapa origem.
  -- -------------------------------------------------------
  SELECT
    array_agg(ofp.opportunity_id ORDER BY ofp.opportunity_id),
    COUNT(*)
  INTO v_ids, v_count
  FROM opportunity_funnel_positions ofp
  JOIN opportunities o ON o.id = ofp.opportunity_id
  WHERE ofp.funnel_id  = p_from_funnel_id
    AND ofp.stage_id   = p_from_stage_id
    AND o.company_id   = p_company_id
    AND (p_opportunity_ids IS NULL OR ofp.opportunity_id = ANY(p_opportunity_ids));

  IF v_count = 0 OR v_ids IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, ARRAY[]::UUID[];
    RETURN;
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
  -- Captura entered_stage_at atual antes de sobrescrever.
  -- -------------------------------------------------------
  INSERT INTO opportunity_stage_history (
    company_id,
    opportunity_id,
    funnel_id,
    from_stage_id,
    to_stage_id,
    stage_entered_at,
    stage_left_at,
    moved_by,
    move_type
  )
  SELECT
    p_company_id,
    ofp.opportunity_id,
    p_to_funnel_id,
    p_from_stage_id,
    p_to_stage_id,
    COALESCE(ofp.entered_stage_at, NOW()),
    NOW(),
    p_actor_user_id,
    'stage_change'
  FROM opportunity_funnel_positions ofp
  WHERE ofp.opportunity_id = ANY(v_ids)
    AND ofp.funnel_id      = p_from_funnel_id;

  -- -------------------------------------------------------
  -- Passo 4: Atualizar posições (suporta troca de funil).
  -- position_in_stage = 0: padrão para movimentações
  -- programáticas, igual ao comportamento de crmActions.
  -- -------------------------------------------------------
  UPDATE opportunity_funnel_positions ofp
     SET funnel_id         = p_to_funnel_id,
         stage_id          = p_to_stage_id,
         position_in_stage = 0,
         entered_stage_at  = NOW(),
         updated_at        = NOW()
   WHERE ofp.opportunity_id = ANY(v_ids)
     AND ofp.funnel_id      = p_from_funnel_id;

  -- -------------------------------------------------------
  -- Passo 5: Sincronizar status em opportunities conforme
  -- stage_type da etapa de destino — replica move_opportunity.
  -- -------------------------------------------------------
  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities o
       SET status            = 'won',
           closed_at         = COALESCE(o.closed_at, NOW()),
           actual_close_date = COALESCE(o.actual_close_date, NOW()::date),
           updated_at        = NOW()
     WHERE o.id         = ANY(v_ids)
       AND o.company_id = p_company_id;

  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities o
       SET status            = 'lost',
           closed_at         = COALESCE(o.closed_at, NOW()),
           actual_close_date = COALESCE(o.actual_close_date, NOW()::date),
           updated_at        = NOW()
     WHERE o.id         = ANY(v_ids)
       AND o.company_id = p_company_id;

  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities o
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = NOW()
     WHERE o.id         = ANY(v_ids)
       AND o.company_id = p_company_id;
  END IF;

  -- -------------------------------------------------------
  -- Passo 6: Retornar contagem e lista agregada (CONTRATO LEGADO).
  -- -------------------------------------------------------
  RETURN QUERY SELECT v_count::INTEGER, v_ids;
END;
$$;

-- =====================================================
-- COMENTÁRIO
-- =====================================================

COMMENT ON FUNCTION bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) IS
  'R1 H.1 M9.1: Move oportunidades em massa entre etapas/funis. Replica exatamente move_opportunity: histórico, status, campos de fechamento. position_in_stage=0 para movimentações programáticas. Enforcement R1: bloqueia active→active quando destination stage tem required questions ativas.';

-- =====================================================
-- GRANTS / ACL
-- =====================================================

-- Remover privilégios herdados de DEFAULT PRIVILEGES (caso existam)
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM authenticated;

-- Service_role pode executar (backend APIs com autorização completa)
-- Authenticated NÃO pode executar (previne bypass da API backend)
GRANT EXECUTE ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) TO service_role;
