// =====================================================
// COMPONENTE: ContactCycleTimeline
// Objetivo: visualizar a jornada completa dos ciclos de contato
//           da oportunidade em formato de linha do tempo,
//           seguindo o mesmo padrão visual de OpportunityStageTimeline.
// =====================================================

import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw, XCircle, Trophy, Phone, MessageCircle,
  MessageSquare, Cpu, ChevronDown, ChevronUp,
  Clock, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { contactCycleApi } from '../../services/contactCycleApi'
import { getCloseReasonKey, getTriggerReasonKey } from '../../utils/cycleLabels'
import { AnswersList } from './AnswersList'
import type { ContactCycleHistoryItem, ContactAttemptDetail, CycleStatus } from '../../types/contact-cycles'
import type { AttemptsByCycle } from '../../hooks/useContactCyclePanel'

// =====================================================
// Tipos internos de eventos da timeline
// =====================================================

type CycleTimelineEvent =
  | { kind: 'cycle_open';  at: string; cycle: ContactCycleHistoryItem;  cycleIndex: number }
  | { kind: 'cycle_close'; at: string; cycle: ContactCycleHistoryItem;  cycleIndex: number }
  | { kind: 'attempt';     at: string; attempt: ContactAttemptDetail;   cycleStatus: CycleStatus }

// =====================================================
// Utilitários
// =====================================================

function secondsSince(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
}

