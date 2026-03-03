-- =====================================================
-- MIGRAÇÃO: SISTEMA DE FUNIL DE VENDAS (SALES PIPELINE)
-- Data: 03/03/2026
-- Objetivo: Sistema completo de gestão de funis de vendas com Kanban
-- FASE 1: Fundação - Estrutura de banco de dados
-- =====================================================

-- =====================================================
-- TABELA: sales_funnels
-- Descrição: Funis de vendas da empresa
-- =====================================================
CREATE TABLE IF NOT EXISTS sales_funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_company_funnel_name UNIQUE(company_id, name),
  CONSTRAINT valid_funnel_name CHECK (length(trim(name)) > 0)
);

-- =====================================================
-- TABELA: funnel_stages
-- Descrição: Etapas de cada funil (colunas do Kanban)
-- =====================================================
CREATE TABLE IF NOT EXISTS funnel_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id UUID NOT NULL REFERENCES sales_funnels(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#FCD34D', -- Hex color (ex: #FCD34D)
  position INTEGER NOT NULL, -- Ordem das etapas (0, 1, 2, ...)
  is_system_stage BOOLEAN DEFAULT false, -- "Lead Novo" é system stage
  stage_type VARCHAR(50) DEFAULT 'active' CHECK (stage_type IN ('active', 'won', 'lost')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_funnel_stage_position UNIQUE(funnel_id, position),
  CONSTRAINT unique_funnel_stage_name UNIQUE(funnel_id, name),
  CONSTRAINT valid_stage_name CHECK (length(trim(name)) > 0),
  CONSTRAINT valid_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT valid_position CHECK (position >= 0)
);

-- =====================================================
-- TABELA: lead_funnel_positions
-- Descrição: Posição de cada lead em cada funil
-- =====================================================
CREATE TABLE IF NOT EXISTS lead_funnel_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  funnel_id UUID NOT NULL REFERENCES sales_funnels(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  position_in_stage INTEGER NOT NULL DEFAULT 0, -- Ordem dentro da etapa
  entered_stage_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_lead_funnel UNIQUE(lead_id, funnel_id),
  CONSTRAINT valid_position_in_stage CHECK (position_in_stage >= 0)
);

-- =====================================================
-- TABELA: lead_stage_history
-- Descrição: Histórico de movimentações entre etapas
-- =====================================================
CREATE TABLE IF NOT EXISTS lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  funnel_id UUID NOT NULL REFERENCES sales_funnels(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES funnel_stages(id),
  to_stage_id UUID NOT NULL REFERENCES funnel_stages(id),
  moved_by UUID REFERENCES auth.users(id),
  moved_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- =====================================================
-- TABELA: lead_card_field_preferences
-- Descrição: Preferências de campos visíveis nos cards
-- =====================================================
CREATE TABLE IF NOT EXISTS lead_card_field_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id), -- NULL = preferência da empresa
  visible_fields JSONB NOT NULL DEFAULT '["photo", "name", "phone", "company", "tags"]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_user_card_prefs UNIQUE(company_id, user_id)
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

-- Índices para sales_funnels
CREATE INDEX IF NOT EXISTS idx_sales_funnels_company ON sales_funnels(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_funnels_default ON sales_funnels(company_id, is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_sales_funnels_active ON sales_funnels(company_id, is_active) WHERE is_active = true;

-- Índices para funnel_stages
CREATE INDEX IF NOT EXISTS idx_funnel_stages_funnel ON funnel_stages(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_stages_position ON funnel_stages(funnel_id, position);
CREATE INDEX IF NOT EXISTS idx_funnel_stages_system ON funnel_stages(funnel_id, is_system_stage) WHERE is_system_stage = true;

-- Índices para lead_funnel_positions
CREATE INDEX IF NOT EXISTS idx_lead_funnel_positions_lead ON lead_funnel_positions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_funnel_positions_funnel ON lead_funnel_positions(funnel_id);
CREATE INDEX IF NOT EXISTS idx_lead_funnel_positions_stage ON lead_funnel_positions(stage_id);
CREATE INDEX IF NOT EXISTS idx_lead_funnel_positions_stage_order ON lead_funnel_positions(stage_id, position_in_stage);

-- Índices para lead_stage_history
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON lead_stage_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_funnel ON lead_stage_history(funnel_id);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_moved_at ON lead_stage_history(moved_at DESC);

-- Índices para lead_card_field_preferences
CREATE INDEX IF NOT EXISTS idx_lead_card_prefs_company ON lead_card_field_preferences(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_card_prefs_user ON lead_card_field_preferences(user_id) WHERE user_id IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE sales_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_funnel_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_card_field_preferences ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES: sales_funnels
-- =====================================================

-- SELECT: Usuários podem ver funis da sua empresa
CREATE POLICY "sales_funnels_select_policy" ON sales_funnels
  FOR SELECT
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- INSERT: Usuários podem criar funis na sua empresa
CREATE POLICY "sales_funnels_insert_policy" ON sales_funnels
  FOR INSERT
  WITH CHECK (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- UPDATE: Usuários podem atualizar funis da sua empresa
CREATE POLICY "sales_funnels_update_policy" ON sales_funnels
  FOR UPDATE
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- DELETE: Usuários podem deletar funis da sua empresa
CREATE POLICY "sales_funnels_delete_policy" ON sales_funnels
  FOR DELETE
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- =====================================================
-- RLS POLICIES: funnel_stages
-- =====================================================

-- SELECT: Usuários podem ver etapas dos funis da sua empresa
CREATE POLICY "funnel_stages_select_policy" ON funnel_stages
  FOR SELECT
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- INSERT: Usuários podem criar etapas nos funis da sua empresa
CREATE POLICY "funnel_stages_insert_policy" ON funnel_stages
  FOR INSERT
  WITH CHECK (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- UPDATE: Usuários podem atualizar etapas dos funis da sua empresa
CREATE POLICY "funnel_stages_update_policy" ON funnel_stages
  FOR UPDATE
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- DELETE: Usuários podem deletar etapas dos funis da sua empresa (exceto system stages)
CREATE POLICY "funnel_stages_delete_policy" ON funnel_stages
  FOR DELETE
  USING (
    is_system_stage = false AND
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- =====================================================
-- RLS POLICIES: lead_funnel_positions
-- =====================================================

-- SELECT: Usuários podem ver posições de leads nos funis da sua empresa
CREATE POLICY "lead_funnel_positions_select_policy" ON lead_funnel_positions
  FOR SELECT
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- INSERT: Usuários podem adicionar leads aos funis da sua empresa
CREATE POLICY "lead_funnel_positions_insert_policy" ON lead_funnel_positions
  FOR INSERT
  WITH CHECK (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- UPDATE: Usuários podem mover leads nos funis da sua empresa
CREATE POLICY "lead_funnel_positions_update_policy" ON lead_funnel_positions
  FOR UPDATE
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- DELETE: Usuários podem remover leads dos funis da sua empresa
CREATE POLICY "lead_funnel_positions_delete_policy" ON lead_funnel_positions
  FOR DELETE
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- =====================================================
-- RLS POLICIES: lead_stage_history
-- =====================================================

-- SELECT: Usuários podem ver histórico dos funis da sua empresa
CREATE POLICY "lead_stage_history_select_policy" ON lead_stage_history
  FOR SELECT
  USING (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- INSERT: Sistema pode inserir histórico (usuários via trigger)
CREATE POLICY "lead_stage_history_insert_policy" ON lead_stage_history
  FOR INSERT
  WITH CHECK (
    funnel_id IN (
      SELECT id FROM sales_funnels 
      WHERE company_id = (auth.jwt() ->> 'company_id')::UUID
    )
  );

-- =====================================================
-- RLS POLICIES: lead_card_field_preferences
-- =====================================================

-- SELECT: Usuários podem ver preferências da sua empresa
CREATE POLICY "lead_card_prefs_select_policy" ON lead_card_field_preferences
  FOR SELECT
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- INSERT: Usuários podem criar preferências na sua empresa
CREATE POLICY "lead_card_prefs_insert_policy" ON lead_card_field_preferences
  FOR INSERT
  WITH CHECK (
    company_id = (auth.jwt() ->> 'company_id')::UUID
  );

-- UPDATE: Usuários podem atualizar suas preferências
CREATE POLICY "lead_card_prefs_update_policy" ON lead_card_field_preferences
  FOR UPDATE
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID AND
    (user_id IS NULL OR user_id = auth.uid())
  );

-- DELETE: Usuários podem deletar suas preferências
CREATE POLICY "lead_card_prefs_delete_policy" ON lead_card_field_preferences
  FOR DELETE
  USING (
    company_id = (auth.jwt() ->> 'company_id')::UUID AND
    (user_id IS NULL OR user_id = auth.uid())
  );

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

-- Reutilizar função update_updated_at_column() se já existir
-- (criada na migration anterior de biblioteca de mídia)

-- Triggers para updated_at
CREATE TRIGGER update_sales_funnels_updated_at 
  BEFORE UPDATE ON sales_funnels 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_funnel_stages_updated_at 
  BEFORE UPDATE ON funnel_stages 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_funnel_positions_updated_at 
  BEFORE UPDATE ON lead_funnel_positions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_card_prefs_updated_at 
  BEFORE UPDATE ON lead_card_field_preferences 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TRIGGER: Registrar histórico de movimentações
-- =====================================================

CREATE OR REPLACE FUNCTION record_lead_stage_movement()
RETURNS TRIGGER AS $$
BEGIN
  -- Registrar movimentação apenas se mudou de etapa
  IF (TG_OP = 'UPDATE' AND OLD.stage_id != NEW.stage_id) THEN
    INSERT INTO lead_stage_history (
      lead_id,
      funnel_id,
      from_stage_id,
      to_stage_id,
      moved_by,
      moved_at
    ) VALUES (
      NEW.lead_id,
      NEW.funnel_id,
      OLD.stage_id,
      NEW.stage_id,
      auth.uid(),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER track_lead_stage_movement
  AFTER UPDATE ON lead_funnel_positions
  FOR EACH ROW
  EXECUTE FUNCTION record_lead_stage_movement();

-- =====================================================
-- TRIGGER: Garantir apenas um funil padrão por empresa
-- =====================================================

CREATE OR REPLACE FUNCTION ensure_single_default_funnel()
RETURNS TRIGGER AS $$
BEGIN
  -- Se está marcando como padrão, desmarcar outros
  IF NEW.is_default = true THEN
    UPDATE sales_funnels 
    SET is_default = false 
    WHERE company_id = NEW.company_id 
      AND id != NEW.id 
      AND is_default = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_default_funnel_uniqueness
  BEFORE INSERT OR UPDATE ON sales_funnels
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_funnel();

-- =====================================================
-- FUNÇÃO: Criar funil padrão para novas empresas
-- =====================================================

CREATE OR REPLACE FUNCTION create_default_sales_funnel()
RETURNS TRIGGER AS $$
DECLARE
  v_funnel_id UUID;
BEGIN
  -- Criar funil padrão
  INSERT INTO sales_funnels (
    company_id,
    name,
    description,
    is_default,
    is_active
  ) VALUES (
    NEW.id,
    'Funil de Vendas Principal',
    'Funil padrão criado automaticamente',
    true,
    true
  ) RETURNING id INTO v_funnel_id;
  
  -- Criar etapas padrão
  INSERT INTO funnel_stages (funnel_id, name, color, position, is_system_stage, stage_type) VALUES
    (v_funnel_id, 'Lead Novo', '#FCD34D', 0, true, 'active'),
    (v_funnel_id, 'Contato Realizado', '#86EFAC', 1, false, 'active'),
    (v_funnel_id, 'Diagnóstico / Briefing', '#93C5FD', 2, false, 'active'),
    (v_funnel_id, 'Proposta Enviada', '#C4B5FD', 3, false, 'active'),
    (v_funnel_id, 'Follow-up', '#FCA5A5', 4, false, 'active'),
    (v_funnel_id, 'Fechado - Ganhou', '#10B981', 5, false, 'won'),
    (v_funnel_id, 'Fechado - Perdeu', '#EF4444', 6, false, 'lost');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para criar funil padrão
CREATE TRIGGER create_company_default_funnel
  AFTER INSERT ON companies
  FOR EACH ROW
  EXECUTE FUNCTION create_default_sales_funnel();

-- =====================================================
-- FUNÇÃO: Adicionar lead automaticamente ao funil padrão
-- =====================================================

CREATE OR REPLACE FUNCTION add_lead_to_default_funnel()
RETURNS TRIGGER AS $$
DECLARE
  v_funnel_id UUID;
  v_stage_id UUID;
BEGIN
  -- Buscar funil padrão da empresa
  SELECT id INTO v_funnel_id
  FROM sales_funnels
  WHERE company_id = NEW.company_id
    AND is_default = true
    AND is_active = true
  LIMIT 1;
  
  -- Se encontrou funil padrão
  IF v_funnel_id IS NOT NULL THEN
    -- Buscar etapa "Lead Novo" (system stage)
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id
      AND is_system_stage = true
      AND position = 0
    LIMIT 1;
    
    -- Se encontrou a etapa, adicionar lead
    IF v_stage_id IS NOT NULL THEN
      INSERT INTO lead_funnel_positions (
        lead_id,
        funnel_id,
        stage_id,
        position_in_stage,
        entered_stage_at
      ) VALUES (
        NEW.id,
        v_funnel_id,
        v_stage_id,
        0,
        NOW()
      )
      ON CONFLICT (lead_id, funnel_id) DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para adicionar lead ao funil automaticamente
CREATE TRIGGER auto_add_lead_to_funnel
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION add_lead_to_default_funnel();

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE sales_funnels IS 'Funis de vendas configuráveis por empresa';
COMMENT ON TABLE funnel_stages IS 'Etapas de cada funil (colunas do Kanban)';
COMMENT ON TABLE lead_funnel_positions IS 'Posição atual de cada lead em cada funil';
COMMENT ON TABLE lead_stage_history IS 'Histórico completo de movimentações entre etapas';
COMMENT ON TABLE lead_card_field_preferences IS 'Preferências de campos visíveis nos cards dos leads';

COMMENT ON COLUMN funnel_stages.is_system_stage IS 'Etapa "Lead Novo" é system stage e não pode ser deletada';
COMMENT ON COLUMN funnel_stages.stage_type IS 'Tipo: active (em andamento), won (ganhou), lost (perdeu)';
COMMENT ON COLUMN funnel_stages.color IS 'Cor em formato hexadecimal (#RRGGBB)';
COMMENT ON COLUMN lead_funnel_positions.position_in_stage IS 'Ordem do lead dentro da etapa (para drag & drop)';
COMMENT ON COLUMN lead_card_field_preferences.user_id IS 'NULL = preferência da empresa, UUID = preferência do usuário';
