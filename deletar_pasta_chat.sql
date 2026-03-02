-- =====================================================
-- DELETAR PASTA "CHAT" DO BANCO DE DADOS
-- =====================================================
-- Data: 2026-02-21 13:41
-- Projeto: M4_Digital (Supabase)
-- Motivo: Pasta Chat não deve aparecer no menu principal
-- A BibliotecaV2 do chat não depende desta pasta
--
-- INSTRUÇÕES:
-- 1. Acesse: https://supabase.com/dashboard/project/pnryfkjqelasemzhzgvl/sql
-- 2. Execute cada query abaixo SEPARADAMENTE
-- 3. Verifique os resultados de cada query
-- =====================================================

-- QUERY 1: Verificar se há arquivos na pasta Chat
-- Execute esta query primeiro para ver quantos arquivos existem
SELECT 
  cf.id as folder_id,
  cf.name,
  cf.path,
  cf.company_id,
  COUNT(cml.id) as file_count
FROM company_folders cf
LEFT JOIN company_media_library cml ON cml.folder_id = cf.id
WHERE cf.name = 'Chat'
GROUP BY cf.id, cf.name, cf.path, cf.company_id;

-- RESULTADO ESPERADO: 
-- Se file_count = 0, pode deletar com segurança
-- Se file_count > 0, os arquivos ficarão órfãos (sem pasta)

-- =====================================================

-- QUERY 2: Deletar a pasta Chat
-- Execute esta query para deletar a pasta
DELETE FROM company_folders 
WHERE name = 'Chat';

-- RESULTADO ESPERADO: 
-- "DELETE X" onde X é o número de pastas deletadas
-- Normalmente deve ser "DELETE 1"

-- =====================================================

-- QUERY 3: Verificar se foi deletada com sucesso
-- Execute esta query para confirmar que a pasta não existe mais
SELECT id, name, path, company_id 
FROM company_folders 
WHERE name = 'Chat';

-- RESULTADO ESPERADO: 
-- 0 registros (tabela vazia)
-- Se retornar algum registro, a pasta ainda existe

-- =====================================================
-- APÓS EXECUTAR:
-- 1. Recarregue a página da Biblioteca (F5)
-- 2. A pasta "Chat" não deve aparecer mais no menu lateral
-- 3. BibliotecaV2 do chat continuará funcionando normalmente
-- =====================================================
