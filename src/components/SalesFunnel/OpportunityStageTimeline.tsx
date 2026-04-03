// =====================================================
// COMPONENTE: OpportunityStageTimeline
// Objetivo: visualizar a jornada completa da oportunidade
//           no funil — etapas percorridas, duração, eventos.
//
// Semântica dos campos:
//   stage_entered_at = quando entrou em from_stage
//   stage_left_at    = quando saiu de from_stage (= quando entrou em to_stage)
//   duration_seconds = permanência em from_stage
//
//   Tempo na etapa atual (aberta) = calculado a partir de
//   currentEnteredAt (opportunity_funnel_positions.entered_stage_at)
// =====================================================

import React, { useRef, useEffect, useState } from 'react'
import {
  LogIn, ArrowRight, Trophy, XCircle, RotateCcw,
  Clock, AlertCircle, ChevronDown, ChevronUp, Timer
} from 'lucide-react'
import type { OpportunityStageHistory } from '../../types/sales-funnel'

// =====================================================
// Utilitários
// =====================================================

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return `${hours}h ${remainingMinutes}min`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h ${remainingMinutes}min`
}

function formatDateShort(iso?: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso))
}

function secondsSince(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
}

// =====================================================
// Configurações visuais por move_type
// =====================================================

type MoveType = 'funnel_entry' | 'stage_change' | 'won' | 'lost' | 'reopened'

const moveTypeConfig: Record<MoveType, {
  icon: React.ReactNode
  badgeClass: string
  label: string
}> = {
  funnel_entry: {
    icon: <LogIn className="w-3.5 h-3.5" />,
    badgeClass: 'bg-green-100 text-green-700',
    label: 'Entrada'
  },
  stage_change: {
    icon: <ArrowRight className="w-3.5 h-3.5" />,
    badgeClass: 'bg-blue-100 text-blue-700',
    label: 'Mudança'
  },
  won: {
    icon: <Trophy className="w-3.5 h-3.5" />,
    badgeClass: 'bg-emerald-100 text-emerald-700',
    label: 'Ganhou'
  },
  lost: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    badgeClass: 'bg-red-100 text-red-700',
    label: 'Perdeu'
  },
  reopened: {
    icon: <RotateCcw className="w-3.5 h-3.5" />,
    badgeClass: 'bg-amber-100 text-amber-700',
    label: 'Reaberto'
  }
}

function getMicrocopy(entry: OpportunityStageHistory): string {
  const toName = entry.to_stage?.name ?? 'etapa desconhecida'
  switch (entry.move_type) {
    case 'funnel_entry': return 'Entrou no funil'
    case 'stage_change': return `Movido para ${toName}`
    case 'won':          return 'Fechado como ganho'
    case 'lost':         return 'Fechado como perda'
    case 'reopened':     return 'Reaberto'
    default:             return `Movido para ${toName}`
  }
}

// =====================================================
// Tipos e Props
// =====================================================

interface OpportunityStageTimelineProps {
  history: OpportunityStageHistory[]
  usersMap: Map<string, string>
  currentEnteredAt: string | null   // entered_stage_at da posição atual
  loading: boolean
  error: string | null
  lastEventRef?: React.RefObject<HTMLDivElement>  // para auto-scroll externo
}

// =====================================================
// Bloco de resumo
// =====================================================

interface SummaryData {
  totalSeconds: number
  currentStageSeconds: number
  uniqueStageCount: number
  reentryCount: number
  longestStageName: string | null
  longestStageSeconds: number
  avgStageSeconds: number
}

function computeSummary(
  history: OpportunityStageHistory[],
  currentEnteredAt: string | null
): SummaryData {
  const currentStageSeconds = secondsSince(currentEnteredAt)

  // Tempo total: soma dos duration_seconds históricos + tempo atual aberto
  const historicTotal = history.reduce((sum, h) => sum + (h.duration_seconds ?? 0), 0)
  const totalSeconds  = historicTotal + currentStageSeconds

  // Etapas únicas visitadas (to_stage_id)
  const stageDurations = new Map<string, { name: string; seconds: number }>()
  for (const h of history) {
    const id   = h.to_stage_id
    const name = h.to_stage?.name ?? id
    const prev = stageDurations.get(id) ?? { name, seconds: 0 }
    // Para stage_change/won/lost/reopened, o duration_seconds é da from_stage.
    // A etapa to_stage ainda não tem duração calculada aqui — ela será adicionada
    // quando o próximo evento sair dela. Contamos a duração de from_stage.
    stageDurations.set(h.from_stage_id ?? '', {
      name: h.from_stage?.name ?? (h.from_stage_id ?? ''),
      seconds: (stageDurations.get(h.from_stage_id ?? '')?.seconds ?? 0) + (h.duration_seconds ?? 0)
    })
    // Garantir que to_stage também aparece no map (pode ser a etapa atual)
    if (!stageDurations.has(id)) {
      stageDurations.set(id, { name, seconds: 0 })
    }
    void prev
  }

  // Adicionar tempo atual à etapa corrente
  const lastEntry = history[history.length - 1]
  if (lastEntry && currentStageSeconds > 0) {
    const currentId   = lastEntry.to_stage_id
    const currentName = lastEntry.to_stage?.name ?? currentId
    const existing    = stageDurations.get(currentId) ?? { name: currentName, seconds: 0 }
    stageDurations.set(currentId, { name: currentName, seconds: existing.seconds + currentStageSeconds })
  }

  // Remover entradas sem nome (funnel_entry tem from_stage_id = null → key '')
  stageDurations.delete('')

  const stageArray        = Array.from(stageDurations.values())
  const uniqueStageCount  = stageArray.length

  // Reentradas: contar to_stage_ids repetidos na timeline
  const seenStages = new Set<string>()
  let reentryCount = 0
  for (const h of history) {
    if (h.move_type === 'funnel_entry') continue
    if (seenStages.has(h.to_stage_id)) reentryCount++
    seenStages.add(h.to_stage_id)
  }

  // Etapa mais longa
  let longestStageName:    string | null = null
  let longestStageSeconds: number        = 0
  for (const { name, seconds } of stageArray) {
    if (seconds > longestStageSeconds) {
      longestStageSeconds = seconds
      longestStageName    = name
    }
  }

  const avgStageSeconds = uniqueStageCount > 0
    ? Math.floor(totalSeconds / uniqueStageCount)
    : 0

  return {
    totalSeconds,
    currentStageSeconds,
    uniqueStageCount,
    reentryCount,
    longestStageName,
    longestStageSeconds,
    avgStageSeconds
  }
}

// =====================================================
// Item da timeline
// =====================================================

interface TimelineItemProps {
  entry: OpportunityStageHistory
  isLast: boolean
  isCurrent: boolean
  isReentry: boolean
  usersMap: Map<string, string>
  currentEnteredAt: string | null
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  entry, isLast, isCurrent, isReentry, usersMap, currentEnteredAt
}) => {
  const config     = moveTypeConfig[entry.move_type as MoveType] ?? moveTypeConfig.stage_change
  const microcopy  = getMicrocopy(entry)
  const userName   = entry.moved_by
    ? (usersMap.get(entry.moved_by) ?? 'Usuário removido')
    : null

  // Duração: para o último item (atual), calcular a partir de currentEnteredAt
  const durationDisplay = isCurrent
    ? formatDuration(secondsSince(currentEnteredAt))
    : (entry.duration_seconds != null && entry.duration_seconds > 0
        ? formatDuration(entry.duration_seconds)
        : null)

  return (
    <div className="flex gap-3">
      {/* Ícone + linha vertical */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${config.badgeClass}`}>
          {config.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1 min-h-[16px]" />}
      </div>

      {/* Conteúdo */}
      <div className="pb-4 flex-1 min-w-0">
        {/* Linha principal */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-800">{microcopy}</p>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${config.badgeClass}`}>
                {config.icon}
                {config.label}
              </span>
              {isCurrent && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500 text-white">
                  Atual
                </span>
              )}
              {isReentry && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                  Reentrada
                </span>
              )}
            </div>

            {/* Etapa de origem → destino */}
            {entry.from_stage && entry.to_stage && (
              <p className="text-xs text-gray-500 mt-0.5">
                {entry.from_stage.name}
                <span className="mx-1 text-gray-300">→</span>
                <span className="font-medium text-gray-700">{entry.to_stage.name}</span>
              </p>
            )}
            {!entry.from_stage && entry.to_stage && (
              <p className="text-xs text-gray-500 mt-0.5">
                Etapa: <span className="font-medium text-gray-700">{entry.to_stage.name}</span>
              </p>
            )}

            {/* Entrada */}
            {entry.move_type !== 'funnel_entry' && (
              <p className="text-xs text-gray-400 mt-0.5">
                Entrada: {formatDateShort(entry.stage_entered_at)}
              </p>
            )}

            {/* Saída ou tempo em aberto */}
            {isCurrent ? (
              <div className="flex items-center gap-1 mt-0.5 text-xs text-blue-500">
                <Timer className="w-3 h-3" />
                <span>Em andamento há {durationDisplay}</span>
              </div>
            ) : (
              <>
                {entry.move_type !== 'funnel_entry' && (
                  <p className="text-xs text-gray-400">
                    Saída: {formatDateShort(entry.stage_left_at)}
                  </p>
                )}
                {durationDisplay && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>{durationDisplay} nesta etapa</span>
                  </div>
                )}
              </>
            )}

            {/* Usuário responsável */}
            {userName && (
              <p className="text-xs text-gray-400 mt-0.5">Por: {userName}</p>
            )}
          </div>

          {/* Data do evento */}
          <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
            {formatDateShort(entry.stage_left_at)}
          </span>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Componente principal
