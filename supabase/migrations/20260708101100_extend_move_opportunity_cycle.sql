-- Motor de Ciclos: extensão do move_opportunity para integrar ciclos de contato
-- Adiciona chamadas a close_cycle_if_open ao mover oportunidade para etapa
-- sem rastreamento ou para estágios won/lost

CREATE OR REPLACE FUNCTION public.move_opportunity(
  p_opportunity_id  UUID,
  p_funnel_id       UUID,
  p_from_stage_id   UUID,
  p_to_stage_id     UUID,
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
  v_to_stage_type       VARCHAR(50);
  v_to_stage_tracks     BOOLEAN;
BEGIN
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

  SELECT stage_type, track_contact_attempts
    INTO v_to_stage_type, v_to_stage_tracks
    FROM funnel_stages
   WHERE id        = p_to_stage_id
     AND funnel_id = p_funnel_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'etapa de destino invalida ou funil incompativel: stage_id=% funnel_id=%',
      p_to_stage_id, p_funnel_id;
  END IF;

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
