-- =====================================================
-- MIGRATION: Criar pasta "Audios" para todas as empresas
-- Data: 17/03/2026
-- Objetivo: Garantir que todas as empresas tenham pasta Audios
--           para armazenar áudios gravados em automação
-- =====================================================

-- Criar pasta Audios para empresas que ainda não têm
INSERT INTO company_folders (company_id, name, description, created_at, updated_at)
SELECT 
  id as company_id,
  'Audios' as name,
  'Áudios gravados em automação' as description,
  NOW() as created_at,
  NOW() as updated_at
FROM companies
WHERE NOT EXISTS (
  SELECT 1 
  FROM company_folders 
  WHERE company_folders.company_id = companies.id 
  AND company_folders.name = 'Audios'
);

-- Log de execução
DO $$
DECLARE
  folders_created INTEGER;
BEGIN
  SELECT COUNT(*) INTO folders_created
  FROM company_folders
  WHERE name = 'Audios';
  
  RAISE NOTICE 'Migration concluída: % pastas "Audios" existem no sistema', folders_created;
END $$;