// =====================================================

const COLLAPSE_THRESHOLD = 10  // eventos acima deste valor ativam o colapso

export const OpportunityStageTimeline: React.FC<OpportunityStageTimelineProps> = ({
  history,
  usersMap,
  currentEnteredAt,
  loading,
  error,
  lastEventRef
}) => {
  const [expanded, setExpanded] = useState(false)

  // Calcular reentradas
  const reentryIds = new Set<string>()
  const seenStages = new Set<string>()
  for (const h of history) {
    if (h.move_type === 'funnel_entry') continue
    if (seenStages.has(h.to_stage_id)) reentryIds.add(h.id)
    seenStages.add(h.to_stage_id)
  }

  const summary = computeSummary(history, currentEnteredAt)

  // Eventos exibidos (com ou sem colapso)
  const shouldCollapse = history.length > COLLAPSE_THRESHOLD && !expanded
  const visibleHistory = shouldCollapse
    ? [...history.slice(0, 5), history[history.length - 1]]
    : history
  const hiddenCount = history.length - 6  // 5 do topo + 1 do fim

  const lastEntry     = history[history.length - 1]
  const currentStage  = lastEntry?.to_stage?.name ?? '—'

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
            <div className="flex-1 space-y-1.5 pb-4">
              <div className="h-3 bg-gray-200 rounded w-3/4" />
              <div className="h-2 bg-gray-100 rounded w-1/2" />
              <div className="h-2 bg-gray-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500 py-4">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>Erro ao carregar histórico: {error}</span>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhum histórico de etapas disponível.</p>
        <p className="text-xs mt-1">O histórico é registrado a partir da data de ativação desta funcionalidade.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Bloco: Etapa Atual */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-0.5">
              Etapa Atual
            </p>
            <p className="text-sm font-semibold text-blue-900">{currentStage}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-blue-400 mb-0.5">Tempo em andamento</p>
            <div className="flex items-center gap-1 text-sm font-medium text-blue-700">
              <Timer className="w-3.5 h-3.5" />
              {summary.currentStageSeconds > 0
                ? formatDuration(summary.currentStageSeconds)
                : 'Menos de 1min'
              }
            </div>
          </div>
        </div>
      </div>

      {/* Bloco: Resumo */}
      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          Resumo da Jornada
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-gray-500">Tempo total no funil</p>
            <p className="text-sm font-semibold text-gray-800">
              {summary.totalSeconds > 0 ? formatDuration(summary.totalSeconds) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Etapas visitadas</p>
            <p className="text-sm font-semibold text-gray-800">{summary.uniqueStageCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Reentradas</p>
            <p className="text-sm font-semibold text-gray-800">
              {summary.reentryCount > 0
                ? <span className="text-amber-600">{summary.reentryCount}</span>
                : '0'
              }
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Média por etapa</p>
            <p className="text-sm font-semibold text-gray-800">
              {summary.avgStageSeconds > 0 ? formatDuration(summary.avgStageSeconds) : '—'}
            </p>
          </div>
          {summary.longestStageName && (
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Etapa mais longa (gargalo)</p>
              <p className="text-sm font-semibold text-orange-600">
                {summary.longestStageName}
                {' '}
                <span className="text-gray-500 font-normal text-xs">
                  ({formatDuration(summary.longestStageSeconds)})
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Linha do Tempo
        </p>

        <div>
          {visibleHistory.map((entry, idx) => {
            const isLast    = idx === visibleHistory.length - 1
            const isCurrent = entry.id === lastEntry?.id
            const isReentry = reentryIds.has(entry.id)

            // Inserir separador de eventos ocultos
            const isCollapseSeparatorPosition = shouldCollapse && idx === 4

            return (
              <React.Fragment key={entry.id}>
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
                      Ver {hiddenCount} evento{hiddenCount !== 1 ? 's' : ''} oculto{hiddenCount !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}

                <div ref={isLast ? lastEventRef : undefined}>
                  <TimelineItem
                    entry={entry}
                    isLast={isLast}
                    isCurrent={isCurrent}
                    isReentry={isReentry}
                    usersMap={usersMap}
                    currentEnteredAt={isCurrent ? currentEnteredAt : null}
                  />
                </div>
              </React.Fragment>
            )
          })}
        </div>

        {/* Botão colapsar (quando expandido) */}
        {!shouldCollapse && history.length > COLLAPSE_THRESHOLD && (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded transition-colors mt-1"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Recolher
          </button>
        )}
      </div>
    </div>
  )
}
