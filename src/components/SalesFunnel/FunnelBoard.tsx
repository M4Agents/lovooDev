// =====================================================
// COMPONENTE: FunnelBoard
// Data: 03/03/2026 — Fase 3B: 04/04/2026 — Fase 4: 04/04/2026
// Objetivo: Board Kanban principal com drag & drop
// Fase 3B: carregamento por coluna, contadores server-side,
//          DnD otimista com rollback, refresh cirúrgico.
// Fase 4: sincronização Realtime incremental por coluna,
//         deduplicação de eventos próprios, sync ao voltar para aba.
// =====================================================

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { DragDropContext, DropResult } from '@hello-pangea/dnd'
import { Loader2, AlertCircle } from 'lucide-react'
import { FunnelColumn } from './FunnelColumn'
import { EditStageModal } from './EditStageModal'
import { AddLeadToFunnelModal } from './AddLeadToFunnelModal'
import { CloseOpportunityModal } from './CloseOpportunityModal'
import { ReopenOpportunityModal } from './ReopenOpportunityModal'
import { OpportunityDetailModal } from './OpportunityDetailModal'
import { useFunnelStages } from '../../hooks/useFunnelStages'
import { useBoardPositions } from '../../hooks/useBoardPositions'
import { useStageCounts } from '../../hooks/useStageCounts'
import { useMoveOpportunity } from '../../hooks/useMoveOpportunity'
import { useFunnelRealtime } from '../../hooks/useFunnelRealtime'
import { useBoardAutoScroll } from '../../hooks/useBoardAutoScroll'
import { useAuth } from '../../contexts/AuthContext'
import { funnelApi } from '../../services/funnelApi'
import { supabase } from '../../lib/supabase'
import { triggerManager } from '../../services/automation/TriggerManager'
import type {
  LeadPositionFilter,
  FunnelStage,
  CreateStageForm,
  UpdateStageForm,
  CloseOpportunityParams,
  ReopenOpportunityParams,
  Opportunity
} from '../../types/sales-funnel'

// =====================================================
// FEATURE FLAG — REALTIME
// Mude para false para desabilitar Realtime imediatamente
// sem reverter código (rollback rápido de emergência).
// =====================================================
const FUNNEL_REALTIME_ENABLED = true

interface FunnelBoardProps {
  funnelId: string
  visibleFields?: string[]
  onLeadClick?: (leadId: number) => void
  searchTerm?: string
  selectedOrigin?: string
  selectedPeriod?: string
}

