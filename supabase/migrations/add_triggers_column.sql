-- =====================================================
-- MIGRATION: Adicionar coluna triggers para múltiplos gatilhos
-- Data: 16/03/2026
-- Objetivo: Permitir múltiplos gatilhos por fluxo de automação
-- =====================================================

-- Adicionar coluna triggers como JSONB array
ALTER TABLE automation_flows 
ADD COLUMN IF NOT EXISTS triggers JSONB DEFAULT '[]'::jsonb;

-- Criar índice para melhor performance em queries
CREATE INDEX IF NOT EXISTS idx_automation_flows_triggers 
ON automation_flows USING GIN (triggers);

-- Comentário na coluna
COMMENT ON COLUMN automation_flows.triggers IS 
'Array de gatilhos que podem disparar este fluxo. Estrutura: [{id, type, label, description, config, enabled}]';

-- Migrar dados existentes (se houver) de trigger_type para triggers[]
-- Apenas para fluxos que têm trigger_type diferente de 'pending' ou NULL
UPDATE automation_flows 
SET triggers = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', trigger_type,
    'label', CASE 
      WHEN trigger_type = 'lead.created' THEN 'Novo Lead Criado'
      WHEN trigger_type = 'message.received' THEN 'Mensagem Recebida'
      WHEN trigger_type = 'opportunity.created' THEN 'Oportunidade Criada'
      WHEN trigger_type = 'opportunity.stage_changed' THEN 'Mudança de Etapa'
      WHEN trigger_type = 'tag.added' THEN 'Tag Adicionada'
      WHEN trigger_type = 'schedule.time' THEN 'Horário Agendado'
      ELSE trigger_type
    END,
    'description', '',
    'config', COALESCE(trigger_config, '{}'::jsonb),
    'enabled', true
  )
)
WHERE trigger_type IS NOT NULL 
  AND trigger_type != 'pending'
  AND (triggers IS NULL OR triggers = '[]'::jsonb);
