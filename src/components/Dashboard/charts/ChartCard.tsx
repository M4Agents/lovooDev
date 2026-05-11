// =====================================================
// ChartCard — wrapper base para gráficos da dashboard.
// Exibe título, badge de período e estados de
// loading / error / empty de forma padronizada.
// =====================================================

import React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface ChartCardProps {
  title:      string
  subtitle?:  string
  loading?:   boolean
  error?:     string | null
  empty?:     boolean
  emptyText?: string
  onRetry?:   () => void
  children:   React.ReactNode
  className?: string
  /** Altura mínima do corpo do card (default: 220px) */
  minHeight?: number
}

export function ChartCard({
  title,
  subtitle,
  loading,
  error,
  empty,
  emptyText = 'Sem dados no período selecionado',
  onRetry,
  children,
  className = '',
  minHeight = 220,
}: ChartCardProps) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-gray-800 leading-tight">{title}</h3>
        {subtitle && (
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Body */}
      <div style={{ minHeight }} className="px-2 pb-4 flex items-center justify-center">
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <ChartError message={error} onRetry={onRetry} />
        ) : empty ? (
          <ChartEmpty message={emptyText} />
        ) : (
          <div className="w-full">{children}</div>
        )}
      </div>
    </div>
  )
}

// ── Estado: loading ───────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="w-full flex items-end gap-2 px-4 pb-2" style={{ height: 140 }}>
      {[40, 65, 50, 80, 55, 70, 45].map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t animate-pulse bg-gray-100"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}

// ── Estado: erro ──────────────────────────────────────────────────────────────

function ChartError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center px-4 py-6">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-xs text-gray-500 max-w-xs">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1"
        >
          <RefreshCw className="w-3 h-3" />
          Tentar novamente
        </button>
      )}
    </div>
  )
}

// ── Estado: vazio ─────────────────────────────────────────────────────────────

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center px-4 py-6">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
        <span className="text-gray-400 text-sm">—</span>
      </div>
      <p className="text-xs text-gray-400">{message}</p>
    </div>
  )
}
