-- =====================================================
-- MIGRATION: move_opportunity — sincronizar opportunities.status
-- com funnel_stages.stage_type da etapa de destino
--
-- Problema: move_opportunity só atualizava opportunity_funnel_positions.
-- O card aparecia em coluna Ganho/Perda mas opportunities.status
-- permanecia 'open' se o fluxo não passasse por close_opportunity.
--
-- Correção:
--   1) Após mover a posição, ajustar status (e campos de fechamento) conforme
--      stage_type da etapa de destino (active → open; won/lost → won/lost).
--   2) UPDATE pontual em oportunidades já inconsistentes (etapa terminal + open).
-- =====================================================

CREATE OR REPLACE FUNCTION move_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_from_stage_id     UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER
)
RETURNS SETOF opportunity_funnel_positions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id          UUID;
  v_actual_from_stage   UUID;
  v_entered_at          TIMESTAMPTZ;
  v_to_stage_type       VARCHAR(50);
BEGIN
  SELECT stage_id, entered_stage_at
    INTO v_actual_from_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'posição não encontrada para opportunity_id=% funnel_id=%',
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
    RAISE EXCEPTION 'oportunidade não encontrada: %', p_opportunity_id;
  END IF;

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
  ) VALUES (
    v_company_id,
    p_opportunity_id,
    p_funnel_id,
    v_actual_from_stage,
    p_to_stage_id,
    COALESCE(v_entered_at, now()),
    now(),
    auth.uid(),
    'stage_change'
  );

  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- Tipo da etapa de destino (mesmo funil)
  SELECT stage_type
    INTO v_to_stage_type
    FROM funnel_stages
   WHERE id = p_to_stage_id
     AND funnel_id = p_funnel_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'etapa de destino inválida ou funil incompatível: stage_id=% funnel_id=%',
      p_to_stage_id, p_funnel_id;
  END IF;

  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities
       SET status            = 'won',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities
       SET status            = 'lost',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  END IF;

  RETURN QUERY
    SELECT * FROM opportunity_funnel_positions
     WHERE opportunity_id = p_opportunity_id
       AND funnel_id      = p_funnel_id;
END;
$$;

COMMENT ON FUNCTION move_opportunity(UUID, UUID, UUID, UUID, INTEGER) IS
  'Move oportunidade entre etapas; sincroniza opportunities.status com stage_type da etapa de destino.';

-- Corrigir linhas já gravadas: etapa ganho/perda mas status ainda open
UPDATE opportunities o
   SET status            = x.stage_type,
       closed_at         = COALESCE(o.closed_at, now()),
       actual_close_date = COALESCE(o.actual_close_date, (now())::date),
       updated_at        = now()
  FROM (
    SELECT DISTINCT ON (ofp.opportunity_id)
      ofp.opportunity_id,
      fs.stage_type::text AS stage_type
    FROM opportunity_funnel_positions ofp
    JOIN funnel_stages fs
      ON fs.id = ofp.stage_id
     AND fs.funnel_id = ofp.funnel_id
   WHERE fs.stage_type IN ('won', 'lost')
   ORDER BY ofp.opportunity_id, ofp.entered_stage_at DESC NULLS LAST
  ) x
 WHERE o.id = x.opportunity_id
   AND o.status = 'open';
