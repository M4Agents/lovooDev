// =====================================================
// TYPES: SISTEMA DE FUNIL DE VENDAS (SALES PIPELINE)
// Data: 03/03/2026
// Objetivo: Types TypeScript para o sistema de funil
// =====================================================

// =====================================================
// INTERFACES PRINCIPAIS
// =====================================================

export interface SalesFunnel {
  id: string
  company_id: string
  name: string
  description?: string
  is_default: boolean
  is_active: boolean
  created_by?: string
  created_at: Date
  updated_at: Date
  stages?: FunnelStage[]
  lead_count?: number
  total_value?: number
}

export interface FunnelStage {
  id: string
  funnel_id: string
  name: string
  description?: string
  color: string
  position: number
  is_system_stage: boolean
  stage_type: 'active' | 'won' | 'lost'
  created_at: Date
  updated_at: Date
  lead_count?: number
  total_value?: number
}

// =====================================================
// INTERFACE: Opportunity (NOVO MODELO)
// =====================================================

export interface Opportunity {
  id: string
  lead_id: number
  company_id: string
  title: string
  description?: string
  value: number
  currency: string
  status: 'open' | 'won' | 'lost'
  probability: number
  expected_close_date?: string
  actual_close_date?: string
  source?: string
  owner_user_id?: string
  created_at: string
  updated_at: string
  closed_at?: string
  
  // Joins
  lead?: LeadCardData
}

// =====================================================
// INTERFACE: OpportunityFunnelPosition (RENOMEADO)
// =====================================================

export interface OpportunityFunnelPosition {
  id: string
  opportunity_id: string
  lead_id: number  // Mantido temporariamente para compatibilidade
  funnel_id: string
  stage_id: string
  position_in_stage: number
  entered_stage_at?: Date
  updated_at: Date
  
  // Joins
  opportunity?: Opportunity
  lead?: LeadCardData
  stage?: FunnelStage
  days_in_stage?: number
}

// Alias para compatibilidade (DEPRECATED)
export type LeadFunnelPosition = OpportunityFunnelPosition

export interface OpportunityStageHistory {
  id: string
  opportunity_id: string
  lead_id: number  // Mantido para compatibilidade
  funnel_id: string
  from_stage_id?: string
  to_stage_id: string
  moved_by?: string
  moved_at: Date
  notes?: string
  from_stage?: FunnelStage
  to_stage?: FunnelStage
}

// Alias para compatibilidade (DEPRECATED)
export type LeadStageHistory = OpportunityStageHistory

export interface LeadCardFieldPreference {
  id: string
  company_id: string
  user_id?: string
  visible_fields: string[]
  created_at: Date
  updated_at: Date
}

// =====================================================
// INTERFACE: LeadCardData
// Dados do lead para exibição no card do Kanban
// =====================================================

export interface LeadCardData {
  id: number
  name: string
  email?: string
  phone?: string
  company_name?: string
  profile_picture_url?: string
  tags?: string[]
  deal_value?: number
  created_at: Date
  origin?: string
  status?: string
  record_type?: string
  days_in_stage?: number
  last_contact_at?: Date
}

// =====================================================
// TYPES PARA FORMULÁRIOS
// =====================================================

export interface CreateFunnelForm {
  name: string
  description?: string
  is_default?: boolean
  is_active?: boolean
}

export interface UpdateFunnelForm {
  name?: string
  description?: string
  is_default?: boolean
  is_active?: boolean
}

export interface CreateStageForm {
  funnel_id: string
  name: string
  description?: string
  color: string
  position: number
  stage_type?: 'active' | 'won' | 'lost'
}

export interface UpdateStageForm {
  name?: string
  description?: string
  color?: string
  position?: number
  stage_type?: 'active' | 'won' | 'lost'
}

export interface MoveLeadForm {
  lead_id: number
  funnel_id: string
  from_stage_id: string
  to_stage_id: string
  position_in_stage: number
  notes?: string
}

// =====================================================
// FORMS PARA OPORTUNIDADES (NOVO)
// =====================================================

export interface CreateOpportunityForm {
  lead_id: number
  company_id: string
  title: string
  description?: string
  value?: number
  currency?: string
  probability?: number
  expected_close_date?: string
  source?: string
  owner_user_id?: string
}

export interface UpdateOpportunityForm {
  title?: string
  description?: string
  value?: number
  currency?: string
  status?: 'open' | 'won' | 'lost'
  probability?: number
  expected_close_date?: string
  actual_close_date?: string
  owner_user_id?: string
}

export interface MoveOpportunityForm {
  opportunity_id: string
  funnel_id: string
  from_stage_id: string
  to_stage_id: string
  position_in_stage: number
  notes?: string
}

export interface UpdateCardFieldsForm {
  visible_fields: string[]
}

// =====================================================
// TYPES PARA DRAG & DROP
// =====================================================

export interface DragDropResult {
  draggableId: string
  type: string
  source: {
    droppableId: string
    index: number
  }
  destination?: {
    droppableId: string
    index: number
  }
}

