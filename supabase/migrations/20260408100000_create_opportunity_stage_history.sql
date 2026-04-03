-- =====================================================
-- MIGRATION: Histórico completo de etapas da oportunidade
-- Data: 08/04/2026
-- Objetivo:
--   1. Criar tabela opportunity_stage_history
--   2. Criar trigger de entrada no funil (funnel_entry)
--   3. Criar RPC move_opportunity (atômica com histórico)
--
-- Separação de responsabilidades:
--   opportunity_funnel_positions  = estado atual da etapa
--   opportunities                 = status atual (open/won/lost)
--   opportunity_status_history    = histórico de transições de status
--   opportunity_stage_history     = histórico completo de etapas (nova)
--
-- Naming dos campos temporais:
--   stage_entered_at = quando entrou em from_stage
--   stage_left_at    = quando saiu de from_stage
--   duration_seconds = permanência em from_stage (coluna gerada)
-- =====================================================

-- =====================================================
-- 1. TABELA opportunity_stage_history
-- =====================================================

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant (obrigatório)
  company_id       UUID        NOT NULL,
  opportunity_id   UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  funnel_id        UUID        NOT NULL REFERENCES sales_funnels(id),

  -- Transição de etapa
  from_stage_id    UUID        REFERENCES funnel_stages(id),  -- NULL = funnel_entry (sem etapa anterior)
  to_stage_id      UUID        NOT NULL REFERENCES funnel_stages(id),

  -- Permanência em from_stage
  stage_entered_at TIMESTAMPTZ NOT NULL,              -- quando entrou em from_stage
  stage_left_at    TIMESTAMPTZ NOT NULL DEFAULT now(), -- quando saiu de from_stage
  duration_seconds INTEGER     GENERATED ALWAYS AS
                   (EXTRACT(EPOCH FROM (stage_left_at - stage_entered_at))::INTEGER) STORED,

  -- Rastreabilidade
  moved_by         UUID        REFERENCES auth.users(id),
  move_type        VARCHAR(30) NOT NULL DEFAULT 'stage_change',
  -- 'funnel_entry' | 'stage_change' | 'won' | 'lost' | 'reopened'

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT osh_valid_move_type CHECK (
    move_type IN ('funnel_entry', 'stage_change', 'won', 'lost', 'reopened')
  )
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Lookup por oportunidade
CREATE INDEX IF NOT EXISTS idx_ostagehist_opportunity
  ON opportunity_stage_history (opportunity_id);

-- Timeline cronológica por oportunidade (query principal de histórico)
CREATE INDEX IF NOT EXISTS idx_ostagehist_opportunity_timeline
  ON opportunity_stage_history (opportunity_id, stage_left_at ASC);

-- Dashboards operacionais recentes por empresa
CREATE INDEX IF NOT EXISTS idx_ostagehist_company_left_at
  ON opportunity_stage_history (company_id, stage_left_at DESC);

-- Volume de entradas por etapa por empresa
CREATE INDEX IF NOT EXISTS idx_ostagehist_company_to_stage
  ON opportunity_stage_history (company_id, to_stage_id);

-- Métricas por funil/etapa
CREATE INDEX IF NOT EXISTS idx_ostagehist_funnel_stage
  ON opportunity_stage_history (funnel_id, to_stage_id);

-- Filtros por tipo de movimento
CREATE INDEX IF NOT EXISTS idx_ostagehist_move_type
  ON opportunity_stage_history (company_id, move_type, stage_left_at DESC);

-- =====================================================
-- 3. RLS (Row Level Security)
-- =====================================================

ALTER TABLE opportunity_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ostagehist_tenant_isolation" ON opportunity_stage_history
  FOR ALL USING (
    company_id = (
      SELECT company_id FROM company_users
       WHERE user_id = auth.uid()
       LIMIT 1
    )
  );

-- =====================================================
-- 4. FUNÇÃO: record_opportunity_funnel_entry
-- Dispara em INSERT em opportunity_funnel_positions.
-- Grava o marcador de entrada no funil (move_type = 'funnel_entry').
-- Só ativa quando opportunity_id IS NOT NULL (ignora registros legados).
-- =====================================================

CREATE OR REPLACE FUNCTION record_opportunity_funnel_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Ignorar registros sem opportunity_id (legado lead_funnel_positions)
  IF NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Obter company_id via opportunities
  SELECT company_id
    INTO v_company_id
    FROM opportunities
   WHERE id = NEW.opportunity_id;

  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Gravar marcador de entrada no funil
  -- stage_entered_at = stage_left_at = now() → duration_seconds = 0
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
    NEW.opportunity_id,
    NEW.funnel_id,
    NULL,             -- sem etapa anterior
    NEW.stage_id,
    now(),
    now(),            -- duration_seconds = 0 (marcador, não permanência)
    auth.uid(),
    'funnel_entry'
  );

  RETURN NEW;
END;
$$;

-- =====================================================
-- 5. TRIGGER: track_opportunity_funnel_entry
-- Dispara após INSERT em opportunity_funnel_positions.
-- O trigger legado track_opportunity_stage_movement continua
-- ativo em UPDATE (coexistência intencional nesta fase).
-- =====================================================

DROP TRIGGER IF EXISTS track_opportunity_funnel_entry ON opportunity_funnel_positions;

CREATE TRIGGER track_opportunity_funnel_entry
  AFTER INSERT ON opportunity_funnel_positions
  FOR EACH ROW
  EXECUTE FUNCTION record_opportunity_funnel_entry();

-- =====================================================
-- 6. RPC: move_opportunity
-- Atômica: valida → lê estado atual → insere histórico → atualiza posição
-- Substitui o UPDATE direto em funnelApi.moveOpportunityToStage.
-- company_id resolvido internamente via opportunities (não recebido do frontend).
-- moved_by resolvido internamente via auth.uid().
-- =====================================================

CREATE OR REPLACE FUNCTION move_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_from_stage_id     UUID,   -- informativo; o banco usa o stage_id real da posição
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
BEGIN
  -- 1. Ler estado atual real da posição (fonte de verdade do banco)
  SELECT stage_id, entered_stage_at
    INTO v_actual_from_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'posição não encontrada para opportunity_id=% funnel_id=%',
      p_opportunity_id, p_funnel_id;
  END IF;

  -- 2. Early return: sem efeito se já está na etapa de destino
  --    Usa o stage real do banco, não p_from_stage_id (proteção contra estado stale)
  IF v_actual_from_stage = p_to_stage_id THEN
    RETURN QUERY
      SELECT * FROM opportunity_funnel_positions
       WHERE opportunity_id = p_opportunity_id
         AND funnel_id      = p_funnel_id;
    RETURN;
  END IF;

  -- 3. Obter company_id via opportunities
  SELECT company_id
    INTO v_company_id
    FROM opportunities
   WHERE id = p_opportunity_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'oportunidade não encontrada: %', p_opportunity_id;
  END IF;

  -- 4. Inserir histórico da etapa que está sendo ENCERRADA
  --    (permanência em v_actual_from_stage desde v_entered_at até now())
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
    v_actual_from_stage,   -- etapa de origem (real, lida do banco)
    p_to_stage_id,
    COALESCE(v_entered_at, now()),  -- fallback: caso entered_stage_at seja NULL
    now(),
    auth.uid(),
    'stage_change'
  );

  -- 5. Atualizar a posição atual
  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  -- 6. Retornar a posição atualizada
  RETURN QUERY
    SELECT * FROM opportunity_funnel_positions
     WHERE opportunity_id = p_opportunity_id
       AND funnel_id      = p_funnel_id;
END;
$$;
