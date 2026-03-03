-- =====================================================
-- SCRIPT: Corrigir UUIDs truncados na tabela funnel_stages
-- Data: 03/03/2026
-- Problema: UUIDs com 35, 36 ou 37 caracteres
-- Solução: Regenerar UUIDs válidos mantendo referências
-- =====================================================

-- IMPORTANTE: Execute este script no Supabase SQL Editor
-- Faça backup antes de executar!

-- 1. Verificar UUIDs inválidos
SELECT 
  id,
  name,
  LENGTH(id::text) as id_length,
  funnel_id
FROM funnel_stages
WHERE LENGTH(id::text) != 36
ORDER BY funnel_id, position;

-- 2. Criar tabela temporária para mapear IDs antigos -> novos
CREATE TEMP TABLE funnel_stages_id_mapping AS
SELECT 
  id as old_id,
  gen_random_uuid() as new_id,
  funnel_id,
  name
FROM funnel_stages
WHERE LENGTH(id::text) != 36;

-- 3. Atualizar referências em lead_funnel_positions
UPDATE lead_funnel_positions lfp
SET stage_id = m.new_id
FROM funnel_stages_id_mapping m
WHERE lfp.stage_id::text = m.old_id::text;

-- 4. Atualizar referências em lead_stage_history
UPDATE lead_stage_history lsh
SET 
  from_stage_id = COALESCE(m1.new_id, lsh.from_stage_id),
  to_stage_id = COALESCE(m2.new_id, lsh.to_stage_id)
FROM funnel_stages_id_mapping m1
LEFT JOIN funnel_stages_id_mapping m2 ON m2.old_id::text = lsh.to_stage_id::text
WHERE lsh.from_stage_id::text = m1.old_id::text;

-- 5. Atualizar IDs na tabela funnel_stages
UPDATE funnel_stages fs
SET id = m.new_id
FROM funnel_stages_id_mapping m
WHERE fs.id::text = m.old_id::text;

-- 6. Verificar se todos os UUIDs estão corretos agora
SELECT 
  id,
  name,
  LENGTH(id::text) as id_length,
  funnel_id
FROM funnel_stages
ORDER BY funnel_id, position;

-- 7. Verificar se há algum UUID com comprimento diferente de 36
SELECT COUNT(*) as invalid_uuids
FROM funnel_stages
WHERE LENGTH(id::text) != 36;

-- Se retornar 0, todos os UUIDs foram corrigidos com sucesso!
