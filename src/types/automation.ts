// =====================================================
// TYPES: SISTEMA DE AUTOMAÇÃO (FLOW BUILDER)
// Data: 13/03/2026
// Objetivo: Types TypeScript para o sistema de automação
// =====================================================

// =====================================================
// INTERFACES PRINCIPAIS
// =====================================================

export interface AutomationFlow {
  id: string
  company_id: string
  name: string
  description?: string
  category?: string
  
  // Definição do Fluxo
  nodes: FlowNode[]
  edges: FlowEdge[]
  variables?: Record<string, any>
  
  // Configuração do Gatilho
  trigger_type: string
  trigger_config?: Record<string, any>
  
  // Controle
  is_active: boolean
  
  // Limites
  max_executions_per_day?: number
  max_executions_per_lead?: number
  
  // Horário de Funcionamento
  business_hours_only: boolean
  allowed_days_of_week?: number[]
  start_time?: string
  end_time?: string
  
  // Estatísticas
  execution_count: number
  success_count: number
  error_count: number
  last_executed_at?: string
  
  // Auditoria
  created_by?: string
  created_at: string
  updated_at: string
}

export interface FlowNode {
  id: string
  type: 'trigger' | 'action' | 'condition' | 'message' | 'delay' | 'end' | 'distribution'
  position: { x: number; y: number }
  data: {
    label: string
    config: Record<string, any>
    icon?: string
    color?: string
  }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  animated?: boolean
  style?: React.CSSProperties
}

export interface AutomationExecution {
  id: string
  flow_id: string
  company_id: string
  
  // Contexto
  trigger_data: Record<string, any>
  lead_id?: number
  opportunity_id?: string
  
  // Estado
  status: 'running' | 'completed' | 'failed' | 'paused'
  current_node_id?: string
  
  // Dados
  variables?: Record<string, any>
  executed_nodes?: Array<{
    node_id: string
    executed_at: string
    status: string
    output?: any
  }>
  
  // Resultado
  error_message?: string
  error_node_id?: string
  
  // Timing
  started_at: string
  completed_at?: string
  paused_at?: string
  resume_at?: string
  duration_ms?: number
}

export interface AutomationLog {
  id: string
  execution_id: string
  flow_id: string
  company_id: string
  
  // Detalhes
  node_id: string
  node_type: string
  action: string
  
  // Resultado
  status: 'success' | 'error' | 'skipped'
  input_data?: Record<string, any>
  output_data?: Record<string, any>
  error_message?: string
  
  // Timing
  executed_at: string
  duration_ms?: number
}

export interface AutomationSchedule {
  id: string
  flow_id: string
  execution_id?: string
  company_id: string
  
  // Agendamento
  scheduled_for: string
  trigger_data: Record<string, any>
  
  // Status
  status: 'pending' | 'executed' | 'cancelled'
  executed_at?: string
  
  // Referência
  entity_type?: string
  entity_id?: string
  
  created_at: string
}

export interface AutomationTemplate {
  id: string
  company_id?: string
  
  // Identificação
  name: string
  description?: string
  category?: string
  
  // Template
  nodes: FlowNode[]
  edges: FlowEdge[]
  trigger_type: string
  trigger_config?: Record<string, any>
  
  // Controle
  is_public: boolean
  is_system: boolean
  
  // Estatísticas
  usage_count: number
  rating?: number
  
  // Metadados
  tags?: string[]
  preview_image_url?: string
  
  created_at: string
  updated_at: string
}

// =====================================================
// TYPES PARA FORMULÁRIOS
// =====================================================

export interface CreateFlowForm {
  name: string
  description?: string
  category?: string
  trigger_type: string
  trigger_config?: Record<string, any>
}

export interface UpdateFlowForm {
  name?: string
  description?: string
  category?: string
  is_active?: boolean
  max_executions_per_day?: number
  max_executions_per_lead?: number
  business_hours_only?: boolean
  allowed_days_of_week?: number[]
  start_time?: string
  end_time?: string
}

export interface SaveFlowForm {
  nodes: FlowNode[]
  edges: FlowEdge[]
  variables?: Record<string, any>
}

// =====================================================
// TYPES PARA API RESPONSES
// =====================================================

export interface AutomationApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface FlowsResponse extends AutomationApiResponse {
  data?: AutomationFlow[]
}

export interface FlowResponse extends AutomationApiResponse {
  data?: AutomationFlow
}

export interface ExecutionsResponse extends AutomationApiResponse {
  data?: AutomationExecution[]
}

export interface ExecutionResponse extends AutomationApiResponse {
  data?: AutomationExecution
}

export interface LogsResponse extends AutomationApiResponse {
  data?: AutomationLog[]
}

export interface TemplatesResponse extends AutomationApiResponse {
  data?: AutomationTemplate[]
}

export interface TemplateResponse extends AutomationApiResponse {
  data?: AutomationTemplate
}

// =====================================================
// TYPES PARA CONFIGURAÇÃO DE BLOCOS
// =====================================================

