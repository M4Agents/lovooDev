// =====================================================
// COMPONENTE: FunnelColumn
// Data: 03/03/2026
// Objetivo: Coluna do Kanban com drag & drop
// =====================================================

import { Droppable } from '@hello-pangea/dnd'
import { Plus, MoreVertical, DollarSign, Users } from 'lucide-react'
import type { FunnelStage, LeadFunnelPosition } from '../../types/sales-funnel'
import { LeadCard } from './LeadCard'
import { formatCurrency } from '../../types/sales-funnel'

interface FunnelColumnProps {
  stage: FunnelStage
  leads: LeadFunnelPosition[]
  visibleFields?: string[]
  leadPhotos?: Record<string, string>
  onLeadClick?: (leadId: number) => void
  onAddLead?: (stageId: string) => void
  onEditStage?: (stageId: string) => void
}

export const FunnelColumn: React.FC<FunnelColumnProps> = ({
  stage,
  leads,
  visibleFields,
  leadPhotos,
  onLeadClick,
  onAddLead,
  onEditStage
}) => {
  const totalValue = leads.reduce((sum, pos) => {
    return sum + (pos.lead?.deal_value || 0)
  }, 0)

  const getStageTypeColor = (type: string) => {
    switch (type) {
      case 'won':
        return 'bg-green-50 border-green-200'
      case 'lost':
        return 'bg-red-50 border-red-200'
      default:
        return 'bg-gray-50 border-gray-200'
    }
  }

  const getHeaderColor = (color: string) => {
    return {
      backgroundColor: `${color}20`,
      borderColor: color
    }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header da coluna */}
      <div
        className="flex items-center justify-between p-4 border-b-2 rounded-t-lg"
        style={getHeaderColor(stage.color)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: stage.color }}
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {stage.name}
            </h3>
            <p className="text-xs text-gray-500">
              {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAddLead && (
            <button
              onClick={() => onAddLead(stage.id)}
              className="p-1.5 hover:bg-white rounded-md transition-colors"
              title="Adicionar lead"
            >
              <Plus className="w-4 h-4 text-gray-600" />
            </button>
          )}
          
          {onEditStage && !stage.is_system_stage && (
            <button
              onClick={() => onEditStage(stage.id)}
              className="p-1.5 hover:bg-white rounded-md transition-colors"
              title="Editar etapa"
            >
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </button>
          )}
        </div>
      </div>

      {/* Estatísticas */}
      {(leads.length > 0 || totalValue > 0) && (
        <div className={`px-4 py-3 border-b ${getStageTypeColor(stage.stage_type)}`}>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-gray-600">
              <Users className="w-3.5 h-3.5" />
              <span className="font-medium">{leads.length}</span>
            </div>
            
            {totalValue > 0 && (
              <div className="flex items-center gap-1.5 text-green-600 font-semibold">
                <DollarSign className="w-3.5 h-3.5" />
                <span>{formatCurrency(totalValue)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lista de leads com drag & drop */}
      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`
              flex-1 p-4 overflow-y-auto
              ${snapshot.isDraggingOver ? 'bg-blue-50' : ''}
              transition-colors duration-200
            `}
            style={{
              minHeight: '200px',
              maxHeight: 'calc(100vh - 300px)'
            }}
          >
            {leads.length === 0 && !snapshot.isDraggingOver ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <Users className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500 mb-1">
                  Nenhum lead nesta etapa
                </p>
                <p className="text-xs text-gray-400">
                  Arraste leads para cá
                </p>
              </div>
            ) : (
              leads.map((position, index) => (
                <LeadCard
                  key={position.id}
                  position={position}
                  index={index}
                  visibleFields={visibleFields}
                  leadPhotos={leadPhotos}
                  onClick={onLeadClick}
                />
              ))
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Footer com ações */}
      {stage.stage_type !== 'active' && leads.length > 0 && (
        <div className="px-4 py-3 border-t bg-gray-50 rounded-b-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">
              {stage.stage_type === 'won' ? '✅ Ganhos' : '❌ Perdidos'}
            </span>
            <span className="font-semibold text-gray-700">
              {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
