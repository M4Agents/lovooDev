import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTasklessLeads, type TasklessLeadList } from '../../services/tasklessLeadsApi'
import { TaskBoardRequestError } from '../../services/taskBoardApi'

const POLL_MS = 60_000

export function useTasklessLeads(companyId: string | null, active: boolean) {
  const [data, setData] = useState<TasklessLeadList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!companyId || !active) return
    const current = generation.current + 1
    generation.current = current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const response = await fetchTasklessLeads(companyId, controller.signal)
      if (generation.current !== current) return
      setData(response)
      setError(null)
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== current) return
      setError(cause instanceof TaskBoardRequestError ? cause.message : 'Não foi possível carregar os leads sem tarefas')
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [companyId, active])

  useEffect(() => {
    setData(null)
    setError(null)
  }, [companyId])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (!active) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void load()
    }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [active, load])

  return { data, loading, error, reload: load }
}
