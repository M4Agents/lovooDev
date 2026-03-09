-- =====================================================
-- MIGRATION: Custom Activity Types System
-- Permite que cada empresa personalize seus tipos de atividades
-- =====================================================

-- Criar tabela para tipos de atividades personalizadas
CREATE TABLE IF NOT EXISTS custom_activity_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Dados do tipo
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(10) NOT NULL, -- Emoji ou código do ícone
  color VARCHAR(20) DEFAULT 'blue',
  
  -- Ordem de exibição
  display_order INTEGER DEFAULT 0,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false, -- Tipos padrão do sistema
  
  -- Auditoria
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_company_activity_type UNIQUE(company_id, name)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_custom_activity_types_company ON custom_activity_types(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_activity_types_active ON custom_activity_types(is_active);
CREATE INDEX IF NOT EXISTS idx_custom_activity_types_order ON custom_activity_types(company_id, display_order);

-- Habilitar RLS
ALTER TABLE custom_activity_types ENABLE ROW LEVEL SECURITY;

-- Policy: Usuários podem visualizar tipos da sua empresa
CREATE POLICY "Users can view their company activity types"
  ON custom_activity_types FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- Policy: Usuários podem gerenciar tipos da sua empresa
CREATE POLICY "Users can manage their company activity types"
  ON custom_activity_types FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_custom_activity_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_custom_activity_types_updated_at
  BEFORE UPDATE ON custom_activity_types
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_activity_types_updated_at();

-- Inserir tipos padrão do sistema para todas as empresas existentes
INSERT INTO custom_activity_types (company_id, name, icon, color, is_system, display_order, created_by)
SELECT 
  c.id,
  type.name,
  type.icon,
  type.color,
  true,
  type.display_order,
  c.user_id
FROM companies c
CROSS JOIN (
  VALUES 
    ('Ligação', '📞', 'blue', 1),
    ('Reunião', '🤝', 'green', 2),
    ('Email', '📧', 'purple', 3),
    ('Tarefa', '✓', 'gray', 4),
    ('Follow-up', '🔄', 'orange', 5),
    ('Demonstração', '🎯', 'indigo', 6),
    ('Outro', '📋', 'slate', 7)
) AS type(name, icon, color, display_order)
ON CONFLICT (company_id, name) DO NOTHING;

-- Comentários para documentação
COMMENT ON TABLE custom_activity_types IS 'Tipos de atividades personalizáveis por empresa';
COMMENT ON COLUMN custom_activity_types.is_system IS 'Tipos do sistema não podem ser deletados';
COMMENT ON COLUMN custom_activity_types.display_order IS 'Ordem de exibição no select';
