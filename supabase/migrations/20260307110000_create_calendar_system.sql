-- =====================================================
-- MIGRATION: Sistema de Calendário com Controle de Permissões
-- Data: 2026-03-07
-- Descrição: Implementa sistema de calendário individual por usuário
--            com controle de permissões de visualização entre usuários
-- =====================================================

-- =====================================================
-- TABELA: lead_activities
-- Descrição: Atividades agendadas com leads
-- =====================================================
CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Informações da Atividade
  title VARCHAR(255) NOT NULL,
  description TEXT,
  activity_type VARCHAR(50) NOT NULL DEFAULT 'task',
  
  -- Agendamento
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  scheduled_datetime TIMESTAMPTZ GENERATED ALWAYS AS (
    (scheduled_date::text || ' ' || scheduled_time::text)::timestamptz
  ) STORED,
  duration_minutes INTEGER DEFAULT 30,
  
  -- Status e Conclusão
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  completion_notes TEXT,
  
  -- Dono do Calendário (quem possui a atividade)
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Responsável pela Execução (pode ser diferente do dono)
  assigned_to UUID REFERENCES auth.users(id),
  
  -- Criador da Atividade
  created_by UUID NOT NULL REFERENCES auth.users(id),
  
  -- Notificações e Lembretes
  reminder_minutes INTEGER DEFAULT 15,
  notification_sent BOOLEAN DEFAULT FALSE,
  
  -- Prioridade
  priority VARCHAR(20) DEFAULT 'medium',
  
  -- Visibilidade
  visibility VARCHAR(20) DEFAULT 'private',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_scheduled_datetime CHECK (scheduled_datetime >= NOW()),
  CONSTRAINT valid_duration CHECK (duration_minutes > 0),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT valid_activity_type CHECK (activity_type IN ('call', 'meeting', 'email', 'task', 'follow_up', 'demo', 'other')),
  CONSTRAINT valid_visibility CHECK (visibility IN ('private', 'shared', 'public'))
);

-- Índices para performance
CREATE INDEX idx_lead_activities_company ON lead_activities(company_id);
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX idx_lead_activities_owner ON lead_activities(owner_user_id);
CREATE INDEX idx_lead_activities_assigned ON lead_activities(assigned_to);
CREATE INDEX idx_lead_activities_date ON lead_activities(scheduled_date);
CREATE INDEX idx_lead_activities_datetime ON lead_activities(scheduled_datetime);
CREATE INDEX idx_lead_activities_status ON lead_activities(status);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_lead_activities_updated_at
  BEFORE UPDATE ON lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TABELA: calendar_permissions
-- Descrição: Controle de quem pode visualizar a agenda de quem
-- =====================================================
CREATE TABLE IF NOT EXISTS calendar_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Dono do calendário (quem está compartilhando)
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Usuário que recebe permissão (quem pode visualizar)
  viewer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Nível de Permissão
  permission_level VARCHAR(20) NOT NULL DEFAULT 'view',
  
  -- Concedido por (quem deu a permissão)
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_calendar_permission UNIQUE(owner_user_id, viewer_user_id),
  CONSTRAINT no_self_permission CHECK (owner_user_id != viewer_user_id),
  CONSTRAINT valid_permission_level CHECK (permission_level IN ('view', 'edit', 'manage'))
);

-- Índices
CREATE INDEX idx_calendar_permissions_owner ON calendar_permissions(owner_user_id);
CREATE INDEX idx_calendar_permissions_viewer ON calendar_permissions(viewer_user_id);
CREATE INDEX idx_calendar_permissions_company ON calendar_permissions(company_id);
CREATE INDEX idx_calendar_permissions_active ON calendar_permissions(is_active);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_calendar_permissions_updated_at
  BEFORE UPDATE ON calendar_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TABELA: calendar_settings
-- Descrição: Configurações pessoais do calendário de cada usuário
-- =====================================================
CREATE TABLE IF NOT EXISTS calendar_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Configurações de Visualização
  default_view VARCHAR(20) DEFAULT 'month',
  start_hour INTEGER DEFAULT 8,
  end_hour INTEGER DEFAULT 20,
  
  -- Configurações de Notificação
  default_reminder_minutes INTEGER DEFAULT 15,
  enable_email_notifications BOOLEAN DEFAULT TRUE,
  enable_push_notifications BOOLEAN DEFAULT TRUE,
  
  -- Configurações de Compartilhamento
  allow_auto_share BOOLEAN DEFAULT FALSE,
  default_visibility VARCHAR(20) DEFAULT 'private',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_user_calendar_settings UNIQUE(user_id, company_id),
  CONSTRAINT valid_default_view CHECK (default_view IN ('month', 'week', 'agenda', 'day')),
  CONSTRAINT valid_default_visibility CHECK (default_visibility IN ('private', 'shared', 'public')),
  CONSTRAINT valid_hours CHECK (start_hour >= 0 AND start_hour < 24 AND end_hour > start_hour AND end_hour <= 24)
);

-- Índices
CREATE INDEX idx_calendar_settings_user ON calendar_settings(user_id);
CREATE INDEX idx_calendar_settings_company ON calendar_settings(company_id);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_calendar_settings_updated_at
  BEFORE UPDATE ON calendar_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- RLS POLICIES - LEAD_ACTIVITIES
