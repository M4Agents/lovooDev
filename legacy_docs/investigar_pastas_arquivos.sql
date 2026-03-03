-- =====================================================
-- INVESTIGAÇÃO: PASTAS E ARQUIVOS
-- =====================================================
-- Data: 22/02/2026
-- Problema: Pasta "Teste" mostra arquivos de "Antes e Depois"

-- 1. LISTAR TODAS AS PASTAS
SELECT 
  id,
  name,
  icon,
  path,
  created_at
FROM company_folders
WHERE company_id = 'acc99d3d-9def-4b93-aeb2-133be5f15413'
ORDER BY name;

-- 2. CONTAR ARQUIVOS POR PASTA
SELECT 
  cf.name as pasta_nome,
  cf.id as pasta_id,
  COUNT(lmu.id) as total_arquivos
FROM company_folders cf
LEFT JOIN lead_media_unified lmu ON lmu.folder_id = cf.id
WHERE cf.company_id = 'acc99d3d-9def-4b93-aeb2-133be5f15413'
GROUP BY cf.id, cf.name
ORDER BY cf.name;

-- 3. LISTAR ARQUIVOS E SUAS PASTAS
SELECT 
  lmu.id,
  lmu.original_filename,
  lmu.folder_id,
  cf.name as pasta_nome,
  lmu.created_at
FROM lead_media_unified lmu
LEFT JOIN company_folders cf ON cf.id = lmu.folder_id
WHERE lmu.company_id = 'acc99d3d-9def-4b93-aeb2-133be5f15413'
ORDER BY lmu.created_at DESC;

-- 4. VERIFICAR PASTA ESPECÍFICA (Teste)
SELECT 
  lmu.original_filename,
  lmu.folder_id,
  cf.name as pasta_atual
FROM lead_media_unified lmu
LEFT JOIN company_folders cf ON cf.id = lmu.folder_id
WHERE lmu.folder_id = '0112c6dd-0211-44ea-91c0-49c0aa967fec'
ORDER BY lmu.original_filename;

-- =====================================================
-- POSSÍVEL CORREÇÃO (EXECUTAR APENAS APÓS CONFIRMAR)
-- =====================================================
-- Se os arquivos "antes*.jpeg" estiverem na pasta errada,
-- descomentar e executar após identificar o folder_id correto:

-- UPDATE lead_media_unified
-- SET folder_id = '[ID_CORRETO_PASTA_ANTES_E_DEPOIS]'
-- WHERE original_filename LIKE 'antes%'
--   AND company_id = 'acc99d3d-9def-4b93-aeb2-133be5f15413';
