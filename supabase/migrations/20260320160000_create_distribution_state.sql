-- =====================================================
-- MIGRATION: CREATE DISTRIBUTION STATE TABLE
-- Data: 20/03/2026
-- Objetivo: Criar tabela para armazenar estado do Round Robin
-- =====================================================

-- Criar tabela distribution_state
CREATE TABLE IF NOT EXISTS distribution_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  last_user_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id)
);

-- Criar índice para busca rápida por company_id
CREATE INDEX IF NOT EXISTS idx_distribution_state_company_id 
ON distribution_state(company_id);

-- Habilitar RLS
ALTER TABLE distribution_state ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver/editar apenas da própria empresa
CREATE POLICY "Users can manage distribution state of their company"
ON distribution_state
FOR ALL
USING (
  company_id IN (
    SELECT company_id 
    FROM company_users 
    WHERE user_id = auth.uid()
  )
);

-- Comentários
COMMENT ON TABLE distribution_state IS 'Armazena o estado do Round Robin para distribuição de leads';
COMMENT ON COLUMN distribution_state.company_id IS 'ID da empresa';
COMMENT ON COLUMN distribution_state.last_user_index IS 'Índice do último usuário que recebeu um lead no Round Robin';
COMMENT ON COLUMN distribution_state.updated_at IS 'Data da última distribuição';
