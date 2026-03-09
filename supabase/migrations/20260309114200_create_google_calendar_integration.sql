-- =====================================================
-- MIGRATION: Google Calendar Integration
-- Data: 2026-03-09
-- Objetivo: Tabelas para integração e sincronização com Google Calendar
-- =====================================================

-- Tabela: google_calendar_connections
-- Armazena conexões OAuth2 dos usuários com Google Calendar
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Tokens OAuth2 (serão criptografados na aplicação)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  
  -- Informações do calendário Google
  google_calendar_id VARCHAR(255) DEFAULT 'primary',
  google_email VARCHAR(255),
  
  -- Webhook channel para push notifications
  channel_id VARCHAR(64),
  channel_resource_id VARCHAR(255),
  channel_expiration TIMESTAMPTZ,
  
  -- Status e controle
  is_active BOOLEAN DEFAULT true,
  sync_enabled BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  
  -- Auditoria
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_user_google_connection UNIQUE(user_id)
);

-- Tabela: activity_google_mapping
-- Mapeia atividades do sistema com eventos do Google Calendar
CREATE TABLE IF NOT EXISTS activity_google_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES lead_activities(id) ON DELETE CASCADE,
  google_event_id VARCHAR(255) NOT NULL,
  connection_id UUID NOT NULL REFERENCES google_calendar_connections(id) ON DELETE CASCADE,
  
  -- Controle de sincronização
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  google_updated_at TIMESTAMPTZ,
  system_updated_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT unique_activity_google_mapping UNIQUE(activity_id, connection_id)
);

-- Tabela: google_calendar_sync_log
-- Log de todas as sincronizações para auditoria e debug
CREATE TABLE IF NOT EXISTS google_calendar_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES google_calendar_connections(id) ON DELETE CASCADE,
  
  -- Evento
  activity_id UUID REFERENCES lead_activities(id) ON DELETE SET NULL,
  google_event_id VARCHAR(255),
  
  -- Tipo de sincronização
  sync_direction VARCHAR(20) NOT NULL, -- 'to_google' | 'from_google'
  sync_action VARCHAR(20) NOT NULL, -- 'create' | 'update' | 'delete'
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'success' | 'error' | 'pending'
  error_message TEXT,
  
  -- Timestamp
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_google_connections_user ON google_calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_google_connections_company ON google_calendar_connections(company_id);
CREATE INDEX IF NOT EXISTS idx_google_connections_active ON google_calendar_connections(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_activity_google_mapping_activity ON activity_google_mapping(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_google_mapping_google_event ON activity_google_mapping(google_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_google_mapping_connection ON activity_google_mapping(connection_id);

CREATE INDEX IF NOT EXISTS idx_google_sync_log_connection ON google_calendar_sync_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_google_sync_log_activity ON google_calendar_sync_log(activity_id);
CREATE INDEX IF NOT EXISTS idx_google_sync_log_status ON google_calendar_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_google_sync_log_synced_at ON google_calendar_sync_log(synced_at DESC);

-- Habilitar RLS
ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_google_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_sync_log ENABLE ROW LEVEL SECURITY;

-- Policies: google_calendar_connections
CREATE POLICY "Users can view their own Google connections"
  ON google_calendar_connections FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own Google connections"
  ON google_calendar_connections FOR ALL
  USING (user_id = auth.uid());

-- Policies: activity_google_mapping
CREATE POLICY "Users can view their activity mappings"
  ON activity_google_mapping FOR SELECT
  USING (
    connection_id IN (
      SELECT id FROM google_calendar_connections WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their activity mappings"
  ON activity_google_mapping FOR ALL
  USING (
    connection_id IN (
      SELECT id FROM google_calendar_connections WHERE user_id = auth.uid()
    )
  );

-- Policies: google_calendar_sync_log
CREATE POLICY "Users can view their sync logs"
  ON google_calendar_sync_log FOR SELECT
  USING (
    connection_id IN (
      SELECT id FROM google_calendar_connections WHERE user_id = auth.uid()
    )
  );

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_google_calendar_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_google_calendar_connections_updated_at
  BEFORE UPDATE ON google_calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_google_calendar_connections_updated_at();

-- Comentários para documentação
COMMENT ON TABLE google_calendar_connections IS 'Conexões OAuth2 dos usuários com Google Calendar';
COMMENT ON TABLE activity_google_mapping IS 'Mapeamento entre atividades do sistema e eventos do Google Calendar';
COMMENT ON TABLE google_calendar_sync_log IS 'Log de sincronizações para auditoria e debug';
