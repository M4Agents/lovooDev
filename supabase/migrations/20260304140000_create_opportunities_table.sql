-- =====================================================
-- MIGRATION: Criar tabela de Oportunidades
-- Data: 04/03/2026
-- Descrição: Criar estrutura para gerenciar oportunidades de vendas
-- =====================================================

-- =====================================================
-- TABELA: opportunities
-- Descrição: Oportunidades de venda vinculadas a leads
-- =====================================================
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relacionamento
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Informações da Oportunidade
  title VARCHAR(255) NOT NULL,
  description TEXT,
  value DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'BRL',
  
  -- Status
  status VARCHAR(50) DEFAULT 'open',  -- open, won, lost
  probability INTEGER DEFAULT 50,  -- 0-100%
  expected_close_date DATE,
  actual_close_date DATE,
  
  -- Origem
  source VARCHAR(100),
  
  -- Responsável
  owner_user_id UUID REFERENCES auth.users(id),
  
  -- Metadados
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT valid_probability CHECK (probability >= 0 AND probability <= 100),
  CONSTRAINT valid_value CHECK (value >= 0)
);

-- =====================================================
-- ÍNDICES
-- =====================================================
CREATE INDEX idx_opportunities_lead ON opportunities(lead_id);
CREATE INDEX idx_opportunities_company ON opportunities(company_id);
CREATE INDEX idx_opportunities_status ON opportunities(status);
CREATE INDEX idx_opportunities_owner ON opportunities(owner_user_id);
CREATE INDEX idx_opportunities_created_at ON opportunities(created_at DESC);

-- =====================================================
-- RLS (ROW LEVEL SECURITY)
-- =====================================================
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- SELECT: Usuários podem ver oportunidades da sua empresa
CREATE POLICY "opportunities_select_policy" ON opportunities
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- INSERT: Usuários podem criar oportunidades na sua empresa
CREATE POLICY "opportunities_insert_policy" ON opportunities
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Usuários podem atualizar oportunidades da sua empresa
CREATE POLICY "opportunities_update_policy" ON opportunities
  FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- DELETE: Usuários podem deletar oportunidades da sua empresa
CREATE POLICY "opportunities_delete_policy" ON opportunities
  FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- TRIGGER: Atualizar updated_at
-- =====================================================
CREATE TRIGGER update_opportunities_updated_at 
  BEFORE UPDATE ON opportunities 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE opportunities IS 'Oportunidades de venda vinculadas a leads';
COMMENT ON COLUMN opportunities.title IS 'Título/nome da oportunidade';
COMMENT ON COLUMN opportunities.value IS 'Valor total da oportunidade em reais';
COMMENT ON COLUMN opportunities.probability IS 'Probabilidade de fechamento (0-100%)';
COMMENT ON COLUMN opportunities.status IS 'Status: open (aberta), won (ganha), lost (perdida)';
