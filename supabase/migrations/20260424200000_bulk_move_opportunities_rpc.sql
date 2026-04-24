-- =====================================================
-- MIGRATION: bulk_move_opportunities
-- Move um conjunto de oportunidades em massa para outra
-- etapa (e opcionalmente outro funil).
--
-- Replica exatamente a lógica de move_opportunity:
--   • INSERT em opportunity_stage_history
--   • UPDATE opportunity_funnel_positions (funnel_id, stage_id, position_in_stage, entered_stage_at)
--   • UPDATE opportunities.status / closed_at / actual_close_date / loss_reason
--     conforme stage_type da etapa de destino
--
-- Diferenças em relação ao individual:
--   • Aceita p_actor_user_id (backend com service_role; não usa auth.uid())
--   • Aceita p_opportunity_ids = NULL → move TODOS da etapa origem
--   • Suporta troca de funil (p_from_funnel_id ≠ p_to_funnel_id)
--   • position_in_stage = 0 para todos (programático, sem ordenação manual)
--   • Retorna moved_count e moved_ids para logging
--
-- Segurança:
--   • Revalida company_id em CADA oportunidade antes de mover
--   • Nunca confia nos IDs recebidos sem checar o banco
-- =====================================================

CREATE OR REPLACE FUNCTION public.bulk_move_opportunities(
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
SET search_path = public
AS $$
DECLARE
  v_ids            UUID[];
  v_count          INTEGER;
  v_to_stage_type  VARCHAR(50);
BEGIN
  -- -------------------------------------------------------
  -- Passo 1: Resolver lista real de IDs válidos.
  -- Valida company_id, funnel_id e stage_id no banco.
  -- Filtra somente IDs do array recebido quando fornecido.
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
  -- Passo 2: Validar etapa de destino.
  -- -------------------------------------------------------
  SELECT stage_type
    INTO v_to_stage_type
    FROM funnel_stages
   WHERE id = p_to_stage_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'bulk_move_opportunities: etapa de destino não encontrada: %', p_to_stage_id;
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
  UPDATE opportunity_funnel_positions
     SET funnel_id         = p_to_funnel_id,
         stage_id          = p_to_stage_id,
         position_in_stage = 0,
         entered_stage_at  = NOW(),
         updated_at        = NOW()
   WHERE opportunity_id = ANY(v_ids)
     AND funnel_id      = p_from_funnel_id;

  -- -------------------------------------------------------
  -- Passo 5: Sincronizar status em opportunities conforme
  -- stage_type da etapa de destino — replica move_opportunity.
  -- -------------------------------------------------------
  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities
       SET status            = 'won',
           closed_at         = COALESCE(closed_at, NOW()),
           actual_close_date = COALESCE(actual_close_date, NOW()::date),
           updated_at        = NOW()
     WHERE id         = ANY(v_ids)
       AND company_id = p_company_id;

  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities
       SET status            = 'lost',
           closed_at         = COALESCE(closed_at, NOW()),
           actual_close_date = COALESCE(actual_close_date, NOW()::date),
           updated_at        = NOW()
     WHERE id         = ANY(v_ids)
       AND company_id = p_company_id;

  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = NOW()
     WHERE id         = ANY(v_ids)
       AND company_id = p_company_id;
  END IF;

  RETURN QUERY SELECT v_count::INTEGER, v_ids;
END;
$$;

COMMENT ON FUNCTION public.bulk_move_opportunities(UUID, UUID, UUID, UUID, UUID, UUID, UUID[]) IS
  'Move oportunidades em massa entre etapas/funis. Replica exatamente move_opportunity: histórico, status, campos de fechamento. position_in_stage=0 para movimentações programáticas.';
