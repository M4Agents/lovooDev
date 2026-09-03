-- =====================================================
-- Migration: adicionar validação LOSS_TYPE_REQUIRED
--            a close_opportunity
--
-- Base: versão vigente em
--   20260623450000_add_guards_kanban_rpcs.sql
--
-- ÚNICA alteração funcional em relação à versão base:
--   1. Leitura de sf.require_lost_loss_type no JOIN
--   2. Variáveis v_require_loss_type e v_loss_type_count
--   3. Bloco LOSS_TYPE_REQUIRED após WON_SALE_TYPE_REQUIRED
--
-- PRESERVADO INTEGRALMENTE:
--   - Assinatura e parâmetros
--   - SECURITY DEFINER + search_path
--   - auth_user_can_access_funnel (guard)
--   - Validação de status de destino
--   - Verificação de existência/ownership da oportunidade
--   - INVALID_FUNNEL_POSITION
--   - WON_ITEM_REQUIRED
--   - WON_SALE_TYPE_REQUIRED
--   - Registro em opportunity_stage_history
--   - UPDATE opportunity_funnel_positions
--   - INSERT opportunity_status_history
--   - UPDATE opportunities (status, closed_at, actual_close_date,
--                           value, loss_reason)
--   - RETURN QUERY
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
  v_current_status     VARCHAR(50);
  v_current_value      DECIMAL(15,2);
  v_currency           VARCHAR(3);
  v_entered_at         TIMESTAMPTZ;
  v_current_stage      UUID;
  v_changed_by         UUID;
  v_require_items      BOOLEAN;
  v_require_sale_type  BOOLEAN;
  v_require_loss_type  BOOLEAN;
  v_item_count         INTEGER;
  v_sale_type_count    INTEGER;
  v_loss_type_count    INTEGER;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────────────────
  -- Preservado de 20260623450000_add_guards_kanban_rpcs.sql
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

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

  -- ── Validar posição real no funil + buscar flags ──
  -- JOIN seguro: sem COALESCE — se não encontrar, falha imediatamente.
  -- ALTERAÇÃO: adicionada leitura de sf.require_lost_loss_type
  SELECT ofp.stage_id, ofp.entered_stage_at,
         sf.require_won_items, sf.require_won_sale_type,
         sf.require_lost_loss_type
    INTO v_current_stage, v_entered_at,
         v_require_items, v_require_sale_type,
         v_require_loss_type
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
  -- Preservado integralmente de 20260623120000
  IF p_to_status = 'won' AND v_require_items = true THEN
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

  -- ── Validação WON_SALE_TYPE_REQUIRED ──
  -- Preservado integralmente de 20260623240000
  IF p_to_status = 'won' AND v_require_sale_type = true THEN
    SELECT COUNT(*)
      INTO v_sale_type_count
      FROM opportunity_sale_types
     WHERE opportunity_id = p_opportunity_id
       AND company_id     = p_company_id;

    IF v_sale_type_count = 0 THEN
      RAISE EXCEPTION 'WON_SALE_TYPE_REQUIRED'
        USING HINT = 'Selecione ao menos um tipo de venda para fechar como ganho.';
    END IF;
  END IF;

  -- ── Validação LOSS_TYPE_REQUIRED ──
  -- NOVA: espelho de WON_SALE_TYPE_REQUIRED para status lost
  -- COUNT simples em opportunity_loss_types — sem JOIN com loss_types
  IF p_to_status = 'lost' AND v_require_loss_type = true THEN
    SELECT COUNT(*)
      INTO v_loss_type_count
      FROM opportunity_loss_types
     WHERE opportunity_id = p_opportunity_id
       AND company_id     = p_company_id;

    IF v_loss_type_count = 0 THEN
      RAISE EXCEPTION 'LOSS_TYPE_REQUIRED'
        USING HINT = 'Selecione ao menos um tipo de perda para fechar como perdido.';
    END IF;
  END IF;

  -- ── Registrar histórico de etapa ──
  -- Preservado integralmente de 20260408110000
  IF v_current_stage IS NOT NULL THEN
    INSERT INTO opportunity_stage_history (
      company_id, opportunity_id, funnel_id,
      from_stage_id, to_stage_id,
      stage_entered_at, stage_left_at,
      moved_by, move_type
    ) VALUES (
      p_company_id, p_opportunity_id, p_funnel_id,
      v_current_stage, p_to_stage_id,
      COALESCE(v_entered_at, now()), now(),
      v_changed_by, p_to_status
    );
  END IF;

  -- ── Atualizar posição no funil ──
  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- ── Registrar histórico de status ──
  -- Preservado integralmente de 20260411140000 (com currency_code)
  INSERT INTO opportunity_status_history (
    opportunity_id, company_id,
    from_status, to_status,
    value_snapshot, currency_code,
    loss_reason, closed_at,
    changed_at, changed_by
  ) VALUES (
    p_opportunity_id, p_company_id,
    v_current_status, p_to_status,
    COALESCE(p_value, v_current_value),
    COALESCE(v_currency, 'BRL'),
    CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
    p_closed_at, now(), v_changed_by
  );

  -- ── Atualizar oportunidade ──
  UPDATE opportunities
     SET status            = p_to_status,
         closed_at         = p_closed_at,
         actual_close_date = p_closed_at::DATE,
         value             = COALESCE(p_value, value),
         loss_reason       = CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
         updated_at        = now()
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  RETURN QUERY
    SELECT * FROM opportunities
     WHERE id         = p_opportunity_id
       AND company_id = p_company_id;
END;
$$;