export const FunnelBoard: React.FC<FunnelBoardProps> = ({
  funnelId,
  visibleFields,
  onLeadClick,
  searchTerm = '',
  selectedOrigin = '',
  selectedPeriod = ''
}) => {
  const { company } = useAuth()
  const companyId = company?.id

  const {
    stages,
    loading: stagesLoading,
    error: stagesError,
    createStage,
    updateStage,
    deleteStage,
    refreshStages
  } = useFunnelStages(funnelId)

  // Converte selectedPeriod (string da UI) para period_days (int para a RPC)
  const periodDays = useMemo<number | undefined>(() => {
    if (selectedPeriod === 'today') return 1
    if (selectedPeriod === 'week')  return 7
    if (selectedPeriod === 'month') return 30
    return undefined
  }, [selectedPeriod])

  // Objeto de filtro estável: memoizado para evitar re-fetches desnecessários
  const filter = useMemo<LeadPositionFilter>(() => ({
    funnel_id:   funnelId,
    search:      searchTerm    || undefined,
    origin:      selectedOrigin || undefined,
    period_days: periodDays
  }), [funnelId, searchTerm, selectedOrigin, periodDays])

  // =====================================================
  // FASE 3B — HOOKS DE DADOS POR COLUNA
  // =====================================================

  const {
    stageMap,
    loadMore,
    refresh: boardRefresh,
    optimisticMove,
    rollback
  } = useBoardPositions(funnelId, stages, companyId, filter)

  const { counts, refresh: refreshCounts } = useStageCounts(funnelId, companyId, filter)

  const { move } = useMoveOpportunity(companyId)

  // =====================================================
  // FASE 4 — REALTIME
  // recentlyMovedRef: Map<opportunityId, timestamp> para deduplicação.
  // Após cada move() bem-sucedido, registra o opportunityId por 3s
  // para que o useFunnelRealtime ignore o evento gerado pelo próprio usuário.
  //
  // LIMITAÇÃO DOCUMENTADA: se outro usuário mover o mesmo card
  // dentro de 3s, o evento será ignorado. Inconsistência máxima: 3s.
  // =====================================================
  const recentlyMovedRef = useRef<Map<string, number>>(new Map())

  useFunnelRealtime(
    funnelId,
    companyId,
    FUNNEL_REALTIME_ENABLED,
    (stageIds) => stageIds.forEach(id => boardRefresh(id)),
    () => { refreshCounts().catch(err => console.error('Realtime: erro ao atualizar contadores:', err)) },
    recentlyMovedRef
  )

  // Verdadeiro apenas antes do primeiro fetch completar (stageMap ainda vazio)
  const isInitialLoading = stageMap.size === 0

  // =====================================================
  // ESTADO DOS MODAIS
  // =====================================================

  const [isDragging, setIsDragging]                 = useState(false)
  const boardScrollRef = useRef<HTMLDivElement>(null)
  useBoardAutoScroll(boardScrollRef, isDragging)
  const [showEditStageModal, setShowEditStageModal]  = useState(false)
  const [showAddLeadModal, setShowAddLeadModal]      = useState(false)
  const [selectedStage, setSelectedStage]            = useState<FunnelStage | undefined>()
  const [selectedStageId, setSelectedStageId]        = useState<string>('')

  // Modal de detalhes / jornada da oportunidade
  const [detailOpportunityId, setDetailOpportunityId] = useState<string | null>(null)

  // Encontra o objeto Opportunity a partir do stageMap para passar ao modal
  const detailOpportunity = useMemo((): Opportunity | null => {
    if (!detailOpportunityId) return null
    for (const stageData of stageMap.values()) {
      const pos = stageData.positions?.find(
        (p: { opportunity_id: string }) => p.opportunity_id === detailOpportunityId
      )
      if (pos?.opportunity) return pos.opportunity as Opportunity
    }
    return null
  }, [detailOpportunityId, stageMap])

  const handleDetailClick = useCallback((opportunityId: string) => {
    setDetailOpportunityId(opportunityId)
  }, [])

  // Após salvar edição no modal, faz refresh cirúrgico da coluna onde a oportunidade está
  const handleOpportunityUpdate = useCallback((updated: Opportunity) => {
    for (const [stageId, stageData] of stageMap.entries()) {
      const found = stageData.positions?.some(
        (p: { opportunity_id: string }) => p.opportunity_id === updated.id
      )
      if (found) {
        boardRefresh(stageId)
        break
      }
    }
  }, [stageMap, boardRefresh])

  // =====================================================
  // ESTADO: TRANSIÇÃO DE FECHAMENTO / REABERTURA
  // Criado no handleDragEnd quando a transição detectada
  // exige confirmação modal. Limpo após confirmar ou cancelar.
  // =====================================================

  interface PendingTransition {
    opportunityId: string
    opportunityTitle: string
    opportunityValue: number
    opportunityClosed?: string
    opportunityStatus: 'open' | 'won' | 'lost'
    snapshot: ReturnType<typeof optimisticMove>
    fromStageType: 'active' | 'won' | 'lost'
    toStageType: 'active' | 'won' | 'lost'
    toStageId: string
    positionInStage: number
    fromStageId: string
    leadId?: number
    conversationId?: string
  }

  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)

  // =====================================================
  // LEITURA DE DADOS POR COLUNA
  // Ordem vinda da RPC (position_in_stage ASC).
  // Sort frontend removido: reordenar por created_at
  // desfaria o optimisticMove imediatamente.
  // =====================================================

  const getLeadsByStage = useCallback((stageId: string) => {
    return stageMap.get(stageId)?.positions ?? []
  }, [stageMap])

  // =====================================================
  // HANDLERS DE MODAIS
  // =====================================================

  const handleEditStage = (stageId: string) => {
    const stage = stages.find(s => s.id === stageId)
    setSelectedStage(stage)
    setShowEditStageModal(true)
  }

  const handleAddLead = (stageId: string) => {
    setSelectedStageId(stageId)
    setShowAddLeadModal(true)
  }

  const handleSubmitStage = async (data: CreateStageForm | UpdateStageForm) => {
    if (selectedStage) {
      await updateStage(selectedStage.id, data as UpdateStageForm)
    } else {
      await createStage(data as CreateStageForm)
    }
    await refreshStages()
  }

  const handleDeleteStage = async (stageId: string) => {
    await deleteStage(stageId)
    await refreshStages()
  }

  // =====================================================
  // ADD LEAD AO FUNIL — refresh cirúrgico
  // Cria oportunidade e recarrega apenas a coluna afetada.
  // Sem otimismo: operação complexa, custo de 1 refetch é aceitável.
  // =====================================================

  const addLeadToBoard = useCallback(async (leadId: number, targetStageId: string) => {
    const funnelStages = await funnelApi.getStages(funnelId)
    const targetStage  = funnelStages.find(s => s.id === targetStageId)
      || funnelStages.find(s => s.is_system_stage && s.position === 0)
      || funnelStages[0]

    if (!targetStage) throw new Error('Funil não possui etapas')

    const { data: lead } = await supabase
      .from('leads')
      .select('name, company_id, origin, responsible_user_id')
      .eq('id', leadId)
      .single()

    if (!lead) throw new Error('Lead não encontrado')

    const opportunity = await funnelApi.createOpportunity({
      lead_id:        leadId,
      company_id:     lead.company_id,
      title:          lead.name,
      source:         lead.origin,
      owner_user_id:  lead.responsible_user_id
    })

    await funnelApi.addOpportunityToFunnel(opportunity.id, funnelId, targetStage.id)

    // Refresh cirúrgico: apenas a coluna de entrada + contadores
    boardRefresh(targetStage.id)
    refreshCounts().catch(err => console.error('Erro ao atualizar contadores:', err))
  }, [funnelId, boardRefresh, refreshCounts])

  const handleSubmitAddLead = (leadId: number, stageId: string) =>
    addLeadToBoard(leadId, stageId)

  // =====================================================
  // LEADS DISPONÍVEIS PARA O MODAL
  // Carregado apenas ao abrir o modal, sem depender do stageMap.
  // =====================================================

  const [availableLeads, setAvailableLeads] = useState<Array<{id: number; name: string; email?: string; phone?: string; company_name?: string}>>([])

  useEffect(() => {
    if (!showAddLeadModal || !companyId || !funnelId) return
    const fetchAvailableLeads = async () => {
      try {
        const leads = await funnelApi.getAvailableLeads(companyId, funnelId)
        setAvailableLeads(leads)
      } catch (error) {
        console.error('Error fetching available leads:', error)
      }
    }
    fetchAvailableLeads()
  }, [showAddLeadModal, companyId, funnelId])

  // =====================================================
  // FASE 4 — SYNC AO VOLTAR PARA A ABA
  // Refresca todas as etapas não-ocultas (is_hidden === false) e
  // atualiza contadores quando o usuário retorna à aba após ausência.
  // Não existe noção de colunas visíveis no viewport — todas as etapas
  // configuradas como não-ocultas são recarregadas.
  // =====================================================

  useEffect(() => {
    if (!FUNNEL_REALTIME_ENABLED) return

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        boardRefresh()
        refreshCounts().catch(err => console.error('Visibility sync: erro ao atualizar contadores:', err))
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [boardRefresh, refreshCounts])

  // =====================================================
  // DRAG & DROP — OTIMISTA COM ROLLBACK
  // Fluxo normal (active→active): optimisticMove → move → rollback se erro
  // Fluxo com modal (qualquer transição que muda status):
  //   optimisticMove → setPendingTransition → (usuário confirma/cancela)
  //   → confirmar: RPC → triggerAutomation → refreshCounts
  //   → cancelar: rollback visual
  // =====================================================

  const handleDragStart = () => {
    setIsDragging(true)
  }

  const handleDragEnd = async (result: DropResult) => {
    setIsDragging(false)

    const { source, destination, draggableId } = result

    if (!destination) return
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) return

    const opportunityId = draggableId.replace('opportunity-', '')
    const fromStageId   = source.droppableId
    const toStageId     = destination.droppableId
    const newPosition   = destination.index

    const fromStage = stages.find(s => s.id === fromStageId)
    const toStage   = stages.find(s => s.id === toStageId)
    if (!fromStage || !toStage) return

    // Ler posição atual do stageMap (já populado)
    const currentPosition = stageMap.get(fromStageId)?.positions
      .find(p => p.opportunity_id === opportunityId)
    if (!currentPosition) return

    const opp        = currentPosition.opportunity
    const fromType   = fromStage.stage_type
    const toType     = toStage.stage_type

    // Detectar se esta transição muda o status da oportunidade
    const isClosing  = fromType === 'active' && (toType === 'won' || toType === 'lost')
    const isReopening = (fromType === 'won' || fromType === 'lost') && toType === 'active'
    const isCrossClose = (fromType === 'won' && toType === 'lost') || (fromType === 'lost' && toType === 'won')
    const needsModal = isClosing || isReopening || isCrossClose

    // 1. Atualização visual imediata (em todos os casos)
    const snapshot = optimisticMove(opportunityId, fromStageId, toStageId, newPosition)

    // 2a. Se precisa de modal: guardar estado pendente e aguardar confirmação
    if (needsModal) {
      setPendingTransition({
        opportunityId,
        opportunityTitle:  opp?.title ?? '',
        opportunityValue:  opp?.value ?? 0,
        opportunityClosed: opp?.closed_at,
        opportunityStatus: (opp?.status ?? 'open') as 'open' | 'won' | 'lost',
        snapshot,
        fromStageType: fromType,
        toStageType:   toType,
        toStageId,
        positionInStage: newPosition,
        fromStageId,
        leadId:          currentPosition.lead_id ?? undefined,
        conversationId:  opp?.lead?.chat_conversations?.[0]?.id
      })
      return
    }

    // 2b. Fluxo normal (active → active)
    try {
      await move({
        opportunity_id:    opportunityId,
        funnel_id:         funnelId,
        from_stage_id:     fromStageId,
        to_stage_id:       toStageId,
        position_in_stage: newPosition,
        lead_id:           currentPosition.lead_id ?? undefined,
        conversationId:    opp?.lead?.chat_conversations?.[0]?.id,
        opportunityData:   { lead: opp?.lead }
      })

      recentlyMovedRef.current.set(opportunityId, Date.now())
      setTimeout(() => recentlyMovedRef.current.delete(opportunityId), 6_000)

      refreshCounts().catch(err => console.error('Erro ao atualizar contadores:', err))
    } catch (error) {
      console.error('Erro ao mover oportunidade:', error)
      rollback(snapshot)
    }
  }

  // =====================================================
  // CONFIRM CLOSE — chama RPC close_opportunity
  // =====================================================

  const handleConfirmClose = useCallback(async (params: CloseOpportunityParams) => {
    if (!pendingTransition) return

    const { data, error } = await supabase.rpc('close_opportunity', {
      p_opportunity_id:    params.opportunity_id,
      p_funnel_id:         params.funnel_id,
      p_to_stage_id:       params.to_stage_id,
      p_position_in_stage: params.position_in_stage,
      p_to_status:         params.to_status,
      p_value:             params.value,
      p_loss_reason:       params.loss_reason ?? null,
      p_closed_at:         params.closed_at,
      p_company_id:        params.company_id
    })

    if (error) throw new Error(error.message)

    const { opportunityId, fromStageId, toStageId, leadId, conversationId } = pendingTransition

    // Registrar para deduplicação Realtime
    recentlyMovedRef.current.set(opportunityId, Date.now())
    setTimeout(() => recentlyMovedRef.current.delete(opportunityId), 6_000)

    // Disparar automação (fire-and-forget)
    if (companyId && fromStageId !== toStageId) {
      triggerManager.onOpportunityStageChanged(
        companyId,
        opportunityId,
        fromStageId,
        toStageId,
        { opportunity_id: opportunityId, funnel_id: funnelId, lead_id: leadId, conversation_id: conversationId, ...data?.[0] }
      ).catch(err => console.error('Automation trigger failed (non-blocking):', err))
    }

    refreshCounts().catch(err => console.error('Erro ao atualizar contadores:', err))
    setPendingTransition(null)
  }, [pendingTransition, companyId, funnelId, refreshCounts])

  // =====================================================
  // CONFIRM REOPEN — chama RPC reopen_opportunity
  // =====================================================

  const handleConfirmReopen = useCallback(async (params: ReopenOpportunityParams) => {
    if (!pendingTransition) return

    const { data, error } = await supabase.rpc('reopen_opportunity', {
      p_opportunity_id:    params.opportunity_id,
      p_funnel_id:         params.funnel_id,
      p_to_stage_id:       params.to_stage_id,
      p_position_in_stage: params.position_in_stage,
      p_company_id:        params.company_id
    })

    if (error) throw new Error(error.message)

    const { opportunityId, fromStageId, toStageId, leadId, conversationId } = pendingTransition

    recentlyMovedRef.current.set(opportunityId, Date.now())
    setTimeout(() => recentlyMovedRef.current.delete(opportunityId), 6_000)

    if (companyId && fromStageId !== toStageId) {
      triggerManager.onOpportunityStageChanged(
        companyId,
        opportunityId,
        fromStageId,
        toStageId,
        { opportunity_id: opportunityId, funnel_id: funnelId, lead_id: leadId, conversation_id: conversationId, ...data?.[0] }
      ).catch(err => console.error('Automation trigger failed (non-blocking):', err))
    }

    refreshCounts().catch(err => console.error('Erro ao atualizar contadores:', err))
    setPendingTransition(null)
  }, [pendingTransition, companyId, funnelId, refreshCounts])

  // =====================================================
  // CANCEL TRANSITION — rollback visual
  // =====================================================

  const handleCancelTransition = useCallback(() => {
    if (!pendingTransition) return
    rollback(pendingTransition.snapshot)
    setPendingTransition(null)
  }, [pendingTransition, rollback])

  // =====================================================
  // ESTADOS DE LOADING / ERRO / VAZIO
  // =====================================================

  // Spinner na carga inicial: stages ainda não carregaram ou stageMap ainda vazio
  if ((stagesLoading || isInitialLoading) && stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Carregando funil...</p>
        </div>
      </div>
    )
  }

  // Erro de carregamento das etapas (erros por coluna são tratados individualmente)
  if (stagesError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Erro ao carregar funil
          </h3>
          <p className="text-gray-600 mb-4">
            {stagesError}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Nenhuma etapa encontrada
          </h3>
          <p className="text-gray-600">
            Este funil não possui etapas configuradas.
          </p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER DO BOARD
  // =====================================================

  return (
    <div className="h-full">
      <DragDropContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div ref={boardScrollRef} className="flex gap-4 overflow-x-auto pb-4 h-full">
          {stages.filter(stage => !stage.is_hidden).map(stage => (
            <div
              key={stage.id}
              className="flex-shrink-0"
              style={{ width: '320px' }}
            >
              <FunnelColumn
                stage={stage}
                leads={getLeadsByStage(stage.id)}
                visibleFields={visibleFields}
                onLeadClick={onLeadClick}
                onAddLead={handleAddLead}
                onEditStage={handleEditStage}
                count={counts[stage.id]?.count}
                totalValue={counts[stage.id]?.total_value}
                hasMore={stageMap.get(stage.id)?.hasMore}
                onLoadMore={() => loadMore(stage.id)}
                loading={stageMap.get(stage.id)?.loading}
                companyId={companyId}
                onDetailClick={handleDetailClick}
              />
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Overlay durante drag */}
      {isDragging && (
        <div className="fixed inset-0 bg-black bg-opacity-5 pointer-events-none z-40" />
      )}

      {/* Modais */}
      <EditStageModal
        isOpen={showEditStageModal}
        onClose={() => {
          setShowEditStageModal(false)
          setSelectedStage(undefined)
        }}
        onSubmit={handleSubmitStage}
        onDelete={handleDeleteStage}
        stage={selectedStage}
        funnelId={funnelId}
        existingStages={stages}
      />

      <AddLeadToFunnelModal
        isOpen={showAddLeadModal}
        onClose={() => {
          setShowAddLeadModal(false)
          setSelectedStageId('')
        }}
        onSubmit={handleSubmitAddLead}
        funnelId={funnelId}
        stageId={selectedStageId}
        availableLeads={availableLeads}
      />

      {/* Modal de fechamento (won/lost) */}
      {pendingTransition && (pendingTransition.toStageType === 'won' || pendingTransition.toStageType === 'lost') && (
        <CloseOpportunityModal
          isOpen={true}
          stageType={pendingTransition.toStageType as 'won' | 'lost'}
          opportunityTitle={pendingTransition.opportunityTitle}
          currentValue={pendingTransition.opportunityValue}
          opportunityId={pendingTransition.opportunityId}
          funnelId={funnelId}
          toStageId={pendingTransition.toStageId}
          positionInStage={pendingTransition.positionInStage}
          companyId={companyId ?? ''}
          onConfirm={handleConfirmClose}
          onCancel={handleCancelTransition}
        />
      )}

      {/* Modal de reabertura (won/lost → active) */}
      {pendingTransition && pendingTransition.toStageType === 'active' && (
        <ReopenOpportunityModal
          isOpen={true}
          opportunityTitle={pendingTransition.opportunityTitle}
          currentStatus={pendingTransition.opportunityStatus as 'won' | 'lost'}
          closedAt={pendingTransition.opportunityClosed}
          opportunityId={pendingTransition.opportunityId}
          funnelId={funnelId}
          toStageId={pendingTransition.toStageId}
          positionInStage={pendingTransition.positionInStage}
          companyId={companyId ?? ''}
          onConfirm={handleConfirmReopen}
          onCancel={handleCancelTransition}
        />
      )}

      {/* Modal de detalhes / jornada da oportunidade */}
      {detailOpportunity && (
        <OpportunityDetailModal
          isOpen={true}
          onClose={() => setDetailOpportunityId(null)}
          opportunity={detailOpportunity}
          companyId={companyId ?? ''}
          initialTab="journey"
          onUpdate={handleOpportunityUpdate}
        />
      )}
    </div>
  )
}
