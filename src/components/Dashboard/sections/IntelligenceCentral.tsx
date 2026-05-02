// =====================================================
// IntelligenceCentral
// Seção de inteligência automática do Dashboard.
// Exibe até 5 insights calculados por SQL/regras — sem LLM.
//
// Cada insight tem botão de ação que abre EntityListDrawer
// com os filtros específicos do insight + filtros globais.
// =====================================================

import React from 'react'
import { Flame, TrendingDown, AlertTriangle, Bot, Clock, ChevronRight } from 'lucide-react'
import { EntityListDrawer }      from '../interactive/EntityListDrawer'
import { useInteractiveMetrics } from '../../../hooks/dashboard/useInteractiveMetrics'
import type { EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { InsightItem, InsightPriority, InsightType, DashboardFilters } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface IntelligenceCentralProps {
  data:            InsightItem[]
  loading:         boolean
  error:           string | null
  dashboardFilters: DashboardFilters
  periodLabel:     string
}

// ---------------------------------------------------------------------------
// Configuração visual por tipo
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<InsightType, { icon: React.ReactNode; label: string }> = {
  hot_opportunity:    { icon: <Flame      size={16} />, label: 'Oportunidade' },
  cooling_opportunity:{ icon: <Clock      size={16} />, label: 'Atenção'      },
  funnel_bottleneck:  { icon: <AlertTriangle size={16} />, label: 'Gargalo'   },
  conversion_drop:    { icon: <TrendingDown  size={16} />, label: 'Conversão' },
  ai_tool_issue:      { icon: <Bot        size={16} />, label: 'IA'           },
}

const PRIORITY_COLORS: Record<InsightPriority, string> = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  high:     'bg-orange-50 border-orange-200 text-orange-700',
  medium:   'bg-yellow-50 border-yellow-200 text-yellow-700',
  low:      'bg-blue-50 border-blue-200 text-blue-700',
}

const PRIORITY_BADGE: Record<InsightPriority, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-blue-100 text-blue-700',
}

const PRIORITY_LABEL: Record<InsightPriority, string> = {
  critical: 'Crítico',
  high:     'Alto',
  medium:   'Médio',
  low:      'Baixo',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDrawerFilters(
  insight: InsightItem,
  dashboardFilters: DashboardFilters,
): EntityListFilters {
  const base: EntityListFilters = {
    period:   dashboardFilters.period,
    funnelId: (insight.filters.funnelId as string | null | undefined) ?? dashboardFilters.funnelId ?? null,
  }

  if (insight.filters.stage_id)        base.stage_id        = insight.filters.stage_id as string
  if (insight.filters.status)          base.status          = insight.filters.status as string
  if (insight.filters.probability_min) base.probability_min = insight.filters.probability_min as number

  return base
}

function resolveEntityType(insight: InsightItem): 'opportunities' | 'leads' | 'conversations' {
  if (insight.entityType === 'funnel') return 'opportunities'
  if (insight.entityType === 'leads' || insight.entityType === 'conversations') return insight.entityType
  return 'opportunities'
}

// ---------------------------------------------------------------------------
// InsightCard
// ---------------------------------------------------------------------------

interface InsightCardProps {
  insight:         InsightItem
  dashboardFilters: DashboardFilters
  onAction:        (insight: InsightItem) => void
}

function InsightCard({ insight, onAction }: InsightCardProps) {
  const cfg       = TYPE_CONFIG[insight.type]
  const cardClass = PRIORITY_COLORS[insight.priority]
  const badgeClass = PRIORITY_BADGE[insight.priority]

  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${cardClass}`}>
      {/* Ícone */}
      <div className="mt-0.5 flex-shrink-0 opacity-70">
        {cfg.icon}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeClass}`}>
            {PRIORITY_LABEL[insight.priority]}
          </span>
          <span className="text-xs opacity-60">{cfg.label}</span>
        </div>
        <p className="text-sm font-semibold leading-snug truncate">{insight.title}</p>
        <p className="text-xs opacity-70 mt-0.5 leading-snug">{insight.description}</p>
      </div>

      {/* Ação */}
      <button
        type="button"
        onClick={() => onAction(insight)}
        className="flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-md border border-current/20 hover:bg-current/10 transition-colors flex-shrink-0 whitespace-nowrap"
      >
        {insight.actionLabel}
        <ChevronRight size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntelligenceCentral
// ---------------------------------------------------------------------------

export const IntelligenceCentral: React.FC<IntelligenceCentralProps> = ({
  data,
  loading,
  error,
  dashboardFilters,
  periodLabel,
}) => {
  const { drawer, openDrawer, closeDrawer } = useInteractiveMetrics()

  const handleAction = (insight: InsightItem) => {
    const entityType    = resolveEntityType(insight)
    const drawerFilters = buildDrawerFilters(insight, dashboardFilters)
    openDrawer(entityType, insight.title, insight.description, drawerFilters)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      {/* Cabeçalho */}
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Inteligência Comercial</h2>
        <p className="text-xs text-gray-400 mt-0.5">Insights automáticos · {periodLabel}</p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Erro controlado */}
      {!loading && error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Vazio */}
      {!loading && !error && data.length === 0 && (
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Nenhum insight crítico no período selecionado
        </div>
      )}

      {/* Lista de insights */}
      {!loading && !error && data.length > 0 && (
        <div className="space-y-2">
          {data.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              dashboardFilters={dashboardFilters}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawer.open && drawer.entityType && (
        <EntityListDrawer
          open={drawer.open}
          onClose={closeDrawer}
          title={drawer.title}
          description={drawer.description}
          entityType={drawer.entityType}
          filters={drawer.filters}
          primaryAction={{ label: 'Abrir', onClick: () => {} }}
        />
      )}
    </div>
  )
}
