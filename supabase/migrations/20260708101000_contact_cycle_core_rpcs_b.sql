-- Motor de Ciclos: RPCs core parte B — registro, cancelamento e inbound
-- register_contact_attempt: registra uma tentativa dentro do ciclo aberto
-- cancel_contact_attempt: cancela uma tentativa registrada
-- handle_inbound_for_contact_cycle: fecha ciclo ao receber mensagem inbound

-- 1. Registra uma tentativa de contato no ciclo aberto
CREATE OR REPLACE FUNCTION public.register_contact_attempt(
  p_opportunity_id    UUID,
  p_company_id        UUID,
  p_actor_id          UUID,
  p_trigger_reason    TEXT,
  p_reason_id         UUID    DEFAULT NULL,
  p_lead_id           INTEGER DEFAULT NULL,
  p_funnel_stage_id   UUID    DEFAULT NULL,
  p_whatsapp_message_id TEXT  DEFAULT NULL,
  p_notes             TEXT    DEFAULT NULL,
  p_answers           JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_cycle_id           UUID;
  v_global_num         INTEGER;
  v_cycle_num          INTEGER;
  v_attempt_id         UUID;
  v_stage_id           UUID;
  v_stage_name         TEXT;
  v_reason_label       TEXT;
  v_answer             JSONB;
  v_question_id        UUID;
  v_answer_value       TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: oportunidade % nao pertence a empresa %', p_opportunity_id, p_company_id;
  END IF;

  IF p_trigger_reason NOT IN ('manual', 'whatsapp_sent', 'whatsapp_received', 'system') THEN
    RAISE EXCEPTION 'INVALID_PARAM: trigger_reason invalido: %', p_trigger_reason;
  END IF;

  IF p_reason_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM contact_attempt_reasons WHERE id = p_reason_id AND company_id = p_company_id AND active = true) THEN
      RAISE EXCEPTION 'INVALID_PARAM: reason_id % inativo ou nao pertence a empresa %', p_reason_id, p_company_id;
    END IF;
  END IF;

  SELECT cac.id INTO v_cycle_id
    FROM contact_attempt_cycles cac
   WHERE cac.opportunity_id = p_opportunity_id AND cac.status = 'open'
   LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: sem ciclo aberto para oportunidade %', p_opportunity_id;
  END IF;

  SELECT COUNT(*) + 1 INTO v_global_num FROM contact_attempts
   WHERE opportunity_id = p_opportunity_id AND cancelled_at IS NULL;

  SELECT COUNT(*) + 1 INTO v_cycle_num FROM contact_attempts
   WHERE cycle_id = v_cycle_id AND cancelled_at IS NULL;

  SELECT fs.id, fs.name INTO v_stage_id, v_stage_name
    FROM opportunity_funnel_positions ofp
    JOIN funnel_stages fs ON fs.id = ofp.stage_id
   WHERE ofp.opportunity_id = p_opportunity_id LIMIT 1;

  IF p_reason_id IS NOT NULL THEN
    SELECT label INTO v_reason_label FROM contact_attempt_reasons WHERE id = p_reason_id;
  END IF;

  INSERT INTO contact_attempts (
    company_id, opportunity_id, cycle_id, actor_id,
    trigger_reason, reason_id, global_attempt_number, attempt_number_in_cycle,
    lead_id, funnel_stage_id, whatsapp_message_id, notes
  ) VALUES (
    p_company_id, p_opportunity_id, v_cycle_id, p_actor_id,
    p_trigger_reason, p_reason_id, v_global_num, v_cycle_num,
    p_lead_id, COALESCE(p_funnel_stage_id, v_stage_id), p_whatsapp_message_id, p_notes
  ) RETURNING id INTO v_attempt_id;

  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
      v_question_id  := (v_answer->>'question_id')::UUID;
      v_answer_value := COALESCE(v_answer->>'value', '');
      IF NOT EXISTS (SELECT 1 FROM contact_attempt_questions WHERE id = v_question_id AND company_id = p_company_id AND active = true) THEN
        RAISE EXCEPTION 'INVALID_PARAM: question_id % invalido ou nao pertence a empresa %', v_question_id, p_company_id;
      END IF;
      INSERT INTO contact_attempt_answers (attempt_id, question_id, value) VALUES (v_attempt_id, v_question_id, v_answer_value);
    END LOOP;
  END IF;

  UPDATE opportunity_funnel_positions
     SET last_contact_attempt_at = now(), total_contact_attempts = total_contact_attempts + 1
   WHERE opportunity_id = p_opportunity_id;

  INSERT INTO opportunity_timeline_events (company_id, opportunity_id, event_type, actor_id, metadata)
  VALUES (p_company_id, p_opportunity_id, 'attempt_registered', p_actor_id,
    jsonb_build_object(
      'attempt_id', v_attempt_id, 'cycle_id', v_cycle_id,
      'trigger_reason', p_trigger_reason, 'reason_id', p_reason_id,
      'reason_label_snapshot', v_reason_label,
      'global_attempt_number', v_global_num, 'attempt_in_cycle', v_cycle_num,
      'stage_id_snapshot', v_stage_id, 'stage_name_snapshot', v_stage_name,
      'whatsapp_message_id', p_whatsapp_message_id, 'notes', p_notes,
      'answers_snapshot', COALESCE(p_answers, '[]'::jsonb)
    ));

  RETURN v_attempt_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_contact_attempt(UUID, UUID, UUID, TEXT, UUID, INTEGER, UUID, TEXT, TEXT, JSONB) FROM anon, authenticated;

