-- =====================================================
-- MIGRATION: Adicionar suporte para sincronização Google Calendar
-- Data: 2026-03-09
-- Descrição: Adiciona campo google_event_id para rastrear eventos
--            sincronizados com Google Calendar
-- SEGURANÇA: Não-destrutivo, apenas adiciona campo opcional
-- =====================================================

-- Adicionar campo para armazenar ID do evento no Google Calendar
ALTER TABLE lead_activities 
ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255);

-- Adicionar campo para controlar se deve sincronizar
ALTER TABLE lead_activities 
ADD COLUMN IF NOT EXISTS sync_to_google BOOLEAN DEFAULT FALSE;

-- Adicionar campo para última sincronização
ALTER TABLE lead_activities 
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Índice para buscar eventos sincronizados
CREATE INDEX IF NOT EXISTS idx_lead_activities_google_event 
ON lead_activities(google_event_id) 
WHERE google_event_id IS NOT NULL;

-- Comentários para documentação
COMMENT ON COLUMN lead_activities.google_event_id IS 
'ID do evento no Google Calendar (se sincronizado)';

COMMENT ON COLUMN lead_activities.sync_to_google IS 
'Se TRUE, sincroniza automaticamente com Google Calendar';

COMMENT ON COLUMN lead_activities.last_synced_at IS 
'Timestamp da última sincronização bem-sucedida com Google Calendar';
