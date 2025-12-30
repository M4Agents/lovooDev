-- =====================================================
-- EXECUTAR ESTE SCRIPT NO PAINEL SUPABASE
-- SQL Editor > New Query > Colar e Executar
-- =====================================================

-- 1. Adicionar campo de proteção para pastas do sistema
ALTER TABLE company_folders 
ADD COLUMN IF NOT EXISTS is_system_folder BOOLEAN DEFAULT FALSE;

-- 2. Adicionar campo folder_id na tabela lead_media_unified
ALTER TABLE lead_media_unified 
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES company_folders(id);

-- 3. Criar índice para performance na busca por pasta
CREATE INDEX IF NOT EXISTS idx_lead_media_folder ON lead_media_unified(company_id, folder_id);

-- 4. Função para buscar/criar pasta Chat automaticamente
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

-- 5. Função para salvar mídia do chat na pasta Chat
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

-- 6. Tornar funções SECURITY DEFINER para bypass RLS
ALTER FUNCTION save_chat_media SECURITY DEFINER;
ALTER FUNCTION get_or_create_chat_folder SECURITY DEFINER;

-- 7. Criar pasta Chat para empresas existentes
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

-- 8. Verificar se tudo foi criado corretamente
SELECT 
  'Pastas Chat criadas:' as status,
  COUNT(*) as quantidade
FROM company_folders 
WHERE path = '/chat' AND is_system_folder = TRUE;

SELECT 
  'Funções criadas:' as status,
  COUNT(*) as quantidade
FROM pg_proc 
WHERE proname IN ('get_or_create_chat_folder', 'save_chat_media');
