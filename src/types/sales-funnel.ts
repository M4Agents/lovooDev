// =====================================================
// TYPES: SISTEMA DE FUNIL DE VENDAS (SALES PIPELINE)
// Data: 03/03/2026
// Objetivo: Types TypeScript para o sistema de funil
// =====================================================

import { formatMoney } from '../lib/formatMoney'

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
  display_order: number
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
  is_hidden?: boolean
  created_at: Date
  updated_at: Date
  lead_count?: number
  total_value?: number
}

// =====================================================
// INTERFACE: Opportunity (NOVO MODELO)
// =====================================================

export type OpportunityValueMode = 'manual' | 'items'
export type DiscountType = 'fixed' | 'percent'
export type CatalogAvailabilityStatus = 'available' | 'unavailable' | 'on_demand' | 'discontinued'
export type CatalogStockStatus = 'in_stock' | 'out_of_stock' | 'unknown' | 'not_applicable'

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
  loss_reason?: string

  /** Composição por itens (feature) */
  value_mode?: OpportunityValueMode
  items_subtotal?: number | null
  discount_type?: DiscountType | null
  discount_value?: number | null

  // Joins
  lead?: LeadCardData
}

export interface CatalogCategory {
  id: string
  company_id: string
  type: 'product' | 'service'
  name: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CatalogProduct {
  id: string
  company_id: string
  name: string
  description?: string | null
  default_price: number
  category_id?: string | null
  /** Resolvido via join: catalog_categories(name) — presente apenas quando a query inclui o join. */
  catalog_categories?: { name: string } | null
  is_active: boolean
  availability_status: CatalogAvailabilityStatus
  stock_status: CatalogStockStatus
  track_inventory: boolean
  ai_notes?: string | null
  /** Instrução interna para o agente de IA quando o item não estiver disponível; não é texto público. */
  ai_unavailable_guidance?: string | null
  available_for_ai: boolean
  /** Campos de integração externa — opcionais, não exibidos na listagem. */
  external_source?: string | null
  external_id?: string | null
  external_reference?: string | null
  created_at: string
  updated_at: string
}

export interface CatalogService {
  id: string
  company_id: string
  name: string
  description?: string | null
  default_price: number
  category_id?: string | null
  /** Resolvido via join: catalog_categories(name) — presente apenas quando a query inclui o join. */
  catalog_categories?: { name: string } | null
  is_active: boolean
  availability_status: CatalogAvailabilityStatus
  stock_status: CatalogStockStatus
  track_inventory: boolean
  ai_notes?: string | null
  /** Instrução interna para o agente de IA quando o item não estiver disponível; não é texto público. */
  ai_unavailable_guidance?: string | null
  available_for_ai: boolean
  /** Campos de integração externa — opcionais, não exibidos na listagem. */
  external_source?: string | null
  external_id?: string | null
  external_reference?: string | null
  created_at: string
  updated_at: string
}

/** Valores do ENUM Postgres `catalog_relation_type`. */
export type CatalogRelationType = 'alternative' | 'addon'

/** Constante para iteração / validação (ordem estável). */
export const CATALOG_RELATION_TYPES: readonly CatalogRelationType[] = ['alternative', 'addon']

/** Linha em `catalog_item_relations` (CRUD direto / inspeção). */
export interface CatalogItemRelation {
  id: string
  company_id: string
  relation_type: CatalogRelationType
  source_product_id: string | null
  source_service_id: string | null
  target_product_id: string | null
  target_service_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/** Retorno de `list_catalog_relations_for_source` — destino resolvido para UI/agente. */
export interface CatalogRelationResolvedRow {
  relation_id: string
  sort_order: number
  target_kind: 'product' | 'service'
  target_id: string
  name: string
  description: string | null
  availability_status: string
  is_active: boolean
  available_for_ai: boolean
  default_price: number
}

export interface OpportunityItemRow {
  id: string
  company_id: string
  opportunity_id: string
  product_id: string | null
  service_id: string | null
  line_type: 'product' | 'service'
  name_snapshot: string
  description_snapshot?: string | null
  unit_price: number
  quantity: number
  discount_type: DiscountType
  discount_value: number
  line_total: number
  created_at: string
  updated_at: string
}

// =====================================================
// INTERFACE: OpportunityStatusHistory
// Linha do tempo de transições de status.
// Fonte de verdade para relatórios históricos.
// =====================================================

export interface OpportunityStatusHistory {
  id: string
  opportunity_id: string
  company_id: string
  from_status?: 'open' | 'won' | 'lost'
  to_status: 'open' | 'won' | 'lost'
  value_snapshot?: number
  /** ISO 4217 no momento do snapshot; legado sem valor */
  currency_code?: string | null
  loss_reason?: string
  closed_at?: string
  changed_at: string
  changed_by?: string
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
  reentry_count?: number  // count de eventos lead_reentry — fornecido por get_funnel_positions_with_photos
}

// Alias para compatibilidade (DEPRECATED)
export type LeadFunnelPosition = OpportunityFunnelPosition

// =====================================================
// INTERFACE: OpportunityStageHistory
// Representa a tabela opportunity_stage_history.
// Cada linha = permanência em from_stage (etapa de origem).
// stage_entered_at / stage_left_at = janela temporal em from_stage.
// =====================================================

export interface OpportunityStageHistory {
  id: string
  company_id: string
  opportunity_id: string
  funnel_id: string

