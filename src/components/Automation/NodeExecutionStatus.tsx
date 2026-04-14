// =====================================================
// COMPONENT: NodeExecutionStatus
// Exibe detalhes da última execução de um node no
// painel lateral de configuração (Fase 2 Debug Visual).
// =====================================================

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown, ChevronUp, Clock,
  CheckCircle, XCircle, PauseCircle, MinusCircle,
} from 'lucide-react'
import type { NodeDebugStatus } from '../../hooks/useFlowDebug'

// ---------------------------------------------------------------------------
// Configuração de exibição por status
// ---------------------------------------------------------------------------

const STATUS_DISPLAY: Record<
  NodeDebugStatus['status'],
  { label: string; bg: string; border: string; text: string; Icon: React.ElementType }
> = {
  success: { label: 'Executado com sucesso', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', Icon: CheckCircle },
  error:   { label: 'Falhou',               bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-700',   Icon: XCircle   },
  paused:  { label: 'Pausado',              bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', Icon: PauseCircle },
  skipped: { label: 'Ignorado',             bg: 'bg-gray-50',  border: 'border-gray-200',  text: 'text-gray-600',  Icon: MinusCircle },
}

// ---------------------------------------------------------------------------
// Formatação de datas
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'há poucos segundos'
  const min = Math.floor(sec / 60)
  if (min < 60) return `há ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `há ${hr}h`
  return `há ${Math.floor(hr / 24)} dia(s)`
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Linha de output individual
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      <span className="text-gray-400 whitespace-nowrap flex-shrink-0 w-32">{label}</span>
      <span className="text-gray-700 font-mono break-all">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Output estruturado por tipo de node
// Retorna array de linhas, ou null quando o tipo não é reconhecido
// ---------------------------------------------------------------------------

function renderKnownOutput(nodeType: string, output: Record<string, any>): ReactNode[] | null {
  const rows: ReactNode[] = []

  switch (nodeType) {
    case 'condition':
      if ('result' in output)   rows.push(<Row key="result"    label="Resultado"  value={output.result ? '✓ Verdadeiro' : '✗ Falso'} />)
      if ('actual' in output)   rows.push(<Row key="actual"    label="Valor atual" value={String(output.actual ?? '—')} />)
      if ('expected' in output) rows.push(<Row key="expected"  label="Esperado"    value={String(output.expected ?? '—')} />)
      if (output.reason)        rows.push(<Row key="reason"    label="Motivo"      value={String(output.reason)} />)
      break

    case 'message':
      if (output.awaitingInput !== undefined) {
        // Subtipo user_input
        rows.push(<Row key="awaiting" label="Aguardando resp."  value={output.awaitingInput ? '✓ Sim' : '✗ Não'} />)
        if (output.variableName) rows.push(<Row key="var"     label="Variável"         value={String(output.variableName)} />)
        if (output.timeoutAt)    rows.push(<Row key="timeout" label="Timeout em"       value={formatAbsolute(output.timeoutAt)} />)
        if ('questionSent' in output) rows.push(<Row key="qsent" label="Pergunta enviada" value={output.questionSent ? '✓ Sim' : '✗ Não'} />)
        if (output.questionError)    rows.push(<Row key="qerr"   label="Erro"             value={String(output.questionError)} />)
      } else {
        if ('sent' in output)       rows.push(<Row key="sent"  label="Enviado" value={output.sent ? '✓ Sim' : '✗ Não'} />)
        if (output.to)              rows.push(<Row key="to"    label="Para"    value={String(output.to)} />)
        if (output.error_message)   rows.push(<Row key="err"   label="Erro"    value={String(output.error_message)} />)
      }
      break

    case 'action':
      if (output.skipped)             rows.push(<Row key="skip"    label="Ignorado"         value={output.reason ? String(output.reason) : 'Sim'} />)
      if (output.action)              rows.push(<Row key="action"  label="Ação"             value={String(output.action)} />)
      if (output.selectedUserId)      rows.push(<Row key="user"    label="Usuário"          value={String(output.selectedUserId)} />)
      if (output.tagId || output.newTagId) rows.push(<Row key="tagid" label="Tag ID"      value={String(output.tagId || output.newTagId)} />)
      if (output.tagName)             rows.push(<Row key="tagname" label="Tag"             value={String(output.tagName)} />)
      if (output.leadId)              rows.push(<Row key="leadid"  label="Lead ID"          value={String(output.leadId)} />)
      if (output.opportunityId)       rows.push(<Row key="oppid"   label="Oportunidade ID"  value={String(output.opportunityId)} />)
      if ('assignedLead' in output)   rows.push(<Row key="alead"   label="Lead atribuído"   value={output.assignedLead ? '✓ Sim' : '✗ Não'} />)
      if ('assignedOpportunity' in output) rows.push(<Row key="aopp" label="Oportunidade"  value={output.assignedOpportunity ? '✓ Sim' : '✗ Não'} />)
      break

    case 'delay':
      if (output.resumeAt)   rows.push(<Row key="resume" label="Retomar em"   value={formatAbsolute(output.resumeAt)} />)
      if (output.scheduleId) rows.push(<Row key="sched"  label="Agendamento"  value={String(output.scheduleId)} />)
      break

    case 'distribution':
      if (output.selectedUserId)            rows.push(<Row key="user"  label="Usuário selecionado" value={String(output.selectedUserId)} />)
      if (output.eligibleUserIds?.length)   rows.push(<Row key="elig"  label="Elegíveis"           value={`${output.eligibleUserIds.length} usuário(s)`} />)
      if ('assignedLead' in output)         rows.push(<Row key="alead" label="Lead atribuído"      value={output.assignedLead ? '✓ Sim' : '✗ Não'} />)
      if ('assignedOpportunity' in output)  rows.push(<Row key="aopp"  label="Oportunidade"        value={output.assignedOpportunity ? '✓ Sim' : '✗ Não'} />)
      break

    case 'execute_agent':
      if (output.skipped) {
        rows.push(<Row key="skip"   label="Status"   value="Ignorado" />)
        if (output.reason) rows.push(<Row key="reason" label="Motivo" value={String(output.reason)} />)
        if (output.error)  rows.push(<Row key="err"    label="Erro"   value={String(output.error)} />)
      } else {
        if (output.agentName || output.agentId) {
          rows.push(<Row key="agent" label="Agente" value={output.agentName ?? String(output.agentId).slice(0, 8) + '…'} />)
        }
        if (output.variable_saved)   rows.push(<Row key="var"      label="Variável salva"  value={`{{${output.variable_saved}}}`} />)
        if (output.result_preview)   rows.push(<Row key="preview"  label="Preview"         value={String(output.result_preview)} />)
        if (output.truncated)        rows.push(<Row key="trunc"    label="Truncado"        value="⚠ output maior que 10.000 chars" />)
        if (output.duration_ms != null) rows.push(<Row key="dur"   label="Duração"         value={`${output.duration_ms} ms`} />)
        if (output.input_tokens != null)  rows.push(<Row key="itok"  label="Tokens (in)"   value={String(output.input_tokens)} />)
        if (output.output_tokens != null) rows.push(<Row key="otok"  label="Tokens (out)"  value={String(output.output_tokens)} />)
        if (output.estimated_cost_usd != null) {
          rows.push(<Row key="cost" label="Custo est." value={`$${Number(output.estimated_cost_usd).toFixed(6)}`} />)
        }
        if (output.fallback) rows.push(<Row key="fallback" label="Fallback" value="⚠ resposta de fallback" />)
      }
      break

    default:
      return null
  }

  return rows.length > 0 ? rows : null
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

interface NodeExecutionStatusProps {
  nodeType: string
  debugStatus: NodeDebugStatus
}

export default function NodeExecutionStatus({ nodeType, debugStatus }: NodeExecutionStatusProps) {
  const [open, setOpen]       = useState(true)
  const [jsonOpen, setJsonOpen] = useState(false)

  const display   = STATUS_DISPLAY[debugStatus.status] ?? STATUS_DISPLAY.skipped
  const { Icon }  = display

  const hasOutput  = !!debugStatus.output && Object.keys(debugStatus.output).length > 0
  const knownRows  = hasOutput ? renderKnownOutput(nodeType, debugStatus.output!) : null

  return (
    <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden">
      {/* Cabeçalho colapsável */}
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Última execução
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />
        }
      </button>

      {open && (
        <div className="p-3 space-y-3">
          {/* Badge de status */}
          <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${display.bg} ${display.border}`}>
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${display.text}`} />
            <span className={`text-xs font-medium ${display.text}`}>{display.label}</span>
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Clock className="w-3 h-3 flex-shrink-0" />
            <span>{formatRelative(debugStatus.executed_at)}</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">{formatAbsolute(debugStatus.executed_at)}</span>
          </div>

          {/* Mensagem de erro */}
          {debugStatus.error_message && (
            <div className="bg-red-50 border border-red-200 rounded px-2.5 py-2">
              <p className="text-xs font-medium text-red-700 mb-0.5">Erro</p>
              <p className="text-xs text-red-600 font-mono break-all">{debugStatus.error_message}</p>
            </div>
          )}

          {/* Output */}
          {hasOutput && (
            <div className="space-y-0.5">
              {knownRows ? (
                <>
                  {knownRows}
                  <button
                    onClick={() => setJsonOpen(o => !o)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {jsonOpen
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                    }
                    {jsonOpen ? 'Ocultar JSON' : 'Ver JSON completo'}
                  </button>
                  {jsonOpen && (
                    <pre className="mt-1 text-[10px] bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-32 text-gray-600 leading-relaxed">
                      {JSON.stringify(debugStatus.output, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                /* Fallback genérico — tipo desconhecido */
                <>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide">Output</p>
                  <pre className="text-[10px] bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-32 text-gray-600 leading-relaxed">
                    {JSON.stringify(debugStatus.output, null, 2)}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
