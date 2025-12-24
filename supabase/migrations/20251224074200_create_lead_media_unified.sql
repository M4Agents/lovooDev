-- =====================================================
-- MIGRAÇÃO: BIBLIOTECA DE MÍDIA UNIFICADA
-- Data: 24/12/2025
-- Objetivo: Sistema unificado de mídias por lead
-- =====================================================

-- Tabela principal para mídias organizadas por lead
CREATE TABLE IF NOT EXISTS lead_media_unified (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Arquivo principal
  s3_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document')),
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  
  -- Preview e thumbnails
  thumbnail_s3_key TEXT,
  preview_url TEXT,
  
  -- Metadados específicos por tipo (JSON flexível)
  metadata JSONB DEFAULT '{}',
  
  -- Rastreabilidade
  source_message_id UUID,
  source_conversation_id UUID,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  migrated_from TEXT, -- Para rastrear migração da estrutura antiga
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_file_size CHECK (file_size > 0),
  CONSTRAINT valid_s3_key CHECK (length(s3_key) > 0)
);

-- Tabela para biblioteca da empresa (pastas e arquivos)
CREATE TABLE IF NOT EXISTS company_media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Estrutura de pastas
  folder_path TEXT NOT NULL DEFAULT '/', -- Ex: /marketing/banners
  original_filename TEXT NOT NULL,
  
  -- Arquivo
  s3_key TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document')),
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  
  -- Preview
  thumbnail_s3_key TEXT,
  preview_url TEXT,
  
  -- Organização
  tags TEXT[] DEFAULT '{}',
  description TEXT,
  
  -- Auditoria
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_folder_path CHECK (folder_path ~ '^/.*'),
  CONSTRAINT valid_company_file_size CHECK (file_size > 0)
);

-- Estrutura de pastas da empresa
CREATE TABLE IF NOT EXISTS company_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  path TEXT NOT NULL, -- Ex: /marketing/banners
  parent_path TEXT, -- Ex: /marketing
  icon TEXT DEFAULT '📁',
  description TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_path CHECK (path ~ '^/.*'),
  CONSTRAINT unique_company_path UNIQUE (company_id, path)
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

-- Índices para lead_media_unified
CREATE INDEX IF NOT EXISTS idx_lead_media_company_lead ON lead_media_unified(company_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_media_type ON lead_media_unified(company_id, file_type);
CREATE INDEX IF NOT EXISTS idx_lead_media_received ON lead_media_unified(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_media_conversation ON lead_media_unified(source_conversation_id);

-- Índices para company_media_library
CREATE INDEX IF NOT EXISTS idx_company_media_folder ON company_media_library(company_id, folder_path);
CREATE INDEX IF NOT EXISTS idx_company_media_type ON company_media_library(company_id, file_type);
CREATE INDEX IF NOT EXISTS idx_company_media_tags ON company_media_library USING GIN(tags);

-- Índices para company_folders
CREATE INDEX IF NOT EXISTS idx_company_folders_path ON company_folders(company_id, path);
CREATE INDEX IF NOT EXISTS idx_company_folders_parent ON company_folders(company_id, parent_path);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE lead_media_unified ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_media_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_folders ENABLE ROW LEVEL SECURITY;

-- Políticas para lead_media_unified
CREATE POLICY "lead_media_company_isolation" ON lead_media_unified
  FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::UUID);

-- Políticas para company_media_library
CREATE POLICY "company_media_isolation" ON company_media_library
  FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::UUID);

-- Políticas para company_folders
CREATE POLICY "company_folders_isolation" ON company_folders
  FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::UUID);

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para updated_at
CREATE TRIGGER update_lead_media_updated_at 
  BEFORE UPDATE ON lead_media_unified 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_media_updated_at 
  BEFORE UPDATE ON company_media_library 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_folders_updated_at 
  BEFORE UPDATE ON company_folders 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PASTAS PADRÃO PARA EMPRESAS
-- =====================================================

-- Função para criar pastas padrão quando uma empresa é criada
CREATE OR REPLACE FUNCTION create_default_company_folders()
RETURNS TRIGGER AS $$
BEGIN
  -- Inserir pastas padrão para nova empresa
  INSERT INTO company_folders (company_id, name, path, icon, description) VALUES
    (NEW.id, 'Marketing', '/marketing', '📢', 'Materiais de marketing e campanhas'),
    (NEW.id, 'Produtos', '/produtos', '📦', 'Imagens e documentos de produtos'),
    (NEW.id, 'Documentos', '/documentos', '📄', 'Documentos gerais da empresa'),
    (NEW.id, 'Templates', '/templates', '📋', 'Templates e modelos reutilizáveis');
  
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para criar pastas padrão (se a tabela companies existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies') THEN
    CREATE TRIGGER create_company_default_folders
      AFTER INSERT ON companies
      FOR EACH ROW EXECUTE FUNCTION create_default_company_folders();
  END IF;
END $$;

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE lead_media_unified IS 'Mídias recebidas organizadas por lead de forma unificada';
COMMENT ON TABLE company_media_library IS 'Biblioteca de mídias da empresa organizadas em pastas';
COMMENT ON TABLE company_folders IS 'Estrutura de pastas para organização da biblioteca da empresa';

COMMENT ON COLUMN lead_media_unified.metadata IS 'Metadados específicos: {width, height, duration, pages, etc}';
COMMENT ON COLUMN lead_media_unified.migrated_from IS 'Caminho original para rastrear migração';
COMMENT ON COLUMN company_media_library.folder_path IS 'Caminho da pasta: /marketing/banners';
COMMENT ON COLUMN company_folders.path IS 'Caminho único da pasta: /marketing/banners';
