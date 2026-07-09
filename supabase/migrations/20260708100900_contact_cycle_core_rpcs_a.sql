-- Motor de Ciclos: RPCs core parte A — abertura e fechamento de ciclos
-- close_cycle_if_open: helper interno reutilizável pelos demais RPCs
-- open_contact_cycle / close_contact_cycle: pontos de entrada públicos

-- 1. Helper interno: fecha ciclo aberto se existir (sem expor diretamente)
CREATE OR REPLACE FUNCTION public.close_cycle_if_open(
  p_opportunity_id UUID,
  p_close_reason   TEXT,
  p_closed_by      UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_cycle_id    UUID;
  v_company_id  UUID;
  v_config      company_contact_cycle_config%ROWTYPE;
  v_eligible_at TIMESTAMPTZ;
BEGIN
  -- 1. Verificar se existe ciclo aberto
  SELECT cac.id, cac.company_id
    INTO v_cycle_id, v_company_id
    FROM contact_attempt_cycles cac
   WHERE cac.opportunity_id = p_opportunity_id
     AND cac.status         = 'open'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Fechar o ciclo
  UPDATE contact_attempt_cycles
     SET status       = 'closed',
         closed_at    = now(),
         closed_by    = p_closed_by,
         close_reason = p_close_reason
   WHERE id = v_cycle_id;

  -- 3. Calcular eligible_for_new_cycle_at conforme regra da empresa
  SELECT * INTO v_config
    FROM company_contact_cycle_config
   WHERE company_id = v_company_id
     AND enabled    = true;

  IF FOUND THEN
    CASE v_config.eligibility_rule
      WHEN 'hours' THEN
        v_eligible_at := now() + (v_config.eligibility_hours || ' hours')::INTERVAL;
      WHEN 'day_change' THEN
        v_eligible_at := date_trunc('day', now() + INTERVAL '1 day');
      WHEN 'both' THEN
        v_eligible_at := GREATEST(
          now() + (v_config.eligibility_hours || ' hours')::INTERVAL,
          date_trunc('day', now() + INTERVAL '1 day')
        );
      ELSE
        v_eligible_at := NULL;
    END CASE;
  END IF;

  -- 4. Atualizar campos derivados em opportunity_funnel_positions
  UPDATE opportunity_funnel_positions
     SET contact_attempts_state    = CASE
                                       WHEN v_eligible_at IS NOT NULL THEN 'waiting'
                                       ELSE 'none'
                                     END,
         current_contact_cycle_id  = NULL,
         contact_cycle_opened_at   = NULL,
         last_cycle_close_reason   = p_close_reason,
         eligible_for_new_cycle_at = v_eligible_at
   WHERE opportunity_id = p_opportunity_id;

  -- 5. Registrar evento na timeline
  INSERT INTO opportunity_timeline_events (
    company_id, opportunity_id, event_type, actor_id, metadata
  ) VALUES (
    v_company_id,
    p_opportunity_id,
    'cycle_closed',
    p_closed_by,
    jsonb_build_object(
      'cycle_id',                  v_cycle_id,
      'close_reason',              p_close_reason,
      'eligible_for_new_cycle_at', v_eligible_at
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_cycle_if_open(UUID, TEXT, UUID) FROM anon, authenticated;

-- 2. Abre novo ciclo para uma oportunidade
CREATE OR REPLACE FUNCTION public.open_contact_cycle(
  p_opportunity_id UUID,
  p_company_id     UUID,
  p_opened_by      UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_new_cycle_id UUID;
  v_stage_tracks BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities
     WHERE id = p_opportunity_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: oportunidade % nao pertence a empresa %', p_opportunity_id, p_company_id;
  END IF;

  SELECT fs.track_contact_attempts INTO v_stage_tracks
    FROM opportunity_funnel_positions ofp
    JOIN funnel_stages fs ON fs.id = ofp.stage_id
   WHERE ofp.opportunity_id = p_opportunity_id LIMIT 1;

  IF NOT COALESCE(v_stage_tracks, false) THEN
    RAISE EXCEPTION 'INVALID_STATE: etapa nao habilita rastreamento, oportunidade %', p_opportunity_id;
  END IF;

  INSERT INTO contact_attempt_cycles (company_id, opportunity_id, opened_by, status)
  VALUES (p_company_id, p_opportunity_id, p_opened_by, 'open')
  RETURNING id INTO v_new_cycle_id;

  UPDATE opportunity_funnel_positions
     SET contact_attempts_state    = 'cycle_open',
         current_contact_cycle_id  = v_new_cycle_id,
         contact_cycle_opened_at   = now(),
         eligible_for_new_cycle_at = NULL
   WHERE opportunity_id = p_opportunity_id;

  INSERT INTO opportunity_timeline_events (company_id, opportunity_id, event_type, actor_id, metadata)
  VALUES (p_company_id, p_opportunity_id, 'cycle_opened', p_opened_by,
    jsonb_build_object('cycle_id', v_new_cycle_id, 'opened_by', p_opened_by, 'opened_at', now()));

  RETURN v_new_cycle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_contact_cycle(UUID, UUID, UUID) FROM anon, authenticated;

-- 3. Fecha manualmente o ciclo aberto de uma oportunidade
CREATE OR REPLACE FUNCTION public.close_contact_cycle(
  p_opportunity_id UUID,
  p_company_id     UUID,
  p_closed_by      UUID,
  p_close_reason   TEXT DEFAULT 'manual_close'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: oportunidade % nao pertence a empresa %', p_opportunity_id, p_company_id;
  END IF;

  PERFORM close_cycle_if_open(p_opportunity_id, p_close_reason, p_closed_by);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_contact_cycle(UUID, UUID, UUID, TEXT) FROM anon, authenticated;