  // Transição
  from_stage_id?: string   // NULL = funnel_entry (sem etapa anterior)
  to_stage_id: string

  // Permanência em from_stage
  stage_entered_at: string  // quando entrou em from_stage
  stage_left_at: string     // quando saiu de from_stage
  duration_seconds: number  // coluna gerada (stage_left_at - stage_entered_at)

  // Rastreabilidade
  moved_by?: string
  move_type: 'funnel_entry' | 'stage_change' | 'won' | 'lost' | 'reopened' | 'lead_reentry'
  created_at: string
  metadata?: Record<string, unknown>

  // Joins opcionais
  from_stage?: FunnelStage
  to_stage?: FunnelStage
  funnel?: { id: string; name: string }
}

// Alias legado — mapeia para lead_stage_history (tabela antiga via trigger)
// Mantido apenas enquanto nenhuma área de oportunidades o consume diretamente
export interface LeadStageHistory {
  id: string
  lead_id: number
  funnel_id: string
  from_stage_id?: string
  to_stage_id: string
  moved_by?: string
  moved_at: Date
  notes?: string
  from_stage?: FunnelStage
  to_stage?: FunnelStage
}

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
  chat_conversations?: Array<{
    id: string
  }>
  /** TRUE quando o lead foi criado acima do limite max_leads do plano. Dados sensíveis são mascarados. */
  is_over_plan?: boolean
}

// =====================================================
// TYPES PARA FORMULÁRIOS
// =====================================================

export interface CreateFunnelForm {
  name: string
  description?: string
  is_default?: boolean
  is_active?: boolean
  skip_default_stages?: boolean
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
  status?: 'open' | 'won' | 'lost'
  probability?: number
  expected_close_date?: string
  actual_close_date?: string
  closed_at?: string
  loss_reason?: string
  owner_user_id?: string
}

/** Opções para `funnelApi.updateOpportunity` — composição por itens (valor manual via RPC). */
export interface UpdateOpportunityOptions {
  companyId?: string
  /** Quando true, `value` é persistido apenas via RPC `opportunity_set_manual_value` (backend valida feature e `value_mode = manual`). */
  useCompositionManualValueRpc?: boolean
}

// =====================================================
// FORMS PARA FECHAMENTO/REABERTURA VIA RPC
// =====================================================

export interface CloseOpportunityParams {
  opportunity_id: string
  funnel_id: string
  to_stage_id: string
  position_in_stage: number
  to_status: 'won' | 'lost'
  value: number
  loss_reason?: string
  closed_at: string
  company_id: string
}

export interface ReopenOpportunityParams {
  opportunity_id: string
  funnel_id: string
  to_stage_id: string
  position_in_stage: number
  company_id: string
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
  origin?: string
  period_days?: number
  tags?: string[]
  min_value?: number
  max_value?: number
}

// =====================================================
// FASE 3 — ARQUITETURA POR COLUNA
// =====================================================

/** Contadores de uma etapa retornados por get_funnel_stage_counts */
export interface StageCount {
  stage_id: string
  count: number
  total_value: number
}

/** Estado de uma coluna no useBoardPositions */
export interface StagePositionState {
  positions: OpportunityFunnelPosition[]
  loading: boolean
  hasMore: boolean
  page: number
}

/**
 * Snapshot imutável do estado de source e destination antes
 * de um optimisticMove. Usado para rollback em caso de erro.
 */
export interface BoardPositionsSnapshot {
  fromStageId: string
  toStageId: string
  fromPositions: OpportunityFunnelPosition[]
  toPositions: OpportunityFunnelPosition[]
}

export interface StageHistoryFilter {
  lead_id?: number
  funnel_id?: string
  from_date?: Date
  to_date?: Date
  limit?: number
}

// =====================================================
// FASE 4 — REALTIME
// =====================================================

/**
 * Campos relevantes de opportunity_funnel_positions recebidos
 * via Supabase Realtime (postgres_changes).
 * Com REPLICA IDENTITY FULL, UPDATE inclui old.stage_id.
 */
export interface FunnelRealtimePayload {
  id?: string
  opportunity_id?: string
  lead_id?: number
  funnel_id?: string
  stage_id?: string
  position_in_stage?: number
  entered_stage_at?: string
  updated_at?: string
}

/** Evento recebido pelo canal Realtime do funil */
export interface FunnelRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Partial<FunnelRealtimePayload>
  old: Partial<FunnelRealtimePayload>
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

/** Valor formatado; `currencyCode` default BRL. */
export const formatCurrency = (value: number, currencyCode: string = 'BRL'): string =>
  formatMoney(value, currencyCode)

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
  reorderFunnels: (funnels: Array<{id: string, display_order: number}>) => Promise<void>
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
  moveOpportunityById: (opportunityId: string, toStageId: string, position: number) => Promise<void>
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