export interface DragDropContext {
  onDragStart?: (result: DragDropResult) => void
  onDragUpdate?: (result: DragDropResult) => void
  onDragEnd: (result: DragDropResult) => Promise<void>
}

// =====================================================
// TYPES PARA API RESPONSES
// =====================================================

export interface FunnelApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface FunnelsResponse extends FunnelApiResponse {
  data?: SalesFunnel[]
}

export interface FunnelResponse extends FunnelApiResponse {
  data?: SalesFunnel
}

export interface StagesResponse extends FunnelApiResponse {
  data?: FunnelStage[]
}

export interface StageResponse extends FunnelApiResponse {
  data?: FunnelStage
}

// Responses para Oportunidades (NOVO)
export interface OpportunitiesResponse extends FunnelApiResponse {
  data?: Opportunity[]
}

export interface OpportunityResponse extends FunnelApiResponse {
  data?: Opportunity
}

export interface OpportunityPositionsResponse extends FunnelApiResponse {
  data?: OpportunityFunnelPosition[]
}

export interface OpportunityPositionResponse extends FunnelApiResponse {
  data?: OpportunityFunnelPosition
}

// Aliases para compatibilidade (DEPRECATED)
export type LeadPositionsResponse = OpportunityPositionsResponse
export type LeadPositionResponse = OpportunityPositionResponse

export interface StageHistoryResponse extends FunnelApiResponse {
  data?: OpportunityStageHistory[]
}

export interface CardPreferencesResponse extends FunnelApiResponse {
  data?: LeadCardFieldPreference
}

// =====================================================
// TYPES PARA FILTROS E BUSCA
// =====================================================

export interface FunnelFilter {
  company_id: string
  is_active?: boolean
  search?: string
}

export interface StageFilter {
  funnel_id: string
  stage_type?: 'active' | 'won' | 'lost'
}

export interface LeadPositionFilter {
  funnel_id: string
  stage_id?: string
  search?: string
  tags?: string[]
  min_value?: number
  max_value?: number
}

export interface StageHistoryFilter {
  lead_id?: number
  funnel_id?: string
  from_date?: Date
  to_date?: Date
  limit?: number
}

// =====================================================
// TYPES PARA ESTATÍSTICAS
// =====================================================

export interface FunnelStats {
  funnel_id: string
  total_leads: number
  total_value: number
  conversion_rate: number
  average_time_per_stage: Record<string, number>
  stage_stats: StageStats[]
}

export interface StageStats {
  stage_id: string
  stage_name: string
  lead_count: number
  total_value: number
  average_time_in_stage: number
  conversion_to_next: number
}

// =====================================================
// CONSTANTES
// =====================================================

export const FUNNEL_CONSTANTS = {
  DEFAULT_COLORS: {
    leadNovo: '#FCD34D',      // Amarelo - Novo lead
    contato: '#86EFAC',       // Verde claro - Contato realizado
    diagnostico: '#93C5FD',   // Azul claro - Diagnóstico/Briefing
    proposta: '#C4B5FD',      // Roxo claro - Proposta enviada
    followUp: '#FCA5A5',      // Vermelho claro - Follow-up
    ganhou: '#10B981',        // Verde escuro - Fechado ganhou
    perdeu: '#EF4444'         // Vermelho - Fechado perdeu
  },
  
  DEFAULT_VISIBLE_FIELDS: [
    'photo',
    'name',
    'phone',
    'company',
    'tags'
  ],
  
  ALL_AVAILABLE_FIELDS: [
    'photo',
    'name',
    'email',
    'phone',
    'company',
    'tags',
    'deal_value',
    'probability',
    'origin',
    'status',
    'created_at',
    'last_contact_at'
  ],
  
  STAGE_TYPES: {
    ACTIVE: 'active',
    WON: 'won',
    LOST: 'lost'
  } as const,
  
  MAX_STAGES_PER_FUNNEL: 20,
  MIN_STAGES_PER_FUNNEL: 2,
  
  ROUTES: {
    MAIN: '/sales-funnel',
    FUNNEL: '/sales-funnel/:funnelId',
    SETTINGS: '/settings/funnels'
  }
} as const

// =====================================================
// GUARDS E VALIDAÇÕES
// =====================================================

export const isValidStageType = (type: string): type is FunnelStage['stage_type'] => {
  return ['active', 'won', 'lost'].includes(type)
}

export const isValidColor = (color: string): boolean => {
  return /^#[0-9A-Fa-f]{6}$/.test(color)
}

export const isValidFieldName = (field: string): boolean => {
  return FUNNEL_CONSTANTS.ALL_AVAILABLE_FIELDS.includes(field as any)
}

// =====================================================
// HELPERS DE COR
// =====================================================

export const getStageColorClass = (color: string): string => {
  return `bg-[${color}20] border-[${color}]`
}

