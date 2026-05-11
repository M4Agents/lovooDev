import React from 'react'
import {
  AlertTriangle, MessageCircle, TrendingDown, User, Zap,
  Clock, ChevronRight,
} from 'lucide-react'
import type { PriorityAlertItem, PriorityAlertType } from '../../../types/dashboard'

interface PriorityAlertsSectionProps {
  data:    { alerts: PriorityAlertItem[]; total: number; critical: number; high: number } | null
  loading: boolean
  error:   string | null
}

function alertIcon(type: PriorityAlertType) {
  switch (type) {
    case 'sla_critical':        return MessageCircle
    case 'sla_high':            return Clock
    case 'stalled_opportunity': return TrendingDown
    case 'seller_risk':         return User
    default:                    return Zap
  }
}

function alertColors(severity: 'critical' | 'high') {
  if (severity === 'critical') {
    return {
      badge:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      icon:   'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400',
      border: 'border-red-100 dark:border-red-900/40',
    }
  }
  return {
    badge:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    icon:   'bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400',
    border: 'border-amber-100 dark:border-amber-900/40',
  }
}

function AlertRow({ item }: { item: PriorityAlertItem }) {
  const Icon   = alertIcon(item.type)
  const colors = alertColors(item.severity)

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${colors.border} bg-white dark:bg-gray-800`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{item.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{item.description}</p>
      </div>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${colors.badge}`}>
        {item.severity === 'critical' ? 'Crítico' : 'Alto'}
      </span>
    </div>
  )
}

export function PriorityAlertsSection({ data, loading, error }: PriorityAlertsSectionProps) {
  if (loading) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 animate-pulse">
        <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="space-y-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900 p-5">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  const alerts = data?.alerts ?? []
  const hasAlerts = alerts.length > 0

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            Alertas Prioritários
          </h3>
        </div>
        {data && (data.critical > 0 || data.high > 0) && (
          <div className="flex items-center gap-1.5">
            {data.critical > 0 && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                {data.critical} crítico{data.critical > 1 ? 's' : ''}
              </span>
            )}
            {data.high > 0 && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                {data.high} alto{data.high > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      {!hasAlerts ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20 mb-3">
            <AlertTriangle className="h-6 w-6 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Nenhum alerta no momento</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Todos os leads estão sendo atendidos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((item, idx) => (
            <AlertRow key={`${item.type}-${item.entity_id}-${idx}`} item={item} />
          ))}
          {(data?.total ?? 0) > alerts.length && (
            <button className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors">
              <span>Ver mais {(data?.total ?? 0) - alerts.length} alertas</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
