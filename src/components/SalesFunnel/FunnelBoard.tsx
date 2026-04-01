// =====================================================
// COMPONENTE: FunnelBoard
// Data: 03/03/2026
// Objetivo: Board Kanban principal com drag & drop
// =====================================================

import { useState, useCallback, useEffect, useMemo } from 'react'
import { DragDropContext, DropResult } from '@hello-pangea/dnd'
import { Loader2, AlertCircle } from 'lucide-react'
import { FunnelColumn } from './FunnelColumn'
import { EditStageModal } from './EditStageModal'
import { AddLeadToFunnelModal } from './AddLeadToFunnelModal'
import { useFunnelStages } from '../../hooks/useFunnelStages'
import { useLeadPositions } from '../../hooks/useLeadPositions'
import { useAuth } from '../../contexts/AuthContext'
import { funnelApi } from '../../services/funnelApi'
import { triggerManager } from '../../services/automation/TriggerManager'
import { supabase } from '../../lib/supabase'
import type { LeadFunnelPosition, LeadPositionFilter, FunnelStage, CreateStageForm, UpdateStageForm } from '../../types/sales-funnel'

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
    if (selectedPeriod === 'today')  return 1
    if (selectedPeriod === 'week')   return 7
    if (selectedPeriod === 'month')  return 30
    return undefined
  }, [selectedPeriod])

  // Objeto de filtro estável: memoizado para evitar re-fetches desnecessários no hook
  const filter = useMemo<LeadPositionFilter>(() => ({
    funnel_id:   funnelId,
    search:      searchTerm   || undefined,
    origin:      selectedOrigin || undefined,
    period_days: periodDays
  }), [funnelId, searchTerm, selectedOrigin, periodDays])

  const {
    positions,
    loading: positionsLoading,
    error: positionsError,
    moveOpportunityById,
    addLeadToFunnel,
    refreshPositions
  } = useLeadPositions(funnelId, companyId, filter)

  const [isDragging, setIsDragging] = useState(false)
  const [showEditStageModal, setShowEditStageModal] = useState(false)
  const [showAddLeadModal, setShowAddLeadModal] = useState(false)
  const [selectedStage, setSelectedStage] = useState<FunnelStage | undefined>()
  const [selectedStageId, setSelectedStageId] = useState<string>('')

  // Organizar leads por etapa — filtros de busca/origem/período já aplicados server-side pela RPC
  const getLeadsByStage = useCallback((stageId: string): LeadFunnelPosition[] => {
    const filtered = positions.filter(pos => pos.stage_id === stageId)

    // Ordenar por data de criação da oportunidade (mais recente primeiro)
    return filtered.sort((a, b) => {
      const dateA = a.opportunity?.created_at
      const dateB = b.opportunity?.created_at

      if (dateA && dateB) {
        return new Date(dateB).getTime() - new Date(dateA).getTime()
      }
      if (dateA) return -1
      if (dateB) return 1

      return a.position_in_stage - b.position_in_stage
    })
  }, [positions])

  // Handlers dos modais
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

  const handleSubmitAddLead = async (leadId: number, stageId: string) => {
    await addLeadToFunnel(leadId, funnelId)
    await refreshPositions()
  }

  // Buscar leads disponíveis (não estão no funil)
  const [availableLeads, setAvailableLeads] = useState<Array<{id: number; name: string; email?: string; phone?: string; company_name?: string}>>([])
  
  // Carrega leads disponíveis ao abrir o modal (acionado via showAddLeadModal).
  // Não depende de `positions` para evitar re-fetch a cada movimentação de card.
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

  // Handler do drag & drop
  const handleDragStart = () => {
    setIsDragging(true)
  }

  const handleDragEnd = async (result: DropResult) => {
    setIsDragging(false)

    const { source, destination, draggableId } = result

    // Se não há destino ou voltou para o mesmo lugar
    if (!destination) return
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return
    }

    // Extrair opportunity_id do draggableId (formato: "opportunity-<uuid>")
    const opportunityId = draggableId.replace('opportunity-', '')
    const toStageId = destination.droppableId
    const newPosition = destination.index

    try {
      // Buscar dados da posição atual antes de mover
      const currentPosition = positions.find(p => p.opportunity_id === opportunityId)
      if (!currentPosition) {
        console.error('Posição atual não encontrada para oportunidade:', opportunityId)
        return
      }

      const oldStageId = currentPosition.stage_id

      // Mover oportunidade para nova etapa
      await moveOpportunityById(opportunityId, toStageId, newPosition)
      
      // Disparar trigger de automação se mudou de etapa
      if (companyId && opportunityId && oldStageId !== toStageId) {
        console.log('🔔 Disparando trigger de automação do Funil:', {
          opportunityId,
          oldStage: oldStageId,
          newStage: toStageId,
          funnel: funnelId
        })

        try {
          // Buscar conversationId direto de positions (mesma estrutura do OpportunitiesSection)
          const conversationId = currentPosition?.opportunity?.lead?.chat_conversations?.[0]?.id
          
          console.log('📞 ConversationId encontrado via positions:', conversationId)

          // Disparar trigger com mesma estrutura do OpportunitiesSection
          await triggerManager.onOpportunityStageChanged(
            companyId,
            opportunityId,
            oldStageId,
            toStageId,
            {
              opportunity_id: opportunityId,
              funnel_id: funnelId,
              lead_id: currentPosition.lead_id,
              lead: currentPosition?.opportunity?.lead,
              conversation_id: conversationId
            }
          )

          console.log('✅ Trigger de automação disparado com sucesso')
        } catch (automationError) {
          console.error('❌ Erro ao disparar automação:', automationError)
          // Não bloquear movimentação se automação falhar
        }
      }
      
      // Atualizar posições
      await refreshPositions()
    } catch (error) {
      console.error('Erro ao mover lead:', error)
      // TODO: Mostrar toast de erro
    }
  }

  // Spinner apenas na carga inicial (sem dados ainda).
  // Refreshes subsequentes (após mover card) rodam em background
  // sem desmontar os cards existentes.
  if ((stagesLoading || positionsLoading) && stages.length === 0 && positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Carregando funil...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (stagesError || positionsError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Erro ao carregar funil
          </h3>
          <p className="text-gray-600 mb-4">
            {stagesError || positionsError}
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

  // Empty state
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

  return (
    <div className="h-full">
      <DragDropContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
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
    </div>
  )
}
