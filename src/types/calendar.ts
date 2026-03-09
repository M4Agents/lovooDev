// =====================================================
// TIPOS PARA SISTEMA DE CALENDÁRIO
// =====================================================

export type ActivityType = 'call' | 'meeting' | 'email' | 'task' | 'follow_up' | 'demo' | 'other'
export type ActivityStatus = 'pending' | 'completed' | 'cancelled' | 'rescheduled'
export type ActivityPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ActivityVisibility = 'private' | 'shared' | 'public'
export type PermissionLevel = 'view' | 'edit' | 'manage'
export type CalendarView = 'month' | 'week' | 'agenda' | 'day'

// =====================================================
// INTERFACE: LeadActivity
// =====================================================
export interface LeadActivity {
  id: string
  company_id: string
  lead_id?: number
  
  // Informações da Atividade
  title: string
  description?: string
  activity_type: ActivityType
  
  // Agendamento
  scheduled_date: string // YYYY-MM-DD
  scheduled_time: string // HH:MM
  scheduled_datetime: Date
  duration_minutes: number
  
  // Status e Conclusão
  status: ActivityStatus
  completed_at?: Date
  completed_by?: string
  completion_notes?: string
  
  // Dono e Responsável
  owner_user_id: string
  assigned_to?: string
  created_by: string
  
  // Notificações
  reminder_minutes: number
  notification_sent: boolean
  
  // Prioridade e Visibilidade
  priority: ActivityPriority
  visibility: ActivityVisibility
  
  // Sincronização Google Calendar
  google_event_id?: string
  sync_to_google?: boolean
  last_synced_at?: Date
  
  // Timestamps
  created_at: Date
  updated_at: Date
  
  // Relacionamentos (populados via join)
  lead?: {
    id: number
    name: string
    phone?: string
    email?: string
    company_name?: string
  }
  owner_user?: {
    id: string
    email: string
    display_name?: string
  }
  assigned_user?: {
    id: string
    email: string
    display_name?: string
  }
}

// =====================================================
// INTERFACE: CalendarPermission
// =====================================================
export interface CalendarPermission {
  id: string
  company_id: string
  owner_user_id: string
  viewer_user_id: string
  permission_level: PermissionLevel
  granted_by: string
  is_active: boolean
  created_at: Date
  updated_at: Date
  
  // Relacionamentos
  viewer_user?: {
    id: string
    email: string
    display_name?: string
    profile_picture_url?: string
  }
  owner_user?: {
    id: string
    email: string
    display_name?: string
    profile_picture_url?: string
  }
}

// =====================================================
// INTERFACE: CalendarSettings
// =====================================================
export interface CalendarSettings {
  id: string
  user_id: string
  company_id: string
  
  // Visualização
  default_view: CalendarView
  start_hour: number
  end_hour: number
  
  // Notificações
  default_reminder_minutes: number
  enable_email_notifications: boolean
  enable_push_notifications: boolean
  
  // Compartilhamento
  allow_auto_share: boolean
  default_visibility: ActivityVisibility
  
  // Timestamps
  created_at: Date
  updated_at: Date
}

// =====================================================
// FORMULÁRIOS E INPUTS
// =====================================================

export interface CreateActivityForm {
  lead_id?: number | null
  title: string
  description?: string
  activity_type: ActivityType
  scheduled_date: string
  scheduled_time: string
  duration_minutes: number
  assigned_to?: string
  reminder_minutes: number
  priority: ActivityPriority
  visibility: ActivityVisibility
  sync_to_google?: boolean
}

export interface UpdateActivityForm {
  title?: string
  description?: string
  activity_type?: ActivityType
  scheduled_date?: string
  scheduled_time?: string
  duration_minutes?: number
  assigned_to?: string
  reminder_minutes?: number
  priority?: ActivityPriority
  visibility?: ActivityVisibility
  status?: ActivityStatus
}

export interface CompleteActivityForm {
  completion_notes?: string
}

export interface CreatePermissionForm {
  viewer_user_id: string
  permission_level: PermissionLevel
}

export interface UpdatePermissionForm {
  permission_level?: PermissionLevel
  is_active?: boolean
}

export interface UpdateSettingsForm {
  default_view?: CalendarView
  start_hour?: number
  end_hour?: number
  default_reminder_minutes?: number
  enable_email_notifications?: boolean
  enable_push_notifications?: boolean
  allow_auto_share?: boolean
  default_visibility?: ActivityVisibility
}