export const getStageTypeColor = (type: FunnelStage['stage_type']): string => {
  switch (type) {
    case 'active':
      return '#3B82F6' // Azul
    case 'won':
      return '#10B981' // Verde
    case 'lost':
      return '#EF4444' // Vermelho
    default:
      return '#6B7280' // Cinza
  }
}

export const getStageTypeLabel = (type: FunnelStage['stage_type']): string => {
  switch (type) {
    case 'active':
      return 'Em Andamento'
    case 'won':
      return 'Ganho'
    case 'lost':
      return 'Perdido'
    default:
      return 'Desconhecido'
  }
}

// =====================================================
// HELPERS DE FORMATAÇÃO
// =====================================================

export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

export const formatDaysInStage = (days: number): string => {
  if (days === 0) return 'Hoje'
  if (days === 1) return '1 dia'
  if (days < 7) return `${days} dias`
  if (days < 30) return `${Math.floor(days / 7)} semanas`
  return `${Math.floor(days / 30)} meses`
}

export const calculateDaysInStage = (enteredAt: Date): number => {
  const now = new Date()
  const entered = new Date(enteredAt)
  const diffTime = Math.abs(now.getTime() - entered.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}

// =====================================================
// HELPERS DE VALIDAÇÃO
// =====================================================

export const validateFunnelName = (name: string): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Nome do funil é obrigatório' }
  }
  if (name.length > 255) {
    return { valid: false, error: 'Nome do funil deve ter no máximo 255 caracteres' }
  }
  return { valid: true }
}

export const validateStageName = (name: string): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Nome da etapa é obrigatório' }
  }
  if (name.length > 255) {
    return { valid: false, error: 'Nome da etapa deve ter no máximo 255 caracteres' }
  }
  return { valid: true }
}

export const validateStageColor = (color: string): { valid: boolean; error?: string } => {
  if (!isValidColor(color)) {
    return { valid: false, error: 'Cor inválida. Use formato hexadecimal (#RRGGBB)' }
  }
  return { valid: true }
}

// =====================================================
// TYPES PARA COMPONENTES
// =====================================================

export interface FunnelBoardProps {
  funnelId: string
  companyId: string
}

export interface FunnelColumnProps {
  stage: FunnelStage
  leads: LeadFunnelPosition[]
  onLeadClick?: (leadId: number) => void
  onAddLead?: (stageId: string) => void
}

export interface LeadCardProps {
  position: LeadFunnelPosition
  index: number
  visibleFields?: string[]
  onClick?: (leadId: number) => void
}

export interface FunnelSelectorProps {
  funnels: SalesFunnel[]
  selectedFunnelId?: string
  onSelectFunnel: (funnelId: string) => void
  onCreateFunnel?: () => void
}

export interface CreateFunnelModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateFunnelForm) => Promise<void>
}

export interface EditStageModalProps {
  isOpen: boolean
  stage?: FunnelStage
  onClose: () => void
  onSubmit: (data: CreateStageForm | UpdateStageForm) => Promise<void>
}

export interface LeadCardCustomizerProps {
  isOpen: boolean
  currentFields: string[]
  onClose: () => void
  onSave: (fields: string[]) => Promise<void>
}

// =====================================================
// TYPES PARA HOOKS
// =====================================================

export interface UseFunnelsReturn {
  funnels: SalesFunnel[]
  loading: boolean
  error?: string
  selectedFunnel?: SalesFunnel
  setSelectedFunnel: (funnelId: string) => void
  createFunnel: (data: CreateFunnelForm) => Promise<SalesFunnel>
  updateFunnel: (id: string, data: UpdateFunnelForm) => Promise<SalesFunnel>
  deleteFunnel: (id: string) => Promise<void>
  refreshFunnels: () => Promise<void>
}

export interface UseFunnelStagesReturn {
  stages: FunnelStage[]
  loading: boolean
  error?: string
  createStage: (data: CreateStageForm) => Promise<FunnelStage>
  updateStage: (id: string, data: UpdateStageForm) => Promise<FunnelStage>
  deleteStage: (id: string) => Promise<void>
  reorderStages: (stageIds: string[]) => Promise<void>
  refreshStages: () => Promise<void>
}

export interface UseLeadPositionsReturn {
  positions: LeadFunnelPosition[]
  loading: boolean
  error?: string
  moveLeadToStage: (leadId: number, toStageId: string, position: number) => Promise<void>
  addLeadToFunnel: (leadId: number, funnelId: string) => Promise<void>
  removeLeadFromFunnel: (leadId: number, funnelId: string) => Promise<void>
  refreshPositions: () => Promise<void>
}

export interface UseStageHistoryReturn {
  history: LeadStageHistory[]
  loading: boolean
  error?: string
  refreshHistory: () => Promise<void>
}

export interface UseCardPreferencesReturn {
  preferences?: LeadCardFieldPreference
  loading: boolean
  error?: string
  updatePreferences: (fields: string[]) => Promise<void>
  refreshPreferences: () => Promise<void>
}
