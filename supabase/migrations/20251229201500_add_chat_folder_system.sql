-- =====================================================
-- MIGRAÇÃO: PASTA CHAT PADRÃO DO SISTEMA
-- Data: 29/12/2025
-- Objetivo: Implementar pasta Chat padrão para mídias do WhatsApp
-- =====================================================

-- 1. Adicionar campo de proteção para pastas do sistema
ALTER TABLE company_folders 
ADD COLUMN IF NOT EXISTS is_system_folder BOOLEAN DEFAULT FALSE;

-- 2. Adicionar campo folder_id na tabela lead_media_unified
ALTER TABLE lead_media_unified 
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES company_folders(id);

-- 3. Criar índice para performance na busca por pasta
CREATE INDEX IF NOT EXISTS idx_lead_media_folder ON lead_media_unified(company_id, folder_id);

-- 4. Atualizar função de criação de pastas padrão para incluir Chat
CREATE OR REPLACE FUNCTION create_default_company_folders()
RETURNS TRIGGER AS $$
BEGIN
  -- Inserir pastas padrão para nova empresa (incluindo Chat)
  INSERT INTO company_folders (company_id, name, path, icon, description, is_system_folder) VALUES
    (NEW.id, 'Chat', '/chat', '💬', 'Mídias recebidas via WhatsApp', TRUE),
    (NEW.id, 'Marketing', '/marketing', '📢', 'Materiais de marketing e campanhas', FALSE),
    (NEW.id, 'Produtos', '/produtos', '📦', 'Imagens e documentos de produtos', FALSE),
    (NEW.id, 'Documentos', '/documentos', '📄', 'Documentos gerais da empresa', FALSE),
    (NEW.id, 'Templates', '/templates', '📋', 'Templates e modelos reutilizáveis', FALSE);
  
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 5. Criar pasta Chat para empresas existentes
INSERT INTO company_folders (company_id, name, path, icon, description, is_system_folder)
SELECT 
  c.id,
  'Chat',
  '/chat',
  '💬',
  'Mídias recebidas via WhatsApp',
  TRUE
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_folders cf 
  WHERE cf.company_id = c.id AND cf.path = '/chat'
);

-- 6. Função para buscar/criar pasta Chat automaticamente
CREATE OR REPLACE FUNCTION get_or_create_chat_folder(p_company_id UUID)
RETURNS UUID AS $$
DECLARE
  folder_id UUID;
BEGIN
  -- Tentar buscar pasta Chat existente
  SELECT id INTO folder_id
  FROM company_folders
  WHERE company_id = p_company_id AND path = '/chat';
  
  -- Se não encontrou, criar a pasta Chat
  IF folder_id IS NULL THEN
    INSERT INTO company_folders (company_id, name, path, icon, description, is_system_folder)
    VALUES (p_company_id, 'Chat', '/chat', '💬', 'Mídias recebidas via WhatsApp', TRUE)
    RETURNING id INTO folder_id;
  END IF;
  
  RETURN folder_id;
END;
$$ language 'plpgsql';

-- 7. Função para salvar mídia do chat na pasta Chat
CREATE OR REPLACE FUNCTION save_chat_media(
  p_company_id UUID,
  p_lead_id UUID,
  p_s3_key TEXT,
  p_original_filename TEXT,
  p_file_type TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_preview_url TEXT DEFAULT NULL,
  p_source_message_id UUID DEFAULT NULL,
  p_source_conversation_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  chat_folder_id UUID;
  media_id UUID;
BEGIN
  -- Buscar/criar pasta Chat
  chat_folder_id := get_or_create_chat_folder(p_company_id);
  
  -- Inserir mídia na pasta Chat
  INSERT INTO lead_media_unified (
    company_id,
    lead_id,
    folder_id,
    s3_key,
    original_filename,
    file_type,
    mime_type,
    file_size,
    preview_url,
    source_message_id,
    source_conversation_id,
    received_at
  ) VALUES (
    p_company_id,
    p_lead_id,
    chat_folder_id,
    p_s3_key,
    p_original_filename,
    p_file_type,
    p_mime_type,
    p_file_size,
    p_preview_url,
    p_source_message_id,
    p_source_conversation_id,
    NOW()
  ) RETURNING id INTO media_id;
  
  RETURN media_id;
END;
$$ language 'plpgsql';

-- 8. Política RLS para função save_chat_media (SECURITY DEFINER)
ALTER FUNCTION save_chat_media SECURITY DEFINER;
ALTER FUNCTION get_or_create_chat_folder SECURITY DEFINER;

-- 9. Comentários para documentação
COMMENT ON COLUMN company_folders.is_system_folder IS 'Indica se a pasta é do sistema e não pode ser deletada';
COMMENT ON COLUMN lead_media_unified.folder_id IS 'Referência para a pasta onde a mídia está organizada';
COMMENT ON FUNCTION get_or_create_chat_folder IS 'Busca ou cria automaticamente a pasta Chat para uma empresa';
COMMENT ON FUNCTION save_chat_media IS 'Salva mídia do WhatsApp automaticamente na pasta Chat';

-- 10. Atualizar pastas existentes para marcar as padrão como não-sistema (exceto Chat)
UPDATE company_folders 
SET is_system_folder = FALSE 
WHERE path IN ('/marketing', '/produtos', '/documentos', '/templates')
  AND is_system_folder IS NULL;

-- =====================================================
-- LOGS DE MIGRAÇÃO
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migração pasta Chat concluída:';
  RAISE NOTICE '   - Campo is_system_folder adicionado';
  RAISE NOTICE '   - Campo folder_id adicionado em lead_media_unified';
  RAISE NOTICE '   - Pasta Chat criada para todas as empresas';
  RAISE NOTICE '   - Funções auxiliares criadas';
  RAISE NOTICE '   - Índices de performance adicionados';
END $$;
