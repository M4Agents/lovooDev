-- =====================================================
-- CRIAR PASTAS PADRÃO PARA EMPRESA
-- =====================================================
-- Data: 2026-02-21 09:05
-- Empresa: dcc99d3d-9def-4b93-aeb2-1a3be5f15413

-- Inserir pastas padrão
INSERT INTO company_folders (company_id, name, icon, description, path, parent_id, file_count, created_at, updated_at)
VALUES 
  -- Pasta Chat
  ('dcc99d3d-9def-4b93-aeb2-1a3be5f15413', 'Chat', '💬', 'Arquivos do WhatsApp', '/chat', NULL, 0, NOW(), NOW()),
  
  -- Pasta Marketing
  ('dcc99d3d-9def-4b93-aeb2-1a3be5f15413', 'Marketing', '📢', 'Materiais de marketing', '/marketing', NULL, 0, NOW(), NOW()),
  
  -- Pasta Produtos
  ('dcc99d3d-9def-4b93-aeb2-1a3be5f15413', 'Produtos', '📦', 'Imagens e vídeos de produtos', '/produtos', NULL, 0, NOW(), NOW()),
  
  -- Pasta Documentos
  ('dcc99d3d-9def-4b93-aeb2-1a3be5f15413', 'Documentos', '📄', 'Documentos gerais', '/documentos', NULL, 0, NOW(), NOW()),
  
  -- Pasta Teste
  ('dcc99d3d-9def-4b93-aeb2-1a3be5f15413', 'Teste', '🧪', 'Pasta para testes', '/teste', NULL, 0, NOW(), NOW())
ON CONFLICT (company_id, name) DO NOTHING;

-- Verificar pastas criadas
SELECT id, name, icon, path, file_count 
FROM company_folders 
WHERE company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'
ORDER BY name;
