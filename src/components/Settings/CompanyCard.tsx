import React from 'react'
import {
  Building2, Globe, Clock, CalendarClock,
  Edit2, Trash2, LogIn, Gift, Layers,
} from 'lucide-react'
import type { ClientCompany, TrialInfo, ViewMode } from './companiesTypes'

// ── Helpers exportados para reuso no painel ───────────────────────────────────

export function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000)
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString('pt-BR')
}

export function statusLabel(status: string): string {
  if (status === 'active')    return 'Ativo'
  if (status === 'suspended') return 'Suspenso'
  return 'Cancelado'
}

export function statusColor(status: string): string {
  if (status === 'active')    return 'bg-green-100 text-green-800'
  if (status === 'suspended') return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  comp:           ClientCompany
  trial:          TrialInfo | null | undefined
  isLoadingTrial: boolean
  isFree:         boolean
  isSaaSAdmin:    boolean
  isSystemAdmin:  boolean
  viewMode:       ViewMode
  onEdit:         (comp: ClientCompany) => void
  onDelete:       (comp: ClientCompany) => void
  onExtend:       (comp: ClientCompany) => void
  onFreePlan:     (comp: ClientCompany) => void
  onSetPlan:      (comp: ClientCompany) => void
  onImpersonate:  (comp: ClientCompany) => void
}

// ── Componente ────────────────────────────────────────────────────────────────

export const CompanyCard: React.FC<Props> = ({
  comp, trial, isLoadingTrial, isFree,
  isSaaSAdmin, isSystemAdmin, viewMode,
  onEdit, onDelete, onExtend, onFreePlan, onSetPlan, onImpersonate,
}) => {
  const days = trial ? daysUntil(trial.trial_end) : null

  // ── Subcomponente reutilizado em ambos os modos ───────────────────────────

  const trialInfo = !isFree && (
    isLoadingTrial ? (
      <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
    ) : trial?.is_internal_trial ? (
      <div className="flex items-center gap-1 text-xs">
        <CalendarClock className="w-3 h-3 text-amber-500 shrink-0" />
        {days !== null && days > 0 ? (
          <span className="text-amber-700 font-medium">{days}d trial</span>
        ) : days !== null && days <= 0 ? (
          <span className="text-red-600 font-medium">Trial expirado</span>
        ) : (
          <span className="text-slate-500">Expira {formatDate(trial.trial_end)}</span>
        )}
        {trial.trial_extended && <span className="text-slate-400">(est.)</span>}
      </div>
    ) : null
  )

  const actions = (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        onClick={() => onEdit(comp)}
        className="flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
        title="Editar"
      >
        <Edit2 className="w-3 h-3" /> Editar
      </button>

      {trial?.can_extend && !isFree && (
        <button
          onClick={() => onExtend(comp)}
          className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded transition-colors"
          title="Estender trial"
        >
          <Clock className="w-3 h-3" /> +14d
        </button>
      )}

      {isSaaSAdmin && (
        <button
          onClick={() => onFreePlan(comp)}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
            isFree
              ? 'text-emerald-700 hover:bg-emerald-50'
              : 'text-slate-500 hover:bg-slate-100'
          }`}
          title={isFree ? 'Revogar plano gratuito' : 'Marcar como gratuito'}
        >
          <Gift className="w-3 h-3" />
          {isFree ? 'Grátis ✓' : 'Grátis'}
        </button>
      )}

      {isSaaSAdmin && (
        <button
          onClick={() => onSetPlan(comp)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
          title="Definir plano"
        >
          <Layers className="w-3 h-3" /> Plano
        </button>
      )}

      {(isSaaSAdmin || isSystemAdmin) && (
        <button
          onClick={() => onImpersonate(comp)}
          className="flex items-center gap-1 text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded transition-colors"
          title="Entrar como"
        >
          <LogIn className="w-3 h-3" /> Entrar
        </button>
      )}

      <button
        onClick={() => onDelete(comp)}
        className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors ml-auto"
        title="Excluir"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )

  // ── Modo lista ────────────────────────────────────────────────────────────

  if (viewMode === 'list') {
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 hover:shadow-sm transition-shadow flex items-center gap-4">
        <div className="p-1.5 bg-blue-50 rounded-md shrink-0">
          <Building2 className="w-4 h-4 text-blue-600" />
        </div>

        <div className="min-w-0 w-44 shrink-0">
          <p className="font-medium text-slate-900 truncate text-sm">{comp.name}</p>
          {comp.domain && (
            <p className="text-xs text-slate-400 flex items-center gap-0.5 truncate">
              <Globe className="w-2.5 h-2.5 shrink-0" />{comp.domain}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(comp.status)}`}>
            {statusLabel(comp.status)}
          </span>
        </div>

        <div className="w-32 shrink-0 flex items-center gap-1.5">
          {isFree ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <Gift className="w-3 h-3" /> Grátis
            </span>
          ) : (comp as any).plans?.name ? (
            <span className="text-xs text-slate-500 truncate">{(comp as any).plans.name}</span>
          ) : (
            <span className="text-xs text-slate-400 italic">Sem plano</span>
          )}
        </div>

        <div className="w-36 shrink-0">{trialInfo}</div>

        <div className="ml-auto shrink-0">{actions}</div>
      </div>
    )
  }

  // ── Modo grade ────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-blue-50 rounded-lg shrink-0">
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate">{comp.name}</p>
            {comp.domain && (
              <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
                <Globe className="w-3 h-3" />{comp.domain}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isFree && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <Gift className="w-3 h-3" /> Gratuito
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(comp.status)}`}>
            {statusLabel(comp.status)}
          </span>
        </div>
      </div>

      {(comp as any).plans?.name && (
        <p className="text-xs text-slate-500">
          Plano: <span className="font-medium">{(comp as any).plans.name}</span>
        </p>
      )}

      {!isFree && (
        isLoadingTrial ? (
          <div className="h-5 w-24 bg-slate-100 rounded animate-pulse" />
        ) : trial?.is_internal_trial ? (
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
            {days !== null && days > 0 ? (
              <span className="text-amber-700 font-medium">{days} dias de trial</span>
            ) : days !== null && days <= 0 ? (
              <span className="text-red-600 font-medium">Trial expirado</span>
            ) : (
              <span className="text-slate-500">Expira {formatDate(trial.trial_end)}</span>
            )}
            {trial.trial_extended && <span className="ml-1 text-slate-400">(estendido)</span>}
          </div>
        ) : null
      )}

      <div className="pt-1">{actions}</div>
    </div>
  )
}
