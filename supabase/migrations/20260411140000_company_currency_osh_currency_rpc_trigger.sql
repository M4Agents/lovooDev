-- =====================================================
-- ETAPA 1: companies (default_currency, country_code)
--         opportunity_status_history.currency_code
--         RPCs close_opportunity / reopen_opportunity
--         Trigger: impedir alteração de opportunities.currency após criação
-- Multi-tenant: sem mudança de RLS; colunas em tabelas já isoladas por company_id
-- =====================================================

-- -----------------------------------------------------------------
-- 1) companies: moeda padrão e país (ISO 3166-1 alpha-2, opcional)
-- -----------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) NOT NULL DEFAULT 'BRL';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) NULL;

COMMENT ON COLUMN companies.default_currency IS 'ISO 4217 — moeda padrão para novos registros (ex.: oportunidades); não infere país.';
COMMENT ON COLUMN companies.country_code IS 'ISO 3166-1 alpha-2 — opcional; contexto; não define moeda.';

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_default_currency_format;

ALTER TABLE companies
  ADD CONSTRAINT companies_default_currency_format
  CHECK (char_length(trim(default_currency)) = 3);

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_country_code_format;

ALTER TABLE companies
  ADD CONSTRAINT companies_country_code_format
  CHECK (
    country_code IS NULL
    OR (char_length(trim(country_code)) = 2 AND country_code = upper(country_code))
  );

-- -----------------------------------------------------------------
-- 2) opportunity_status_history: moeda do snapshot
-- -----------------------------------------------------------------
ALTER TABLE opportunity_status_history
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NULL;

COMMENT ON COLUMN opportunity_status_history.currency_code IS 'ISO 4217 da oportunidade no momento do snapshot; legado NULL.';

-- -----------------------------------------------------------------
-- 3) Legado: garantir currency em oportunidades antes do trigger
-- -----------------------------------------------------------------
UPDATE opportunities
   SET currency = 'BRL'
 WHERE currency IS NULL;

-- -----------------------------------------------------------------
-- 4) close_opportunity — preenche currency_code no histórico
-- -----------------------------------------------------------------
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
  v_current_status  VARCHAR(50);
  v_current_value   DECIMAL(15,2);
  v_currency        VARCHAR(3);
  v_entered_at      TIMESTAMPTZ;
  v_current_stage   UUID;
  v_changed_by      UUID;
BEGIN
  v_changed_by := auth.uid();

  IF p_to_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'status inválido para fechamento: %', p_to_status;
  END IF;

  SELECT status, value, currency
    INTO v_current_status, v_current_value, v_currency
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  SELECT stage_id, entered_stage_at
    INTO v_current_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

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

  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

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

-- -----------------------------------------------------------------
-- 5) reopen_opportunity — preenche currency_code no histórico
-- -----------------------------------------------------------------
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
  v_current_status   VARCHAR(50);
  v_current_value    DECIMAL(15,2);
  v_current_reason   TEXT;
  v_current_closed   TIMESTAMPTZ;
  v_current_currency VARCHAR(3);
  v_current_stage    UUID;
  v_entered_at       TIMESTAMPTZ;
  v_changed_by       UUID;
BEGIN
  v_changed_by := auth.uid();

  SELECT status, value, loss_reason, closed_at, currency
    INTO v_current_status, v_current_value, v_current_reason, v_current_closed, v_current_currency
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  IF v_current_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'só é possível reabrir oportunidades com status won ou lost';
  END IF;

  SELECT stage_id, entered_stage_at
    INTO v_current_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

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

  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

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
    'open',
    v_current_value,
    COALESCE(v_current_currency, 'BRL'),
    NULL,
    NULL,
    now(),
    v_changed_by
  );

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

-- -----------------------------------------------------------------
-- 6) Trigger: currency imutável após linha existente (exceto NULL legado → primeiro valor)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_prevent_opportunity_currency_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.currency IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'opportunities.currency não pode ser alterada após definição inicial (company_id=%)', OLD.company_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunities_currency_immutable ON opportunities;

CREATE TRIGGER trg_opportunities_currency_immutable
  BEFORE UPDATE OF currency ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_opportunity_currency_change();