// =====================================================
// FILTROS E QUERIES
// =====================================================

export interface ActivityFilter {
  start_date?: Date
  end_date?: Date
  status?: ActivityStatus | ActivityStatus[]
  activity_type?: ActivityType | ActivityType[]
  priority?: ActivityPriority | ActivityPriority[]
  assigned_to?: string
  owner_user_id?: string
  lead_id?: number
  search?: string
}

export interface CalendarUser {
  id: string
  email: string
  display_name?: string
  profile_picture_url?: string
  permission?: PermissionLevel
  color?: string // Cor para exibição no calendário
  is_own?: boolean // Se é o calendário do próprio usuário
}

// =====================================================
// HELPERS E UTILITÁRIOS
// =====================================================

export interface ActivityTypeConfig {
  value: ActivityType
  label: string
  icon: string
  color: string
}

export interface PriorityConfig {
  value: ActivityPriority
  label: string
  icon: string
  color: string
}

export const ACTIVITY_TYPES: ActivityTypeConfig[] = [
  { value: 'call', label: 'Ligação', icon: '📞', color: 'blue' },
  { value: 'meeting', label: 'Reunião', icon: '🤝', color: 'green' },
  { value: 'email', label: 'Email', icon: '📧', color: 'purple' },
  { value: 'task', label: 'Tarefa', icon: '✓', color: 'gray' },
  { value: 'follow_up', label: 'Follow-up', icon: '🔄', color: 'orange' },
  { value: 'demo', label: 'Demonstração', icon: '🎯', color: 'indigo' },
  { value: 'other', label: 'Outro', icon: '📋', color: 'slate' }
]

export const PRIORITIES: PriorityConfig[] = [
  { value: 'low', label: 'Baixa', icon: '🟢', color: 'green' },
  { value: 'medium', label: 'Média', icon: '🟡', color: 'yellow' },
  { value: 'high', label: 'Alta', icon: '🟠', color: 'orange' },
  { value: 'urgent', label: 'Urgente', icon: '🔴', color: 'red' }
]

export const PERMISSION_LEVELS = [
  { value: 'view', label: 'Visualizar', icon: '👁️', description: 'Apenas visualizar atividades' },
  { value: 'edit', label: 'Editar', icon: '✏️', description: 'Visualizar e editar atividades' },
  { value: 'manage', label: 'Gerenciar', icon: '⚙️', description: 'Controle total sobre atividades' }
] as const

export const CALENDAR_VIEWS = [
  { value: 'month', label: 'Mês', icon: '📅' },
  { value: 'week', label: 'Semana', icon: '📆' },
  { value: 'day', label: 'Dia', icon: '📋' },
  { value: 'agenda', label: 'Agenda', icon: '📝' }
] as const

export const DURATION_OPTIONS = [
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
  { value: 45, label: '45 minutos' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
  { value: 180, label: '3 horas' }
]

export const REMINDER_OPTIONS = [
  { value: 0, label: 'Sem lembrete' },
  { value: 5, label: '5 minutos antes' },
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 1440, label: '1 dia antes' }
]

// Cores para calendários de diferentes usuários
export const USER_CALENDAR_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#84CC16'  // lime
]

// =====================================================
// CUSTOM ACTIVITY TYPES (Personalizáveis por empresa)
// =====================================================

export interface CustomActivityType {
  id: string
  company_id: string
  name: string
  icon: string
  color: string
  display_order: number
  is_active: boolean
  is_system: boolean
  created_by?: string
  created_at?: Date
  updated_at?: Date
}

// Ícones disponíveis para seleção (60+ ícones)
export const AVAILABLE_ICONS = [
  '✓', '📞', '📧', '📅', '🤝', '📋', '🎯', '🔄',
  '📱', '💼', '📊', '📈', '📉', '💰', '🏆', '⭐',
  '🔔', '⏰', '📍', '🏢', '🏠', '✈️', '🚗', '🚀',
  '💡', '🔧', '⚙️', '🔨', '📝', '📄', '📑', '📂',
  '📁', '📎', '🔗', '🔒', '🔓', '👤', '👥', '💬',
  '💭', '📢', '📣', '🎤', '🎧', '📷', '📹', '🎬',
  '🎨', '🖼️', '📚', '📖', '✏️', '✒️', '🖊️', '🖍️',
  '📐', '📏', '📌', '📍', '🎁', '🎉', '🎊', '🎈'
]
