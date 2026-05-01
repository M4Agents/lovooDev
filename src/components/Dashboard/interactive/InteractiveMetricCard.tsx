// =====================================================
// InteractiveMetricCard
// Card de KPI clicável que respeita o padrão visual do projeto.
// Estende o estilo de Card (rounded-2xl, shadow-sm, border-gray-100).
// Sem lógica de negócio — recebe tudo via props.
// =====================================================

import React from 'react'

export type TrendDirection = 'up' | 'down' | 'neutral'

export type CardAccent = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray'

export interface InteractiveMetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  accent?: CardAccent
  trend?: {
    value: string      // ex: "+12%" ou "−3 leads"
    direction: TrendDirection
  }
  /** Texto exibido abaixo do valor quando loading=false e valor=0 */
  emptyLabel?: string
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  className?: string
}

// ---------------------------------------------------------------------------
// Mapa de cores por accent
// ---------------------------------------------------------------------------

const accentMap: Record<CardAccent, { icon: string; badge: string; ring: string }> = {
  blue:   { icon: 'bg-blue-50 text-blue-600',    badge: 'bg-blue-100 text-blue-700',   ring: 'focus:ring-blue-500'   },
  green:  { icon: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-100 text-emerald-700', ring: 'focus:ring-emerald-500' },
  orange: { icon: 'bg-orange-50 text-orange-600',  badge: 'bg-orange-100 text-orange-700',  ring: 'focus:ring-orange-500'  },
  red:    { icon: 'bg-red-50 text-red-600',      badge: 'bg-red-100 text-red-700',     ring: 'focus:ring-red-500'    },
  purple: { icon: 'bg-purple-50 text-purple-600',  badge: 'bg-purple-100 text-purple-700',  ring: 'focus:ring-purple-500'  },
  gray:   { icon: 'bg-gray-50 text-gray-500',    badge: 'bg-gray-100 text-gray-600',   ring: 'focus:ring-gray-400'   },
}

const trendClasses: Record<TrendDirection, string> = {
  up:      'text-emerald-600',
  down:    'text-red-500',
  neutral: 'text-gray-400',
}

const trendArrow: Record<TrendDirection, string> = {
  up:      '↗',
  down:    '↘',
  neutral: '→',
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export const InteractiveMetricCard: React.FC<InteractiveMetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  accent = 'blue',
  trend,
  emptyLabel,
  disabled = false,
  loading = false,
  onClick,
  className = '',
}) => {
  const colors = accentMap[accent]
  const isClickable = !!onClick && !disabled && !loading

  const baseClasses = [
    'bg-white rounded-2xl shadow-sm border border-gray-100',
    'transition-all duration-200 ease-in-out p-5',
    'relative overflow-hidden',
    isClickable
      ? `cursor-pointer hover:shadow-md hover:border-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${colors.ring}`
      : '',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick?.()
    }
  }

  return (
    <div
      className={baseClasses}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `Ver detalhes: ${title}` : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
    >
      {/* Indicador visual de clicável */}
      {isClickable && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-xs text-gray-400">↗</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        {/* Conteúdo principal */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 mb-1 truncate">{title}</p>

          {loading ? (
            <div className="space-y-2">
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded" />
              {subtitle && <div className="h-3 w-32 bg-gray-100 animate-pulse rounded" />}
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 leading-none mb-1">
                {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
              </p>

              {subtitle && (
                <p className="text-xs text-gray-500 truncate">{subtitle}</p>
              )}

              {/* Valor zero com label alternativo */}
              {value === 0 && emptyLabel && (
                <p className="text-xs text-gray-400 italic">{emptyLabel}</p>
              )}

              {/* Tendência */}
              {trend && (
                <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trendClasses[trend.direction]}`}>
                  <span aria-hidden="true">{trendArrow[trend.direction]}</span>
                  <span>{trend.value}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Ícone */}
        {icon && (
          <div className={`p-3 rounded-xl flex-shrink-0 ${colors.icon}`}>
            {icon}
          </div>
        )}
      </div>

      {/* Indicador de clicável no rodapé */}
      {isClickable && (
        <div className="mt-3 pt-2 border-t border-gray-50">
          <span className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Ver detalhes →
          </span>
        </div>
      )}
    </div>
  )
}
