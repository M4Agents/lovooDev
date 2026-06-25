// =====================================================
// COMPONENTE: FunnelColumn
// Data: 03/03/2026
// Objetivo: Coluna do Kanban com drag & drop
// =====================================================

import { useRef, useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { useTranslation } from 'react-i18next'
import { Plus, MoreVertical, Users, Pencil, ArrowRightLeft, BookOpen, Check } from 'lucide-react'
import type { FunnelStage, LeadFunnelPosition, SortOption } from '../../types/sales-funnel'
import type { CompanyUser } from '../../types/user'
import { LeadCard } from './LeadCard'
import { formatCurrency } from '../../types/sales-funnel'
import { formatMoney } from '../../lib/formatMoney'
import { extractYouTubeVideoId } from './PlaybookModal'

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

export interface BulkMoveRequest {
  fromFunnelId:   string
  fromFunnelName: string
  fromStageId:    string
  fromStageName:  string
  fromStageType:  'active' | 'won' | 'lost'
  /** Snapshot dos filtros ativos no momento do clique (injetado pelo FunnelBoard). */
  filters?: {
    search?: string
    origin?: string
    period_start?: string
    period_end?: string
    tags?: string[]
    tags_mode?: 'or' | 'and'
  }
}

interface FunnelColumnProps {
  stage: FunnelStage
  leads: LeadFunnelPosition[]
  visibleFields?: string[]
  onLeadClick?: (leadId: number) => void
  onAddLead?: (stageId: string) => void
  onEditStage?: (stageId: string) => void
  /** Abre o modal de Playbook somente-leitura da etapa. */
  onViewPlaybook?: (stageId: string) => void
  /** Callback para iniciar o bulk move a partir desta coluna. */
  onBulkMoveRequest?: (request: BulkMoveRequest) => void
  /** Nome do funil ao qual esta coluna pertence (para o modal de bulk move). */
  funnelName?: string
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
  /** Override do indicador visual de drag-over — corrige cache estale do @hello-pangea/dnd durante scroll horizontal. */
  isDraggedOver?: boolean
  /** Ordenação ativa nesta coluna (global ou override por etapa). */
  currentSort?: SortOption
  /** Callback para alterar a ordenação da coluna. undefined = remover override (voltar ao padrão). */
  onSortChange?: (sort: SortOption | undefined) => void
  /** Quando true, o reorder interno (arrastar dentro da coluna) está bloqueado. */
  isDragDisabled?: boolean
  /** Quando true, esta coluna tem uma ordenação própria diferente da global. */
  isOverride?: boolean
}

export const FunnelColumn: React.FC<FunnelColumnProps> = ({
  stage,
  leads,
  visibleFields,
  onLeadClick,
  onAddLead,
  onEditStage,
  onViewPlaybook,
  onBulkMoveRequest,
  funnelName = '',
  count,
  totalValue,
  hasMore,
  onLoadMore,
  loading = false,
  pageSize = 20,
  companyId,
  onDetailClick,
  companyUsers,
  isDraggedOver,
  currentSort,
  onSortChange,
  isDragDisabled = false,
  isOverride = false
}) => {
  const { t } = useTranslation('funnel')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'entered_stage_at',    label: 'Entrada na Etapa'    },
    { value: 'entered_funnel_at',   label: 'Entrada no Funil'    },
    { value: 'lead_created_at',     label: 'Cadastro do Lead'    },
    { value: 'last_interaction_at', label: 'Última Interação'    },
  ]

  // hasPlaybook usa a mesma lógica do PlaybookModal (trim + videoId válido)
  // para não exibir a ação quando não há conteúdo real
  const hasPlaybook =
    !!stage.playbook_text?.trim() ||
    !!extractYouTubeVideoId(stage.video_link)
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
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 truncate">
                {stage.name}
              </h3>
              {stage.is_over_plan && (
                <span
                  className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-medium flex-shrink-0"
                  title="Esta etapa está acima do limite do plano. Faça upgrade ou remova etapas para habilitar."
                >
                  Acima do limite
                </span>
              )}
              {isOverride && (
                <span
                  className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded font-medium flex-shrink-0 border border-blue-200"
                  title="Esta etapa usa uma ordenação diferente da ordenação global"
                >
                  Personalizado
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-gray-500">
                {displayCount === 1
                  ? t('board.column.opportunityCount_one', { count: displayCount })
                  : t('board.column.opportunityCount_other', { count: displayCount })}
              </p>
              {currentSort && (
                <p className="text-xs text-blue-500 font-medium" title="Ordenação ativa — arraste entre etapas funciona normalmente; reorder interno desabilitado">
                  {SORT_OPTIONS.find(o => o.value === currentSort)?.label}
                </p>
              )}
              {(totalLabelFromLoaded || displayTotalValue > 0) && (
                <>
                  <span className="text-xs text-gray-300">•</span>
                  <p className="text-xs text-green-600 font-semibold" title={hasMore ? t('board.column.partialTotalTooltip') : undefined}>
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
              title={t('board.column.addOpportunityTitle')}
            >
              <Plus className="w-4 h-4 text-gray-600" />
            </button>
          )}
          
          {/* Bloco 1: ações administrativas — bloqueadas em system stages */}
          {(onEditStage || onBulkMoveRequest || onSortChange) && !stage.is_system_stage && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="p-1.5 hover:bg-white rounded-md transition-colors"
                title="Opções da etapa"
              >
                <MoreVertical className="w-4 h-4 text-gray-600" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-8 z-30 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                  {onEditStage && (
                    <button
                      onClick={() => {
                        if (stage.is_over_plan) return
                        setMenuOpen(false)
                        onEditStage(stage.id)
                      }}
                      disabled={!!stage.is_over_plan}
                      title={stage.is_over_plan ? 'Etapa acima do limite do plano. Faça upgrade para editar.' : undefined}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-4 h-4 text-gray-400" />
                      {t('board.column.editStageTitle')}
                    </button>
                  )}

                  {/* Reordenar por — logo após Editar etapa */}
                  {onSortChange && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <p className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Reordenar por
                      </p>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onSortChange(undefined) }}
                        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <span>Padrão (posição manual)</span>
                        {!currentSort && <Check className="w-4 h-4 text-blue-500" />}
                      </button>
                      {SORT_OPTIONS.map(opt => (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => { setMenuOpen(false); onSortChange(opt.value) }}
                          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <span>{opt.label}</span>
                          {currentSort === opt.value && <Check className="w-4 h-4 text-blue-500" />}
                        </button>
                      ))}
                    </>
                  )}

                  {/* Playbook — terceira opção, acima de Mover oportunidades */}
                  {hasPlaybook && onViewPlaybook && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => { setMenuOpen(false); onViewPlaybook(stage.id) }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <BookOpen className="w-4 h-4 text-indigo-400" />
                        Playbook da Etapa
                      </button>
                    </>
                  )}

                  {onBulkMoveRequest && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        disabled={!count || count === 0}
                        onClick={() => {
                          if (!count || count === 0) return
                          setMenuOpen(false)
                          onBulkMoveRequest({
                            fromFunnelId:  stage.funnel_id,
                            fromFunnelName: funnelName,
                            fromStageId:   stage.id,
                            fromStageName: stage.name,
                            fromStageType: stage.stage_type,
                          })
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={!count || count === 0 ? 'Nenhuma oportunidade nesta etapa' : undefined}
                      >
                        <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                        Mover oportunidades desta etapa
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bloco 2: botão Playbook standalone — visível mesmo em system stages */}
          {hasPlaybook && onViewPlaybook && stage.is_system_stage && (
            <button
              onClick={() => onViewPlaybook(stage.id)}
              className="p-1.5 hover:bg-white rounded-md transition-colors"
              title="Ver Playbook da Etapa"
            >
              <BookOpen className="w-4 h-4 text-indigo-500" />
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
              ${(isDraggedOver ?? snapshot.isDraggingOver) ? 'bg-blue-50' : ''}
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
                  {t('board.column.emptyTitle')}
                </p>
                <p className="text-xs text-gray-400">
                  {t('board.column.emptyHint')}
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
                  onChatClick={onLeadClick}
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
              {stage.stage_type === 'won' ? t('board.column.stageFooterWon') : t('board.column.stageFooterLost')}
            </span>
            <span className="font-semibold text-gray-700">
              {displayCount === 1
                ? t('board.column.opportunityCount_one', { count: displayCount })
                : t('board.column.opportunityCount_other', { count: displayCount })}
            </span>
          </div>
        </div>
      )}

      {/* Footer: Carregar mais (Fase 3) */}
      {hasMore && onLoadMore && (
        <div className="px-4 py-3 border-t bg-gray-50 rounded-b-lg">
          <p className="text-xs text-gray-400 text-center mb-2">
            {t('board.column.showingLoaded', { loaded: loadedCount, total: displayCount })}
          </p>
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="w-full text-xs font-medium text-center py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            {loading
              ? t('board.column.loadMoreLoading')
              : isLastPage
                ? (nextLoadCount === 1
                    ? t('board.column.loadMoreRemaining_one', { count: nextLoadCount })
                    : t('board.column.loadMoreRemaining_other', { count: nextLoadCount }))
                : t('board.column.loadMoreNext', { count: nextLoadCount })
            }
          </button>
        </div>
      )}
    </div>
  )
}
