// =====================================================
// COMPONENT: FlowExecutionHistory
// Painel colapsável com histórico simples das últimas
// execuções do flow — sem polling e sem filtros avançados.
// =====================================================

import { RefreshCw, X, CheckCircle, XCircle, Clock, PauseCircle, Loader, User, AlertCircle } from 'lucide-react'
import type { FlowExecution } from '../../hooks/useFlowDebug'

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec  = Math.floor(diff / 1000)
  if (sec < 60)   return 'há poucos segundos'
  const min = Math.floor(sec / 60)
  if (min < 60)   return `há ${min} min`
  const hr  = Math.floor(min / 60)
  if (hr < 24)    return `há ${hr}h`
  return `há ${Math.floor(hr / 24)} dia(s)`
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(ms: number | null): string | null {
  if (!ms || ms <= 0) return null
  if (ms < 1000)      return `${ms}ms`
  if (ms < 60000)     return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ---------------------------------------------------------------------------
// Status derivado de cada execução
// ---------------------------------------------------------------------------

type ExecStatus = {
  label: string
  dot: string
  text: string
  Icon: React.ElementType
}

function getExecStatus(exec: FlowExecution): ExecStatus {
  if (exec.isTimedOut)     return { label: 'Timeout',         dot: 'bg-orange-500', text: 'text-orange-700', Icon: Clock }
  if (exec.isWaitingInput) return { label: 'Aguardando resp.',dot: 'bg-purple-500', text: 'text-purple-700', Icon: PauseCircle }
  if (exec.isDelayed)      return { label: 'Em delay',        dot: 'bg-amber-400',  text: 'text-amber-700',  Icon: Clock }
  if (exec.isPaused)       return { label: 'Pausado',         dot: 'bg-amber-400',  text: 'text-amber-700',  Icon: PauseCircle }
  if (exec.isFailed)       return { label: 'Falhou',          dot: 'bg-red-500',    text: 'text-red-700',    Icon: XCircle }
  if (exec.isRunning)      return { label: 'Em execução',     dot: 'bg-blue-500',   text: 'text-blue-700',   Icon: Loader }
  if (exec.isCompleted)    return { label: 'Concluído',       dot: 'bg-green-500',  text: 'text-green-700',  Icon: CheckCircle }
  return                          { label: exec.status,       dot: 'bg-gray-400',   text: 'text-gray-600',   Icon: AlertCircle }
}

// ---------------------------------------------------------------------------
// Linha individual de execução
// ---------------------------------------------------------------------------

function ExecutionRow({ exec }: { exec: FlowExecution }) {
  const st       = getExecStatus(exec)
  const duration = formatDuration(exec.duration_ms)
  const endTime  = exec.completed_at ?? exec.paused_at ?? null

  return (
    <div className="px-3 py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
      {/* Linha 1: status + tempo */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${st.dot} ${exec.isRunning ? 'animate-pulse' : ''}`} />
          <span className={`text-xs font-medium ${st.text} truncate`}>{st.label}</span>
          {duration && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">· {duration}</span>
          )}
        </div>
        <span
          className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap"
          title={formatAbsolute(exec.started_at)}
        >
          {formatRelative(exec.started_at)}
        </span>
      </div>

      {/* Linha 2: referência (lead / oportunidade) */}
      {(exec.lead_id || exec.opportunity_id) && (
        <div className="flex items-center gap-1 mt-0.5">
          <User className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
          {exec.lead_id && (
            <span className="text-[10px] text-gray-500">Lead #{exec.lead_id}</span>
          )}
          {exec.lead_id && exec.opportunity_id && (
            <span className="text-[10px] text-gray-300">·</span>
          )}
          {exec.opportunity_id && (
            <span className="text-[10px] text-gray-500 font-mono truncate max-w-[100px]">
              {exec.opportunity_id.slice(0, 8)}…
            </span>
          )}
        </div>
      )}

      {/* Linha 3: último node */}
      {exec.last_node_executed && !exec.isFailed && (
        <div className="mt-0.5">
          <span className="text-[10px] text-gray-400">
            Último: <span className="font-mono text-gray-500">{exec.last_node_executed}</span>
          </span>
        </div>
      )}

      {/* Linha 4: erro */}
      {exec.error_message && (
        <div className="mt-1 text-[10px] text-red-600 font-mono truncate leading-tight">
          ✕ {exec.error_message}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

interface FlowExecutionHistoryProps {
  executions: FlowExecution[]
  loading: boolean
  onRefresh: () => void
  onClose: () => void
}

export default function FlowExecutionHistory({
  executions,
  loading,
  onRefresh,
  onClose,
}: FlowExecutionHistoryProps) {
  return (
    <div className="w-72 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700">Histórico de execuções</span>
          {executions.length > 0 && (
            <span className="text-[10px] bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5 font-medium">
              {executions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Atualizar"
            className="p-1 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            title="Fechar"
            className="p-1 rounded hover:bg-gray-200 transition-colors"
          >
            <X className="w-3 h-3 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="overflow-y-auto max-h-72 flex-1">
        {loading && executions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            <Loader className="w-4 h-4 animate-spin mr-2" />
            Carregando…
          </div>
        ) : executions.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            Nenhuma execução registrada.
          </div>
        ) : (
          executions.map(exec => (
            <ExecutionRow key={exec.id} exec={exec} />
          ))
        )}
      </div>

      {/* Rodapé */}
      {executions.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-100 flex-shrink-0">
          <p className="text-[10px] text-gray-400 text-center">
            Mostrando as últimas {executions.length} execuções
          </p>
        </div>
      )}
    </div>
  )
}
