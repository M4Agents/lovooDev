-- =====================================================
-- MIGRATION: Tornar lead_id opcional em lead_activities
-- Data: 2026-03-09
-- Objetivo: Permitir eventos pessoais e integração Google Calendar
-- =====================================================

-- Tornar lead_id opcional (permitir NULL)
ALTER TABLE lead_activities 
ALTER COLUMN lead_id DROP NOT NULL;

-- Adicionar índice para performance em queries com lead_id
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id 
ON lead_activities(lead_id) 
WHERE lead_id IS NOT NULL;

-- Adicionar índice para eventos pessoais (sem lead)
CREATE INDEX IF NOT EXISTS idx_lead_activities_personal 
ON lead_activities(owner_user_id, scheduled_date) 
WHERE lead_id IS NULL;

-- Comentário para documentação
COMMENT ON COLUMN lead_activities.lead_id IS 'ID do lead associado (opcional - NULL para eventos pessoais)';
