-- =====================================================
-- Migration: close_opportunity — validação WON_ITEM_REQUIRED
--
-- Alterações em relação à versão anterior:
--   1. INVALID_FUNNEL_POSITION: se p_funnel_id não corresponder
--      a uma posição real da oportunidade → RAISE EXCEPTION.
--      Evita bypass enviando funnel_id arbitrário.
--   2. WON_ITEM_REQUIRED: ao fechar como 'won', se o funil
--      tiver require_won_items = true e não existir nenhuma
--      linha em opportunity_items → RAISE EXCEPTION.
--
-- Fonte de verdade para require_won_items:
--   JOIN opportunity_funnel_positions + sales_funnels
--   (não confia em p_funnel_id isolado).
--
-- Preservado: toda lógica de histórico, atualização de posição,
--   opportunity_status_history e opportunities.
-- =====================================================

CREATE OR REPLACE FUNCTION close_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER,
  p_to_status         VARCHAR,
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
  v_current_status   VARCHAR(50);
  v_current_value    DECIMAL(15,2);
  v_currency         VARCHAR(3);
  v_entered_at       TIMESTAMPTZ;
  v_current_stage    UUID;
  v_changed_by       UUID;
  v_require_items    BOOLEAN;
  v_item_count       INTEGER;
BEGIN
  v_changed_by := auth.uid();

  -- ── Validar status de destino ──
  IF p_to_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'status inválido para fechamento: %', p_to_status;
  END IF;

  -- ── Verificar existência e ownership da oportunidade ──
  SELECT status, value, currency
    INTO v_current_status, v_current_value, v_currency
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  -- ── Validar posição real no funil (fonte de verdade) ──
  -- Ao mesmo tempo: busca require_won_items via JOIN seguro.
  -- Se nenhum registro for encontrado, p_funnel_id é inválido
  -- para esta oportunidade — rejeitar operação.
  SELECT ofp.stage_id, ofp.entered_stage_at, sf.require_won_items
    INTO v_current_stage, v_entered_at, v_require_items
    FROM opportunity_funnel_positions ofp
    JOIN sales_funnels sf
      ON sf.id         = ofp.funnel_id
     AND sf.company_id = p_company_id
   WHERE ofp.opportunity_id = p_opportunity_id
     AND ofp.funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_FUNNEL_POSITION'
      USING HINT = 'O funil informado não corresponde à posição atual desta oportunidade.';
  END IF;

  -- ── Validação WON_ITEM_REQUIRED ──
  IF p_to_status = 'won' AND COALESCE(v_require_items, false) = true THEN
    SELECT COUNT(*)
      INTO v_item_count
      FROM opportunity_items
     WHERE opportunity_id = p_opportunity_id
       AND company_id     = p_company_id;

    IF v_item_count = 0 THEN
      RAISE EXCEPTION 'WON_ITEM_REQUIRED'
        USING HINT = 'É necessário selecionar ao menos um produto ou serviço para fechar como ganho.';
    END IF;
  END IF;

  -- ── Registrar histórico de etapa (se havia posição anterior) ──
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
      p_to_status
    );
  END IF;

  -- ── Atualizar posição no funil ──
  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- ── Registrar histórico de status ──
  INSERT INTO opportunity_status_history (
    opportunity_id,
    company_id,
    from_status,
    to_status,
    value_snapshot,
    currency_code,
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
    COALESCE(v_currency, 'BRL'),
    CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
    p_closed_at,
    now(),
    v_changed_by
  );

  -- ── Atualizar oportunidade ──
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