-- =====================================================

-- Habilitar RLS
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- 1. Usuário sempre pode ver suas próprias atividades
CREATE POLICY "Users can view their own activities"
  ON lead_activities
  FOR SELECT
  USING (owner_user_id = auth.uid());

-- 2. Usuário pode ver atividades compartilhadas com ele
CREATE POLICY "Users can view shared activities"
  ON lead_activities
  FOR SELECT
  USING (
    visibility IN ('shared', 'public')
    AND EXISTS (
      SELECT 1 FROM calendar_permissions
      WHERE owner_user_id = lead_activities.owner_user_id
        AND viewer_user_id = auth.uid()
        AND is_active = TRUE
    )
  );

-- 3. Usuário pode ver atividades públicas da empresa
CREATE POLICY "Users can view public activities"
  ON lead_activities
  FOR SELECT
  USING (
    visibility = 'public' 
    AND company_id IN (
      SELECT company_id FROM user_companies WHERE user_id = auth.uid()
    )
  );

-- 4. Usuário pode criar atividades no seu calendário
CREATE POLICY "Users can create their own activities"
  ON lead_activities
  FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM user_companies WHERE user_id = auth.uid()
    )
  );

-- 5. Usuário pode editar suas próprias atividades
CREATE POLICY "Users can update their own activities"
  ON lead_activities
  FOR UPDATE
  USING (owner_user_id = auth.uid());

-- 6. Usuário pode editar atividades se tem permissão 'edit' ou 'manage'
CREATE POLICY "Users can update shared activities with edit permission"
  ON lead_activities
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM calendar_permissions
      WHERE owner_user_id = lead_activities.owner_user_id
        AND viewer_user_id = auth.uid()
        AND permission_level IN ('edit', 'manage')
        AND is_active = TRUE
    )
  );

-- 7. Usuário pode deletar suas próprias atividades
CREATE POLICY "Users can delete their own activities"
  ON lead_activities
  FOR DELETE
  USING (owner_user_id = auth.uid());

-- =====================================================
-- RLS POLICIES - CALENDAR_PERMISSIONS
-- =====================================================

-- Habilitar RLS
ALTER TABLE calendar_permissions ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver permissões onde ele é o dono
CREATE POLICY "Users can view their own permissions"
  ON calendar_permissions
  FOR SELECT
  USING (owner_user_id = auth.uid());

-- Usuário pode ver permissões onde ele é o viewer
CREATE POLICY "Users can view permissions granted to them"
  ON calendar_permissions
  FOR SELECT
  USING (viewer_user_id = auth.uid());

-- Usuário pode criar permissões para seu próprio calendário
CREATE POLICY "Users can create permissions for their calendar"
  ON calendar_permissions
  FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM user_companies WHERE user_id = auth.uid()
    )
  );

-- Usuário pode atualizar permissões do seu calendário
CREATE POLICY "Users can update their own permissions"
  ON calendar_permissions
  FOR UPDATE
  USING (owner_user_id = auth.uid());

-- Usuário pode deletar permissões do seu calendário
CREATE POLICY "Users can delete their own permissions"
  ON calendar_permissions
  FOR DELETE
  USING (owner_user_id = auth.uid());

-- =====================================================
-- RLS POLICIES - CALENDAR_SETTINGS
-- =====================================================

-- Habilitar RLS
ALTER TABLE calendar_settings ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver suas próprias configurações
CREATE POLICY "Users can view their own settings"
  ON calendar_settings
  FOR SELECT
  USING (user_id = auth.uid());

-- Usuário pode criar suas próprias configurações
CREATE POLICY "Users can create their own settings"
  ON calendar_settings
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM user_companies WHERE user_id = auth.uid()
    )
  );

-- Usuário pode atualizar suas próprias configurações
CREATE POLICY "Users can update their own settings"
  ON calendar_settings
  FOR UPDATE
  USING (user_id = auth.uid());

-- Usuário pode deletar suas próprias configurações
CREATE POLICY "Users can delete their own settings"
  ON calendar_settings
  FOR DELETE
  USING (user_id = auth.uid());

-- =====================================================
-- COMENTÁRIOS NAS TABELAS
-- =====================================================

COMMENT ON TABLE lead_activities IS 'Atividades agendadas com leads - cada usuário tem seu calendário individual';
COMMENT ON TABLE calendar_permissions IS 'Controle de permissões de visualização entre calendários de usuários';
COMMENT ON TABLE calendar_settings IS 'Configurações pessoais do calendário de cada usuário';

COMMENT ON COLUMN lead_activities.owner_user_id IS 'Dono do calendário - usuário que possui a atividade';
COMMENT ON COLUMN lead_activities.assigned_to IS 'Responsável pela execução - pode ser diferente do dono';
COMMENT ON COLUMN lead_activities.visibility IS 'Controle de visibilidade: private, shared ou public';
COMMENT ON COLUMN calendar_permissions.permission_level IS 'Nível de acesso: view (visualizar), edit (editar) ou manage (gerenciar)';
