-- =====================================================
-- MIGRATION M9.2: Atomicidade Semântica em bulk_move_opportunities
-- Data: 07/09/2026
-- Versão interna: M9.2 (after M9.1 = 20260820180100)
--
-- PROBLEMA CORRIGIDO:
--   Quando p_opportunity_ids IS NOT NULL, o Passo 1 original
--   filtrava silenciosamente IDs não encontrados na from_stage,
--   podendo gerar movimento parcial sem sinalização de erro:
--
--     10 IDs enviados → 1 movido concorrentemente entre T1 e T2
--     → RPC encontra 9 → move 9 → retorna moved_count = 9
--     → Violação do contrato ALL-OR-NOTHING.
--
-- SOLUÇÃO IMPLEMENTADA:
--
--   1. FOR UPDATE OF ofp (caminho explícito):
--      O SELECT do Passo 1 para IDs explícitos adquire lock
--      nas rows de opportunity_funnel_positions ANTES de qualquer escrita.
--      Transações concorrentes que tentarem modificar as mesmas rows
--      ficam bloqueadas até o commit/rollback desta função.
--      Lock order: ORDER BY ofp.opportunity_id — consistente para evitar deadlock.
--      Apenas o caminho p_opportunity_ids IS NOT NULL usa FOR UPDATE.
--      O caminho NULL (move todos) preserva comportamento original sem lock.
--
--   2. Unique count check ANTES de qualquer INSERT/UPDATE:
--      v_requested_unique = COUNT(DISTINCT) de p_opportunity_ids.
--      Se v_count != v_requested_unique: RAISE EXCEPTION 'PARTIAL_MOVE_PREVENTED: ...'
--      O RAISE EXCEPTION aborta a transação → rollback implícito de tudo.
--      Garante atomicidade semântica: ou move TODOS os IDs únicos ou NENHUM.
--
--   3. Duplicatas em p_opportunity_ids tratadas corretamente:
--      Comparação usa COUNT(DISTINCT), não cardinality bruto.
--      5 IDs com 1 duplicado → v_requested_unique = 4 (não 5).
--      Evita falso PARTIAL_MOVE_PREVENTED por duplicatas do caller.
--
-- CONTRATOS PRESERVADOS:
--   - Assinatura pública inalterada (DROP + CREATE para substituição)
--   - p_opportunity_ids IS NULL: comportamento original intacto (sem lock)
--   - RETURNS TABLE (moved_count INTEGER, moved_ids UUID[])
--   - SECURITY DEFINER + SET search_path = 'public'
--   - Enforcement R1 H.1 (required questions) — preservado na íntegra
--   - Passos 3-5: histórico, posições, status — idênticos ao M9.1
--   - ACL: REVOKE de PUBLIC/anon/authenticated, GRANT apenas service_role
--
-- IMPACTO EM CALLERS:
--   - api/funnel/bulk-move-by-ids.ts:
--       MELHORA: partial success impossível; concurrent race → 409 Conflict.
--   - api/funnel/bulk-move-opportunities/index.js:
--       IMPACTO ACEITO: IDs resolvidos milissegundos antes. Em race extremamente
--       raro, 500 ao invés de sucesso parcial silencioso. Comportamento mais correto.
--   - p_opportunity_ids = NULL (BulkMoveOpportunitiesModal):
--       SEM impacto — caminho separado, sem lock, sem count check.
-- =====================================================

SET search_path = public;

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
  v_ids                   UUID[];
  v_count                 INTEGER;
  v_to_stage_type         VARCHAR(50);
  v_from_stage_type       VARCHAR(50);
  v_enable_questions      BOOLEAN;
  v_required_count        INTEGER;
  v_requested_unique      INTEGER;   -- contagem de IDs únicos quando explicitamente fornecidos
