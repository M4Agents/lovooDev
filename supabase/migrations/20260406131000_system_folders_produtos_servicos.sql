-- Pastas de sistema: Produtos e Serviços
-- Criação idempotente para todas as empresas existentes.
-- Empresas com path '/produtos' ou '/servicos' já existentes também recebem is_system_folder = TRUE.

-- Inserir pasta Produtos onde ainda não existe
INSERT INTO company_folders (company_id, name, path, icon, description, is_system_folder)
SELECT
  c.id,
  'Produtos',
  '/produtos',
  '📦',
  'Mídias de produtos do catálogo',
  TRUE
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_folders cf
  WHERE cf.company_id = c.id AND cf.path = '/produtos'
);

-- Inserir pasta Serviços onde ainda não existe
INSERT INTO company_folders (company_id, name, path, icon, description, is_system_folder)
SELECT
  c.id,
  'Serviços',
  '/servicos',
  '🛠',
  'Mídias de serviços do catálogo',
  TRUE
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_folders cf
  WHERE cf.company_id = c.id AND cf.path = '/servicos'
);

-- Garantir is_system_folder = TRUE para pastas com esses paths (edge case: criadas manualmente antes)
UPDATE company_folders
SET is_system_folder = TRUE
WHERE path IN ('/produtos', '/servicos')
  AND is_system_folder IS DISTINCT FROM TRUE;
