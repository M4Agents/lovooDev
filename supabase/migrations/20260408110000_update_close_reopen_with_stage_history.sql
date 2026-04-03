-- =====================================================
-- MIGRATION: Atualiza close_opportunity e reopen_opportunity
--            para gravar em opportunity_stage_history
-- Data: 08/04/2026
-- Objetivo:
--   Toda transição de etapa (ativa, fechamento, reabertura)
--   fica registrada em opportunity_stage_history.
--   close_opportunity  → move_type 'won' ou 'lost'
--   reopen_opportunity → move_type 'reopened'
-- =====================================================

-- =====================================================
-- 1. RPC: close_opportunity (atualizada)
-- Atômica:
--   a. lê estado atual
--   b. grava histórico de etapa (etapa que está sendo encerrada)
--   c. atualiza opportunity_funnel_positions
--   d. insere opportunity_status_history
--   e. atualiza opportunities
-- =====================================================

CREATE OR REPLACE FUNCTION close_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER,
  p_to_status         VARCHAR,      -- 'won' ou 'lost'
  p_value             DECIMAL,
  p_loss_reason       TEXT,
  p_closed_at         TIMESTAMPTZ,
  p_company_id        UUID
)
RETURNS SETOF opportunities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status  VARCHAR(50);
  v_current_value   DECIMAL(15,2);
  v_entered_at      TIMESTAMPTZ;
  v_current_stage   UUID;
  v_changed_by      UUID;
BEGIN
  -- Segurança: changed_by via auth.uid() — não aceito do frontend
  v_changed_by := auth.uid();

  -- Validar status de destino
  IF p_to_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'status inválido para fechamento: %', p_to_status;
  END IF;

  -- Buscar estado atual da oportunidade para snapshot
  SELECT status, value
    INTO v_current_status, v_current_value
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  -- Buscar etapa atual e entered_stage_at para o histórico de etapa
  SELECT stage_id, entered_stage_at
    INTO v_current_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- 1. Gravar histórico de etapa (permanência na etapa que está sendo encerrada)
  IF v_current_stage IS NOT NULL THEN
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
      p_company_id,
      p_opportunity_id,
      p_funnel_id,
      v_current_stage,
      p_to_stage_id,
      COALESCE(v_entered_at, now()),
      now(),
      v_changed_by,
      p_to_status   -- 'won' ou 'lost'
    );
  END IF;

  -- 2. Atualizar posição no funil
  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- 3. Registrar histórico de status (snapshot do estado ANTES da mudança)
  INSERT INTO opportunity_status_history (
    opportunity_id,
    company_id,
    from_status,
    to_status,
    value_snapshot,
    loss_reason,
    closed_at,
    changed_at,
    changed_by
  ) VALUES (
    p_opportunity_id,
    p_company_id,
    v_current_status,
    p_to_status,
    COALESCE(p_value, v_current_value),
    CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
    p_closed_at,
    now(),
    v_changed_by
  );

  -- 4. Atualizar oportunidade
  UPDATE opportunities
     SET status             = p_to_status,
         closed_at          = p_closed_at,
         actual_close_date  = p_closed_at::DATE,
         value              = COALESCE(p_value, value),
         loss_reason        = CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
         updated_at         = now()
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  RETURN QUERY
    SELECT * FROM opportunities
     WHERE id         = p_opportunity_id
       AND company_id = p_company_id;
END;
$$;

-- =====================================================
-- 2. RPC: reopen_opportunity (atualizada)
-- Atômica:
--   a. lê estado atual
--   b. grava histórico de etapa (etapa de won/lost sendo encerrada)
--   c. atualiza opportunity_funnel_positions
--   d. insere opportunity_status_history (snapshot do fechamento)
--   e. limpa campos de fechamento em opportunities
-- =====================================================

CREATE OR REPLACE FUNCTION reopen_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER,
  p_company_id        UUID
)
RETURNS SETOF opportunities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status  VARCHAR(50);
  v_current_value   DECIMAL(15,2);
  v_current_reason  TEXT;
  v_current_closed  TIMESTAMPTZ;
  v_current_stage   UUID;
  v_entered_at      TIMESTAMPTZ;
  v_changed_by      UUID;
BEGIN
  -- Segurança: changed_by via auth.uid()
  v_changed_by := auth.uid();

  -- Buscar estado atual para snapshot
  SELECT status, value, loss_reason, closed_at
    INTO v_current_status, v_current_value, v_current_reason, v_current_closed
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  IF v_current_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'só é possível reabrir oportunidades com status won ou lost';
  END IF;

  -- Buscar etapa atual e entered_stage_at para o histórico de etapa
  SELECT stage_id, entered_stage_at
    INTO v_current_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- 1. Gravar histórico de etapa (permanência na etapa won/lost que está sendo encerrada)
  IF v_current_stage IS NOT NULL THEN
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
      p_company_id,
      p_opportunity_id,
      p_funnel_id,
      v_current_stage,
      p_to_stage_id,
      COALESCE(v_entered_at, now()),
      now(),
      v_changed_by,
      'reopened'
    );
  END IF;

  -- 2. Atualizar posição no funil
  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- 3. Registrar histórico de status (snapshot do fechamento anterior antes de limpar)
  INSERT INTO opportunity_status_history (
    opportunity_id,
    company_id,
    from_status,
    to_status,
    value_snapshot,
    loss_reason,
    closed_at,
    changed_at,
    changed_by
  ) VALUES (
    p_opportunity_id,
    p_company_id,
    v_current_status,
    'open',
    v_current_value,
    NULL,
    NULL,
    now(),
    v_changed_by
  );

  -- 4. Limpar campos de fechamento e reabrir
  UPDATE opportunities
     SET status             = 'open',
         closed_at          = NULL,
         actual_close_date  = NULL,
         loss_reason        = NULL,
         updated_at         = now()
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  RETURN QUERY
    SELECT * FROM opportunities
     WHERE id         = p_opportunity_id
       AND company_id = p_company_id;
END;
$$;
