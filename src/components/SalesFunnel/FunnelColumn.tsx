// =====================================================
// COMPONENTE: FunnelColumn
// Data: 03/03/2026
// Objetivo: Coluna do Kanban com drag & drop
// =====================================================

import { Droppable } from '@hello-pangea/dnd'
import { Plus, MoreVertical, Users } from 'lucide-react'
import type { FunnelStage, LeadFunnelPosition } from '../../types/sales-funnel'
import type { CompanyUser } from '../../types/user'
import { LeadCard } from './LeadCard'
import { formatCurrency } from '../../types/sales-funnel'
import { formatMoney } from '../../lib/formatMoney'

function formatColumnTotals(leads: LeadFunnelPosition[]): string | null {
  const byCurrency = new Map<string, number>()
  for (const pos of leads) {
    const cur = (pos.opportunity?.currency || 'BRL').toUpperCase()
    const v = pos.opportunity?.value || 0
    if (v <= 0) continue
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + v)
  }
  if (byCurrency.size === 0) return null
  const parts = Array.from(byCurrency.entries()).map(([code, sum]) => formatMoney(sum, code))
  return parts.join(' · ')
}

interface FunnelColumnProps {
  stage: FunnelStage
  leads: LeadFunnelPosition[]
  visibleFields?: string[]
  onLeadClick?: (leadId: number) => void
  onAddLead?: (stageId: string) => void
  onEditStage?: (stageId: string) => void
  /** Fase 3: total real vindo do servidor (get_funnel_stage_counts). */
  count?: number
  /** Fase 3: soma de valores vinda do servidor. */
  totalValue?: number
  /** Fase 3: se há mais cards além dos já carregados. */
  hasMore?: boolean
  /** Fase 3: callback para carregar a próxima página. */
  onLoadMore?: () => void
  /** Fase 3: se a coluna está carregando a próxima página. */
  loading?: boolean
  /** Fase 3: tamanho de página usado pelo hook de paginação. */
  pageSize?: number
  /** Tags inline: company_id para TagSelectorPopover (multi-tenant). */
  companyId?: string
  /** Abre o modal de detalhes/jornada da oportunidade. */
  onDetailClick?: (opportunityId: string) => void
  /** Lista de usuários da empresa para exibir nome do owner no card. */
  companyUsers?: CompanyUser[]
}

export const FunnelColumn: React.FC<FunnelColumnProps> = ({
  stage,
  leads,
  visibleFields,
  onLeadClick,
  onAddLead,
  onEditStage,
  count,
  totalValue,
  hasMore,
  onLoadMore,
  loading = false,
  pageSize = 20,
  companyId,
  onDetailClick,
  companyUsers
}) => {
  const localTotalValue = leads.reduce((sum, pos) => {
    return sum + (pos.opportunity?.value || 0)
  }, 0)

  // Usa valores do servidor quando disponíveis (Fase 3); fallback para locais (Fase 2)
  const displayCount      = count      ?? leads.length
  const displayTotalValue = totalValue ?? localTotalValue

  /** Soma por moeda nos cards carregados (evita misturar moedas num único número). */
  const totalLabelFromLoaded = formatColumnTotals(leads)

  // Variáveis de paginação — só relevantes quando hasMore === true
  const loadedCount    = leads.length
  const remainingCount = Math.max(0, displayCount - loadedCount)
  const nextLoadCount  = Math.min(remainingCount, pageSize)

  const isLastPage     = nextLoadCount < pageSize

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
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500">
                {displayCount} {displayCount === 1 ? 'oportunidade' : 'oportunidades'}
              </p>
              {(totalLabelFromLoaded || displayTotalValue > 0) && (
                <>
                  <span className="text-xs text-gray-300">•</span>
                  <p className="text-xs text-green-600 font-semibold" title={hasMore ? 'Total parcial: apenas oportunidades já carregadas na coluna.' : undefined}>
                    {totalLabelFromLoaded
                      ? totalLabelFromLoaded
                      : formatCurrency(displayTotalValue, leads[0]?.opportunity?.currency || 'BRL')}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAddLead && (
            <button
              onClick={() => onAddLead(stage.id)}
              className="p-1.5 hover:bg-white rounded-md transition-colors"
              title="Adicionar oportunidade"
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

      {/* Lista de oportunidades com drag & drop */}
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
                  Nenhuma oportunidade nesta etapa
                </p>
                <p className="text-xs text-gray-400">
                  Arraste oportunidades para cá
                </p>
              </div>
            ) : (
              leads.map((position, index) => (
                <LeadCard
                  key={position.id}
                  position={position}
                  index={index}
                  visibleFields={visibleFields}
                  onClick={onLeadClick}
                  companyId={companyId}
                  onDetailClick={onDetailClick}
                  companyUsers={companyUsers}
                />
              ))
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Footer: etapas especiais (won/lost) */}
      {stage.stage_type !== 'active' && displayCount > 0 && (
        <div className="px-4 py-3 border-t bg-gray-50 rounded-b-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">
              {stage.stage_type === 'won' ? '✅ Ganhos' : '❌ Perdidos'}
            </span>
            <span className="font-semibold text-gray-700">
              {displayCount} {displayCount === 1 ? 'oportunidade' : 'oportunidades'}
            </span>
          </div>
        </div>
      )}

      {/* Footer: Carregar mais (Fase 3) */}
      {hasMore && onLoadMore && (
        <div className="px-4 py-3 border-t bg-gray-50 rounded-b-lg">
          <p className="text-xs text-gray-400 text-center mb-2">
            Mostrando {loadedCount} de {displayCount} oportunidades
          </p>
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="w-full text-xs font-medium text-center py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            {loading
              ? 'Carregando...'
              : isLastPage
                ? `Carregar ${nextLoadCount} restante${nextLoadCount === 1 ? '' : 's'}`
                : `Carregar mais ${nextLoadCount}`
            }
          </button>
        </div>
      )}
    </div>
  )
}
