// =====================================================
// HOOK: useFlowDebug
// Busca execuções recentes de um flow para debug visual
// no canvas e no painel lateral.
// Inclui polling leve (30s) ativo apenas quando há
// execuções em andamento.
// =====================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export type NodeDebugStatus = {
  status: 'success' | 'error' | 'paused' | 'skipped'
  executed_at: string
  error_message: string | null
  output: Record<string, any> | null
}

export type NodeStatusMap = Record<string, NodeDebugStatus>

// Shape resumido de uma execução retornada pelo endpoint
export type FlowExecution = {
  id: string
  status: string
  started_at: string
  completed_at: string | null
  paused_at: string | null
  resume_at: string | null
  lead_id: number | null
  opportunity_id: string | null
  error_message: string | null
  error_node_id: string | null
  duration_ms: number | null
  last_node_executed: string | null
  current_node_id: string | null
  isPaused: boolean
  isRunning: boolean
  isCompleted: boolean
  isFailed: boolean
  isTimedOut: boolean
  isDelayed: boolean
  isWaitingInput: boolean
  nodeStatusMap: NodeStatusMap
}

const HISTORY_PAGE_SIZE  = 10
const POLL_INTERVAL_MS   = 30_000

// Uma execução é considerada "ativa" se ainda pode mudar de estado
function isActive(exec: FlowExecution): boolean {
  return exec.isRunning || exec.isPaused || exec.isDelayed || exec.isWaitingInput
}

export function useFlowDebug(flowId: string | undefined) {
  const [nodeStatusMap, setNodeStatusMap] = useState<NodeStatusMap>({})
  const [lastExecution, setLastExecution] = useState<FlowExecution | null>(null)
  const [executions, setExecutions]       = useState<FlowExecution[]>([])
  const [loading, setLoading]             = useState(false)

  // ---------------------------------------------------------------------------
  // Fetch principal
  // ---------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (!flowId) return

    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const res = await fetch(
        `/api/automation/executions/${flowId}?pageSize=${HISTORY_PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      )

      if (!res.ok) return

      const json = await res.json()
      const items: FlowExecution[] = json.items ?? []

      setExecutions(items)

      const latest = items[0] ?? null
      setLastExecution(latest)
      setNodeStatusMap(latest?.nodeStatusMap ?? {})
    } catch {
      // Falha silenciosa — debug não deve quebrar o canvas
    } finally {
      setLoading(false)
    }
  }, [flowId])

  // ---------------------------------------------------------------------------
  // Carga inicial
  // ---------------------------------------------------------------------------

  useEffect(() => {
    refresh()
  }, [refresh])

  // ---------------------------------------------------------------------------
  // Polling leve
  //
  // Estratégia:
  //   - Ativo apenas quando há ao menos uma execução com estado mutável
  //     (isRunning | isPaused | isDelayed | isWaitingInput)
  //   - Intervalo fixo de 30 s — seguro e não agressivo
  //   - intervalRef garante que nunca existam dois intervals simultâneos
  //   - refreshRef permite que o interval sempre chame a versão mais
  //     recente de refresh sem precisar estar na dependency list do effect
  // ---------------------------------------------------------------------------

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshRef   = useRef(refresh)

  // Manter refreshRef atualizado sem recriar o interval a cada render
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  // Polling só existe quando há execução ativa
  const shouldPoll = executions.some(isActive) && !!flowId

  useEffect(() => {
    // Limpar interval anterior (se houver) antes de criar um novo
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (!shouldPoll) return

    intervalRef.current = setInterval(() => {
      refreshRef.current()
    }, POLL_INTERVAL_MS)

    // Cleanup: cancela quando shouldPoll muda ou componente desmonta
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [shouldPoll]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  return {
    nodeStatusMap,
    lastExecution,
    executions,
    loading,
    polling: shouldPoll,   // true enquanto há execução ativa — usado para indicador visual
    refresh,
  }
}