BEGIN

  -- -------------------------------------------------------
  -- Passo 0: Pré-computar unique count (apenas quando IDs explícitos).
  -- Usa COUNT(DISTINCT) para ser robusto contra duplicatas no array.
  -- Executado ANTES do SELECT para comparação posterior.
  -- -------------------------------------------------------
  IF p_opportunity_ids IS NOT NULL THEN
    SELECT count(DISTINCT elem)::INTEGER
      INTO v_requested_unique
      FROM unnest(p_opportunity_ids) AS elem;

    -- Array vazio: no-op seguro. Endpoint deve bloquear antes, mas defensive.
    IF v_requested_unique = 0 THEN
      RETURN QUERY SELECT 0::INTEGER, ARRAY[]::UUID[];
      RETURN;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Passo 1: Resolver lista real de IDs válidos.
  --
  -- Caminho A — IDs explícitos (p_opportunity_ids IS NOT NULL):
  --   Subquery com FOR UPDATE OF ofp adquire lock pessimista nas rows
  --   de opportunity_funnel_positions antes de qualquer escrita.
  --   Garante que o conjunto validado permanece estável entre leitura
  --   e atualização, mesmo com concorrência.
  --   Lock order: ORDER BY ofp.opportunity_id previne deadlock
  --   em operações paralelas sobre conjuntos disjuntos.
  --
  -- Caminho B — mover todos (p_opportunity_ids IS NULL):
  --   Sem lock — preserva comportamento original de M9.1.
  -- -------------------------------------------------------
  IF p_opportunity_ids IS NOT NULL THEN

    -- ── Caminho A: IDs explícitos + FOR UPDATE ───────────────────
    SELECT
      array_agg(t.opportunity_id ORDER BY t.opportunity_id),
      COUNT(*)
    INTO v_ids, v_count
    FROM (
      SELECT ofp.opportunity_id
      FROM opportunity_funnel_positions ofp
      JOIN opportunities o ON o.id = ofp.opportunity_id
      WHERE ofp.funnel_id  = p_from_funnel_id
        AND ofp.stage_id   = p_from_stage_id
        AND o.company_id   = p_company_id
        AND ofp.opportunity_id = ANY(p_opportunity_ids)
      ORDER BY ofp.opportunity_id   -- ordem consistente de lock
      FOR UPDATE OF ofp
    ) t;

    -- ── Count check: ALL OR NOTHING ──────────────────────────────
    -- Executado ANTES de qualquer INSERT/UPDATE.
    -- v_count IS DISTINCT FROM v_requested_unique cobre também
    -- o caso v_count = NULL (agregação vazia).
    -- RAISE EXCEPTION aborta a transação → rollback implícito total.
    IF v_count IS DISTINCT FROM v_requested_unique THEN
      RAISE EXCEPTION
        'PARTIAL_MOVE_PREVENTED: % de % oportunidades únicas encontradas na stage de origem. '
        'Operação cancelada para garantir consistência.',
        COALESCE(v_count, 0), v_requested_unique;
    END IF;

    -- Defensivo: v_count == v_requested_unique > 0, mas v_ids pode ser NULL
    -- somente se array_agg retornar NULL em count=0 (impossível aqui, mas seguro)
    IF v_ids IS NULL THEN
      RETURN QUERY SELECT 0::INTEGER, ARRAY[]::UUID[];
      RETURN;
    END IF;

  ELSE

    -- ── Caminho B: mover todos (NULL) — comportamento M9.1 original ─
    SELECT
      array_agg(ofp.opportunity_id ORDER BY ofp.opportunity_id),
      COUNT(*)
    INTO v_ids, v_count
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o ON o.id = ofp.opportunity_id
    WHERE ofp.funnel_id  = p_from_funnel_id
      AND ofp.stage_id   = p_from_stage_id
      AND o.company_id   = p_company_id;

    IF v_count = 0 OR v_ids IS NULL THEN
      RETURN QUERY SELECT 0::INTEGER, ARRAY[]::UUID[];
      RETURN;
    END IF;

  END IF;

  -- -------------------------------------------------------
  -- Passo 2: Validar etapas origem e destino.
  -- Idêntico ao M9.1.
  -- -------------------------------------------------------
  SELECT stage_type
    INTO v_from_stage_type
    FROM funnel_stages
   WHERE id = p_from_stage_id;

  IF v_from_stage_type IS NULL THEN
    RAISE EXCEPTION 'bulk_move_opportunities: etapa de origem não encontrada: %', p_from_stage_id;
  END IF;

  SELECT stage_type, COALESCE(enable_transition_questions, FALSE)
    INTO v_to_stage_type, v_enable_questions
    FROM funnel_stages
   WHERE id = p_to_stage_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'bulk_move_opportunities: etapa de destino não encontrada: %', p_to_stage_id;
  END IF;

  -- -------------------------------------------------------
  -- Passo 2.5: R1 H.1 ENFORCEMENT DE REQUIRED QUESTIONS.
  -- Idêntico ao M9.1 — preservado na íntegra.
  -- -------------------------------------------------------
  IF v_from_stage_type = 'active' AND v_to_stage_type = 'active' THEN
    IF v_enable_questions = TRUE THEN
      SELECT COUNT(*)
        INTO v_required_count
        FROM stage_transition_questions
       WHERE funnel_stage_id = p_to_stage_id
         AND active   = TRUE
         AND required = TRUE;

      IF v_required_count > 0 THEN
        RAISE EXCEPTION
          'BULK_REQUIRED_QUESTIONS_NOT_ANSWERED: Operação em massa bloqueada. '
          'Etapa destino possui % pergunta(s) obrigatória(s). '
          'Movimentações individuais com respostas são necessárias.',
          v_required_count;
      END IF;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Passo 3: Registrar histórico de movimentação.
  -- Idêntico ao M9.1.
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
  -- Passo 4: Atualizar posições.
  -- Idêntico ao M9.1.
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
  -- Passo 5: Sincronizar status em opportunities.
  -- Idêntico ao M9.1.
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
  -- Passo 6: Retornar contagem e lista — contrato legado.
  -- Idêntico ao M9.1.
  -- -------------------------------------------------------
  RETURN QUERY SELECT v_count::INTEGER, v_ids;
END;
$$;

-- =====================================================
-- COMENTÁRIO
-- =====================================================

COMMENT ON FUNCTION bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) IS
  'M9.2: Move oportunidades em massa entre etapas/funis. '
  'p_opportunity_ids IS NOT NULL: FOR UPDATE + count check garantem atomicidade semântica '
  '(PARTIAL_MOVE_PREVENTED se found_unique != requested_unique). '
  'p_opportunity_ids IS NULL: move todos da stage de origem (comportamento M9.1 preservado). '
  'Enforcement R1 H.1: bloqueia active→active quando destination stage tem required questions ativas. '
  'Passos 3-5 idênticos ao M9.1: histórico, posições, status.';

-- =====================================================
-- ACL — idêntica ao M9.1
-- =====================================================

REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) TO service_role;
