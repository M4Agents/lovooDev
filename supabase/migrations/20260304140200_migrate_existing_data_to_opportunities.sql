-- =====================================================
-- MIGRATION: Migrar dados existentes para modelo de oportunidades
-- Data: 04/03/2026
-- Descrição: Criar oportunidades para leads existentes em funis
-- =====================================================

-- =====================================================
-- PASSO 1: Criar oportunidades para todos os leads que estão em funis
-- =====================================================
INSERT INTO opportunities (
  lead_id,
  company_id,
  title,
  description,
  value,
  status,
  source,
  owner_user_id,
  created_at
)
SELECT DISTINCT
  l.id AS lead_id,
  l.company_id,
  'Oportunidade - ' || COALESCE(l.name, 'Sem nome') AS title,
  'Oportunidade criada automaticamente na migração do sistema' AS description,
  0 AS value,
  'open' AS status,
  l.origin AS source,
  l.responsible_user_id AS owner_user_id,
  COALESCE(l.created_at, now()) AS created_at
FROM leads l
INNER JOIN opportunity_funnel_positions ofp ON ofp.lead_id = l.id
WHERE ofp.opportunity_id IS NULL;

-- =====================================================
-- PASSO 2: Atualizar opportunity_funnel_positions com opportunity_id
-- =====================================================
UPDATE opportunity_funnel_positions ofp
SET opportunity_id = (
  SELECT o.id 
  FROM opportunities o 
  WHERE o.lead_id = ofp.lead_id 
  ORDER BY o.created_at ASC
  LIMIT 1
)
WHERE opportunity_id IS NULL;

-- =====================================================
-- PASSO 3: Verificar se há registros sem opportunity_id
-- =====================================================
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM opportunity_funnel_positions
  WHERE opportunity_id IS NULL;
  
  IF orphan_count > 0 THEN
    RAISE WARNING 'Existem % registros em opportunity_funnel_positions sem opportunity_id', orphan_count;
  ELSE
    RAISE NOTICE 'Migração concluída com sucesso! Todos os registros têm opportunity_id';
  END IF;
END $$;

-- =====================================================
-- PASSO 4: Criar constraint para garantir que opportunity_id seja obrigatório
-- (Comentado - será ativado após validação)
-- =====================================================
-- ALTER TABLE opportunity_funnel_positions
--   ALTER COLUMN opportunity_id SET NOT NULL;

-- =====================================================
-- PASSO 5: Criar constraint UNIQUE para evitar duplicatas
-- Uma oportunidade só pode estar em um funil por vez
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_opportunity_in_funnel 
  ON opportunity_funnel_positions(opportunity_id, funnel_id)
  WHERE opportunity_id IS NOT NULL;

-- =====================================================
-- COMENTÁRIOS
-- =====================================================
COMMENT ON COLUMN opportunity_funnel_positions.opportunity_id IS 'ID da oportunidade - obrigatório no novo modelo';