-- 2. Cancela uma tentativa de contato registrada
CREATE OR REPLACE FUNCTION public.cancel_contact_attempt(
  p_attempt_id UUID,
  p_company_id UUID,
  p_actor_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_attempt contact_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
    FROM contact_attempts
   WHERE id = p_attempt_id AND company_id = p_company_id AND cancelled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: tentativa % nao encontrada, ja cancelada ou nao pertence a empresa %',
      p_attempt_id, p_company_id;
  END IF;

  UPDATE contact_attempts SET cancelled_at = now() WHERE id = p_attempt_id;

  UPDATE opportunity_funnel_positions
     SET total_contact_attempts = GREATEST(0, total_contact_attempts - 1)
   WHERE opportunity_id = v_attempt.opportunity_id;

  INSERT INTO opportunity_timeline_events (company_id, opportunity_id, event_type, actor_id, metadata)
  VALUES (p_company_id, v_attempt.opportunity_id, 'attempt_cancelled', p_actor_id,
    jsonb_build_object(
      'attempt_id', p_attempt_id, 'cycle_id', v_attempt.cycle_id,
      'original_trigger_reason', v_attempt.trigger_reason,
      'original_reason_id', v_attempt.reason_id,
      'global_attempt_number', v_attempt.global_attempt_number,
      'attempt_in_cycle', v_attempt.attempt_number_in_cycle,
      'cancelled_by', p_actor_id
    ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_contact_attempt(UUID, UUID, UUID) FROM anon, authenticated;

-- 3. Processa inbound de WhatsApp para fechar ciclo aberto (uso interno/webhook)
CREATE OR REPLACE FUNCTION public.handle_inbound_for_contact_cycle(
  p_lead_id             INTEGER,
  p_company_id          UUID,
  p_whatsapp_message_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_opportunity_id UUID;
BEGIN
  v_opportunity_id := resolve_opportunity_for_contact_cycle(p_lead_id, p_company_id);
  IF v_opportunity_id IS NULL THEN RETURN; END IF;
  PERFORM close_cycle_if_open(v_opportunity_id, 'inbound_received', NULL);
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_inbound_for_contact_cycle(INTEGER, UUID, TEXT) FROM anon, authenticated;