function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60)         return `${m}min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24)         return rm > 0 ? `${h}h ${rm}min` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

// =====================================================
// Configurações visuais por tipo de evento
// =====================================================

type EventVisual = { iconBg: string; iconFg: string; badgeClass: string; label: string }

function getCycleOpenVisual(): EventVisual {
  return {
    iconBg:     'bg-green-100',
    iconFg:     'text-green-700',
    badgeClass: 'bg-green-100 text-green-700',
    label:      '',  // preenchido no componente com t()
  }
}

function getCycleCloseVisual(reason: string | null): EventVisual {
  switch (reason) {
    case 'goal_reached':    return { iconBg: 'bg-amber-100',    iconFg: 'text-amber-700',    badgeClass: 'bg-amber-100 text-amber-700',    label: '' }
    case 'inbound_received':return { iconBg: 'bg-emerald-100',  iconFg: 'text-emerald-700',  badgeClass: 'bg-emerald-100 text-emerald-700',label: '' }
    case 'no_response':     return { iconBg: 'bg-gray-100',     iconFg: 'text-gray-500',     badgeClass: 'bg-gray-100 text-gray-500',     label: '' }
    default:                return { iconBg: 'bg-red-50',       iconFg: 'text-red-400',      badgeClass: 'bg-red-50 text-red-500',        label: '' }
  }
}

function getAttemptVisual(trigger: ContactAttemptDetail['trigger_reason'], cancelled: boolean): EventVisual {
  if (cancelled) {
    return { iconBg: 'bg-red-50', iconFg: 'text-red-400', badgeClass: 'bg-red-50 text-red-400', label: '' }
  }
  switch (trigger) {
    case 'whatsapp_sent':     return { iconBg: 'bg-blue-100',   iconFg: 'text-blue-700',   badgeClass: 'bg-blue-100 text-blue-700',   label: '' }
    case 'whatsapp_received': return { iconBg: 'bg-cyan-100',   iconFg: 'text-cyan-700',   badgeClass: 'bg-cyan-100 text-cyan-700',   label: '' }
    case 'manual':            return { iconBg: 'bg-indigo-100', iconFg: 'text-indigo-700', badgeClass: 'bg-indigo-100 text-indigo-700',label: '' }
    case 'system':            return { iconBg: 'bg-purple-100', iconFg: 'text-purple-700', badgeClass: 'bg-purple-100 text-purple-700',label: '' }
    default:                  return { iconBg: 'bg-gray-100',   iconFg: 'text-gray-500',   badgeClass: 'bg-gray-100 text-gray-500',   label: '' }
  }
}

function getCycleOpenIcon(size: string) { return <RefreshCw className={size} /> }

function getCycleCloseIcon(reason: string | null, size: string) {
  switch (reason) {
    case 'goal_reached':     return <Trophy        className={size} />
    case 'inbound_received': return <CheckCircle2  className={size} />
    default:                 return <XCircle       className={size} />
  }
}

function getAttemptIcon(trigger: ContactAttemptDetail['trigger_reason'], cancelled: boolean, size: string) {
  if (cancelled) return <XCircle className={size} />
  switch (trigger) {
    case 'whatsapp_sent':     return <MessageCircle  className={size} />
    case 'whatsapp_received': return <MessageSquare  className={size} />
    case 'manual':            return <Phone          className={size} />
    case 'system':            return <Cpu            className={size} />
    default:                  return <Phone          className={size} />
  }
}

// =====================================================
// Construção da lista de eventos
// =====================================================

function buildEvents(
  cycles: ContactCycleHistoryItem[],
  attemptsByCycle: AttemptsByCycle,
): CycleTimelineEvent[] {
  // Mais recentes primeiro
  const sorted = [...cycles].sort(
    (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
  )

  const events: CycleTimelineEvent[] = []

  sorted.forEach((cycle, idx) => {
    const cycleIndex = sorted.length - idx  // Ciclo #N do mais antigo para o mais recente

    // 1. Fechamento (se existir) → aparece no topo por ser mais recente
    if (cycle.status === 'closed' && cycle.closed_at) {
      events.push({ kind: 'cycle_close', at: cycle.closed_at, cycle, cycleIndex })
    }

    // 2. Tentativas — mais recentes primeiro
    const attempts = (attemptsByCycle[cycle.cycle_id] ?? [])
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    for (const attempt of attempts) {
      events.push({ kind: 'attempt', at: attempt.created_at, attempt, cycleStatus: cycle.status })
    }

    // 3. Abertura do ciclo → aparece por último (mais antigo)
    events.push({ kind: 'cycle_open', at: cycle.opened_at, cycle, cycleIndex })
  })

  return events
}

// =====================================================
// Item da timeline
// =====================================================

interface TimelineNodeProps {
  event:         CycleTimelineEvent
  isLast:        boolean
  canOperate:    boolean
  opportunityId: string
  companyId:     string
  refresh:       () => void
  fmtDate:       (iso?: string | null) => string
}

const TimelineNode: React.FC<TimelineNodeProps> = ({
  event, isLast, canOperate, opportunityId, companyId, refresh, fmtDate
}) => {
  const { t } = useTranslation('funnel')
  const [expanded,    setExpanded]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [cancelling,  setCancelling]  = useState(false)

  const ICON_SIZE = 'w-3.5 h-3.5'

  // ── Visual ───────────────────────────────────────
  let visual: EventVisual
  let icon: React.ReactNode
  let title: string
  let subtitle: React.ReactNode = null
  let badge: string | null = null
  let isCurrentOpenCycle = false

  if (event.kind === 'cycle_open') {
    visual = getCycleOpenVisual()
    icon   = getCycleOpenIcon(ICON_SIZE)
    title  = t('contactCycle.cycleOpenedEvent')
    badge  = t('contactCycle.cycleLabel', { number: event.cycleIndex })
    if (event.cycle.status === 'open') {
      isCurrentOpenCycle = true
    }
    subtitle = (
      <p className="text-xs text-gray-400 mt-0.5">
        {t('contactCycle.totalAttempts', { count: event.cycle.attempt_count })}
      </p>
    )
  } else if (event.kind === 'cycle_close') {
    visual = getCycleCloseVisual(event.cycle.close_reason)
    icon   = getCycleCloseIcon(event.cycle.close_reason, ICON_SIZE)
    title  = t('contactCycle.cycleClosedEvent')
    badge  = event.cycle.close_reason ? t(getCloseReasonKey(event.cycle.close_reason)) : null
  } else {
    // attempt
    const att        = event.attempt
    const cancelled  = Boolean(att.cancelled_at)
    visual           = getAttemptVisual(att.trigger_reason, cancelled)
    icon             = getAttemptIcon(att.trigger_reason, cancelled, ICON_SIZE)
    title            = t(getTriggerReasonKey(att.trigger_reason))
    badge            = att.reason_label ?? null

    const hasDetails = att.notes || att.answers.length > 0

    subtitle = (
      <div>
        {cancelled && (
          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium mt-0.5">
            {t('contactCycle.attemptCancelledBadge')}
          </span>
        )}
        {att.notes && (
          <p className="text-xs text-gray-500 mt-0.5 italic">{att.notes}</p>
        )}
        {hasDetails && att.answers.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {t('contactCycle.answersTitle')}
          </button>
        )}
        {expanded && <AnswersList answers={att.answers} />}
      </div>
    )

    // Botão cancelar (somente se canOperate e não cancelada)
    if (canOperate && !cancelled && event.cycleStatus === 'open') {
      subtitle = (
        <div>
          {att.notes && <p className="text-xs text-gray-500 mt-0.5 italic">{att.notes}</p>}
          {att.answers.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {t('contactCycle.answersTitle')}
            </button>
          )}
          {expanded && <AnswersList answers={att.answers} />}
          <div className="mt-1.5">
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded transition-colors"
              >
                {t('contactCycle.cancelAttemptBtn')}
              </button>
            ) : (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-gray-600">{t('contactCycle.cancelAttemptConfirm')}</span>
                <button
                  onClick={async () => {
                    setCancelling(true)
                    try {
                      await contactCycleApi.cancelAttempt(opportunityId, att.attempt_id, companyId)
                      refresh()
                    } catch { /* silenciado */ }
                    finally { setCancelling(false); setShowConfirm(false) }
                  }}
                  disabled={cancelling}
                  className="text-xs text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded disabled:opacity-50 transition-colors"
                >
                  {cancelling ? t('contactCycle.cancelAttemptLoading') : t('contactCycle.cancelAttemptConfirmYes')}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={cancelling}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-0.5 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  {t('contactCycle.cancelAttemptCancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }
  }

  return (
    <div className="flex gap-3">
      {/* Ícone + linha vertical */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${visual.iconBg} ${visual.iconFg}`}>
          {icon}
        </div>
        {!isLast && (
          <div className="w-px flex-1 my-1 min-h-[16px] bg-gray-200" />
        )}
      </div>

      {/* Conteúdo */}
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Título + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-800">{title}</p>

              {badge && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${visual.badgeClass}`}>
                  {icon}
                  {badge}
                </span>
              )}

              {isCurrentOpenCycle && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500 text-white">
                  {t('contactCycle.currentCycleLabel')}
                </span>
              )}
            </div>

            {/* Subtítulo/extras */}
            {subtitle}
          </div>

          {/* Data */}
          <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
            {fmtDate(event.at)}
          </span>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Props
// =====================================================

interface ContactCycleTimelineProps {
  cycles:          ContactCycleHistoryItem[]
  attemptsByCycle: AttemptsByCycle
  canOperate:      boolean
  opportunityId:   string
  companyId:       string
  refresh:         () => void
}

// =====================================================
// Componente principal
// =====================================================

const COLLAPSE_THRESHOLD = 10

export function ContactCycleTimeline({
  cycles,
  attemptsByCycle,
  canOperate,
  opportunityId,
  companyId,
  refresh,
}: ContactCycleTimelineProps) {
  const { t }              = useTranslation('funnel')
  const { companyTimezone } = useAuth()
  const [expanded, setExpanded] = useState(false)

  const fmtDate = (iso?: string | null): string => {
    if (!iso) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: companyTimezone,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  }

  const events = useMemo(
    () => buildEvents(cycles, attemptsByCycle),
    [cycles, attemptsByCycle],
  )

  // Métricas resumo
  const summary = useMemo(() => {
    const totalCycles   = cycles.length
    const closedCycles  = cycles.filter(c => c.status === 'closed').length
    const totalAttempts = cycles.reduce((sum, c) => sum + c.attempt_count, 0)
    const avgAttempts   = totalCycles > 0
      ? (totalAttempts / totalCycles).toFixed(1)
      : '0'

    // Ciclo aberto atual
    const openCycle = cycles.find(c => c.status === 'open') ?? null
    const openSinceSeconds = openCycle ? secondsSince(openCycle.opened_at) : 0

    return { totalCycles, closedCycles, totalAttempts, avgAttempts, openCycle, openSinceSeconds }
  }, [cycles])

  if (cycles.length === 0) return null

  // Colapso
  const shouldCollapse    = events.length > COLLAPSE_THRESHOLD && !expanded
  const visibleEvents     = shouldCollapse
    ? [...events.slice(0, 5), events[events.length - 1]]
    : events
  const hiddenCount       = events.length - 6

  return (
    <div className="space-y-4">
      {/* Bloco: Ciclo Atual */}
      <div
        className="rounded-lg p-3 border"
        style={summary.openCycle
          ? { backgroundColor: '#EEF2FF', borderColor: '#A5B4FC' }
          : { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-0.5 text-gray-500">
              {t('contactCycle.currentCycleTitle')}
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {summary.openCycle
                ? t('contactCycle.cycleStatus.open')
                : t('contactCycle.cycleStatus.closed')}
            </p>
          </div>
          {summary.openCycle && summary.openSinceSeconds > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-0.5">{t('contactCycle.cycleOpenSince', {
                duration: formatDuration(summary.openSinceSeconds),
              })}</p>
              <p className="text-xs font-medium text-indigo-700">
                {t('contactCycle.totalAttempts', { count: summary.openCycle.attempt_count })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bloco: Resumo */}
      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          {t('contactCycle.summaryTitle')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-gray-500">{t('contactCycle.summaryTotalCycles')}</p>
            <p className="text-sm font-semibold text-gray-800">{summary.totalCycles}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('contactCycle.summaryClosedCycles')}</p>
            <p className="text-sm font-semibold text-gray-800">{summary.closedCycles}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('contactCycle.summaryTotalAttempts')}</p>
            <p className="text-sm font-semibold text-gray-800">{summary.totalAttempts}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('contactCycle.summaryAvgAttempts')}</p>
            <p className="text-sm font-semibold text-gray-800">{summary.avgAttempts}</p>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          {t('contactCycle.timelineSectionTitle')}
        </p>

        <div>
          {visibleEvents.map((event, idx) => {
            const isLast   = idx === visibleEvents.length - 1
            const eventKey = event.kind === 'attempt'
              ? `attempt-${event.attempt.attempt_id}`
              : `${event.kind}-${event.cycle.cycle_id}`

            const isCollapseSeparatorPosition = shouldCollapse && idx === 4

            return (
              <React.Fragment key={eventKey}>
                {isCollapseSeparatorPosition && (
                  <div className="flex gap-3 my-1">
                    <div className="flex flex-col items-center">
                      <div className="w-px flex-1 bg-gray-200" style={{ minHeight: '12px' }} />
                    </div>
                    <button
                      onClick={() => setExpanded(true)}
                      className="flex items-center gap-1.5 mb-3 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      {hiddenCount === 1
                        ? t('contactCycle.collapseShowHidden_one', { count: hiddenCount })
                        : t('contactCycle.collapseShowHidden_other', { count: hiddenCount })
                      }
                    </button>
                  </div>
                )}

                <TimelineNode
                  event={event}
                  isLast={isLast}
                  canOperate={canOperate}
                  opportunityId={opportunityId}
                  companyId={companyId}
                  refresh={refresh}
                  fmtDate={fmtDate}
                />
              </React.Fragment>
            )
          })}
        </div>

        {/* Recolher (quando expandido) */}
        {!shouldCollapse && events.length > COLLAPSE_THRESHOLD && (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded transition-colors mt-1"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            {t('contactCycle.collapseHide')}
          </button>
        )}
      </div>
    </div>
  )
}