export interface TriggerConfig {
  type: 'lead.created' | 'message.received' | 'opportunity.created' | 'opportunity.stage_changed' | 'tag.added' | 'schedule.time'
  filters?: {
    source?: string[]
    tags?: string[]
    funnel_id?: string
    stage_id?: string
    from_stage_id?: string
    to_stage_id?: string
    min_value?: number
    max_value?: number
    contains_keyword?: string[]
    business_hours_only?: boolean
    time?: string
    days_of_week?: number[]
  }
}

export interface MessageConfig {
  message: string
  media_type?: 'image' | 'video' | 'audio' | 'document'
  media_url?: string
  caption?: string
  buttons?: Array<{
    id: string
    text: string
    action: 'reply' | 'url' | 'call'
    value: string
  }>
  variables?: boolean
  save_to_history?: boolean
}

export interface ActionConfig {
  action_type: 'create_opportunity' | 'move_opportunity' | 'create_activity' | 'update_lead' | 'add_tag' | 'remove_tag' | 'assign_owner'
  params: Record<string, any>
}

export interface ConditionConfig {
  conditions: Array<{
    field: string
    operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty'
    value: any
    logic?: 'AND' | 'OR'
  }>
}

export interface DelayConfig {
  duration: number
  unit: 'minutes' | 'hours' | 'days'
  business_hours_only?: boolean
}

export interface DistributionConfig {
  method: 'round_robin' | 'availability' | 'workload' | 'region'
  users?: string[]
  skip_unavailable?: boolean
  max_leads_per_user?: number
  check_online_status?: boolean
  region_mappings?: Array<{
    region: string
    user_id: string
  }>
  default_user_id?: string
}

// =====================================================
// TYPES PARA HOOKS
// =====================================================

export interface UseAutomationFlowsReturn {
  flows: AutomationFlow[]
  loading: boolean
  error?: string
  selectedFlow?: AutomationFlow
  setSelectedFlow: (flowId: string) => void
  createFlow: (data: CreateFlowForm) => Promise<AutomationFlow>
  updateFlow: (id: string, data: UpdateFlowForm) => Promise<AutomationFlow>
  deleteFlow: (id: string) => Promise<void>
  saveFlowCanvas: (id: string, data: SaveFlowForm) => Promise<AutomationFlow>
  toggleFlowActive: (id: string, isActive: boolean) => Promise<void>
  refreshFlows: () => Promise<void>
}

export interface UseExecutionHistoryReturn {
  executions: AutomationExecution[]
  loading: boolean
  error?: string
  filters: {
    flow_id?: string
    status?: string
    lead_id?: number
    from_date?: string
    to_date?: string
  }
  setFilters: (filters: any) => void
  refreshExecutions: () => Promise<void>
}

export interface UseAutomationLogsReturn {
  logs: AutomationLog[]
  loading: boolean
  error?: string
  refreshLogs: () => Promise<void>
}

// =====================================================
// CONSTANTES
// =====================================================

export const AUTOMATION_CONSTANTS = {
  TRIGGER_TYPES: {
    LEAD_CREATED: 'lead.created',
    MESSAGE_RECEIVED: 'message.received',
    OPPORTUNITY_CREATED: 'opportunity.created',
    OPPORTUNITY_STAGE_CHANGED: 'opportunity.stage_changed',
    TAG_ADDED: 'tag.added',
    SCHEDULE_TIME: 'schedule.time'
  } as const,
  
  NODE_TYPES: {
    TRIGGER: 'trigger',
    ACTION: 'action',
    CONDITION: 'condition',
    MESSAGE: 'message',
    DELAY: 'delay',
    END: 'end',
    DISTRIBUTION: 'distribution'
  } as const,
  
  EXECUTION_STATUS: {
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    PAUSED: 'paused'
  } as const,
  
  LOG_STATUS: {
    SUCCESS: 'success',
    ERROR: 'error',
    SKIPPED: 'skipped'
  } as const,
  
  NODE_COLORS: {
    trigger: '#10B981',    // Verde
    action: '#3B82F6',     // Azul
    condition: '#F59E0B',  // Amarelo
    message: '#8B5CF6',    // Roxo
    delay: '#F97316',      // Laranja
    end: '#EF4444',        // Vermelho
    distribution: '#06B6D4' // Ciano
  } as const
} as const

// =====================================================
// HELPERS
// =====================================================

export const getNodeColor = (type: FlowNode['type']): string => {
  return AUTOMATION_CONSTANTS.NODE_COLORS[type] || '#6B7280'
}

export const getNodeIcon = (type: FlowNode['type']): string => {
  const icons: Record<FlowNode['type'], string> = {
    trigger: '⚡',
    action: '🎯',
    condition: '❓',
    message: '💬',
    delay: '⏱️',
    end: '🏁',
    distribution: '🔄'
  }
  return icons[type] || '📦'
}

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`
  return `${(ms / 3600000).toFixed(1)}h`
}

export const validateFlowName = (name: string): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Nome do fluxo é obrigatório' }
  }
  if (name.length > 255) {
    return { valid: false, error: 'Nome do fluxo deve ter no máximo 255 caracteres' }
  }
  return { valid: true }
}
