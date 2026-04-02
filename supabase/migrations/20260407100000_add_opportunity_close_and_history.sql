-- =====================================================
-- MIGRATION: Fechamento e histórico de oportunidades
-- Data: 07/04/2026
-- Objetivo:
--   1. Adicionar coluna loss_reason em opportunities
--   2. Criar tabela opportunity_status_history
--   3. Criar RPC close_opportunity (atômica)
--   4. Criar RPC reopen_opportunity (atômica)
--
-- Regra de negócio:
--   - opportunities = estado atual (status, closed_at, value, loss_reason)
--   - opportunity_status_history = linha do tempo de transições de status
--   - Movimentos active → active NÃO gravam histórico
--   - Histórico gravado apenas quando status muda (won/lost/open)
--   - changed_by usa auth.uid() internamente (não aceito do frontend)
-- =====================================================

-- =====================================================
-- 1. COLUNA loss_reason EM opportunities
-- =====================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS loss_reason TEXT;

-- =====================================================
-- 2. TABELA opportunity_status_history
-- =====================================================

CREATE TABLE IF NOT EXISTS opportunity_status_history (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relacionamento e isolamento multi-tenant
  opportunity_id  UUID         NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  company_id      UUID         NOT NULL,

  -- Transição
  from_status     VARCHAR(50),           -- status anterior; nullable para compatibilidade futura
  to_status       VARCHAR(50)  NOT NULL,
  CONSTRAINT osh_valid_to_status CHECK (to_status IN ('open', 'won', 'lost')),

  -- Snapshot no momento da transição
  value_snapshot  DECIMAL(15,2),   -- valor da oportunidade no momento do evento
  loss_reason     TEXT,            -- motivo de perda (apenas to_status = 'lost')
  closed_at       TIMESTAMPTZ,     -- data/hora registrada pelo usuário; NULL ao reabrir

  -- Rastreabilidade
  changed_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  changed_by      UUID         REFERENCES auth.users(id)  -- preenchido via auth.uid() na RPC
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_osh_opportunity
  ON opportunity_status_history (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_osh_company_changed
  ON opportunity_status_history (company_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_osh_company_status
  ON opportunity_status_history (company_id, to_status, closed_at);

-- RLS
ALTER TABLE opportunity_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "osh_tenant_isolation" ON opportunity_status_history
  FOR ALL USING (
    company_id = (
      SELECT company_id FROM company_users
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- =====================================================
-- 3. RPC: close_opportunity
-- Atômica: atualiza opportunity_funnel_positions +
--          insere opportunity_status_history +
--          atualiza opportunities
-- changed_by é resolvido internamente via auth.uid()
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
  v_changed_by      UUID;
BEGIN
  -- Segurança: changed_by via auth.uid() — não aceito do frontend
  v_changed_by := auth.uid();

  -- Validar status de destino
  IF p_to_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'status inválido para fechamento: %', p_to_status;
  END IF;

  -- Buscar estado atual para snapshot
  SELECT status, value
    INTO v_current_status, v_current_value
    FROM opportunities
   WHERE id = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  -- 1. Atualizar posição no funil
  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id       = p_funnel_id;

  -- 2. Registrar histórico (snapshot do estado ANTES da mudança)
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

  -- 3. Atualizar oportunidade
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
-- 4. RPC: reopen_opportunity
-- Atômica: atualiza opportunity_funnel_positions +
--          insere opportunity_status_history (snapshot) +
--          limpa campos de fechamento em opportunities
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
  v_changed_by      UUID;
BEGIN
  -- Segurança: changed_by via auth.uid()
  v_changed_by := auth.uid();

  -- Buscar estado atual para snapshot
  SELECT status, value, loss_reason, closed_at
    INTO v_current_status, v_current_value, v_current_reason, v_current_closed
    FROM opportunities
   WHERE id = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  IF v_current_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'só é possível reabrir oportunidades com status won ou lost';
  END IF;

  -- 1. Atualizar posição no funil
  UPDATE opportunity_funnel_positions
     SET stage_id           = p_to_stage_id,
         position_in_stage  = p_position_in_stage,
         entered_stage_at   = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id       = p_funnel_id;

  -- 2. Registrar histórico (snapshot do fechamento anterior antes de limpar)
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

  -- 3. Limpar campos de fechamento e reabrir
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
