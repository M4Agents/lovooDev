import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTasklessLeads, type TasklessLeadList } from '../../services/tasklessLeadsApi'
import { TaskBoardRequestError } from '../../services/taskBoardApi'
import { TASKLESS_PAGE_SIZE } from '../../utils/tasklessLeadAccess'

const POLL_MS = 60_000

interface TasklessFilters {
  query: string
  userId: string
}

export function useTasklessLeads(companyId: string | null, active: boolean, filters: TasklessFilters) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<TasklessLeadList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const offsetRef = useRef(offset)
  const filterKey = `${filters.query}\n${filters.userId}`
  const [seenFilter, setSeenFilter] = useState(filterKey)
  if (seenFilter !== filterKey) {
    setSeenFilter(filterKey)
    offsetRef.current = 0
    setOffset(0)
    setData(null)
    setError(null)
  } else {
    offsetRef.current = offset
  }

  const load = useCallback(async () => {
    if (!companyId || !active) return
    const requested = offsetRef.current
    const current = generation.current + 1
    generation.current = current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const response = await fetchTasklessLeads(companyId, requested, {
        query: filters.query,
        userId: filters.userId,
      }, controller.signal)
      if (generation.current !== current) return
      if (requested > 0 && requested >= response.total) {
        const last = response.total === 0
          ? 0
          : Math.floor((response.total - 1) / TASKLESS_PAGE_SIZE) * TASKLESS_PAGE_SIZE
        if (last !== requested) {
          setOffset(last)
          return
        }
      }
      setData(response)
      setError(null)
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== current) return
      setError(cause instanceof TaskBoardRequestError ? cause.message : 'Não foi possível carregar os leads sem tarefas')
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [companyId, active, filters.query, filters.userId])

  useEffect(() => {
    setOffset(0)
    offsetRef.current = 0
    setData(null)
    setError(null)
  }, [companyId])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load, offset])

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

  const showNext = () => {
    if (!data || offset + data.items.length >= data.total) return
    setOffset(offset + TASKLESS_PAGE_SIZE)
  }

  const showPrev = () => {
    setOffset(current => Math.max(0, current - TASKLESS_PAGE_SIZE))
  }

  const reset = useCallback(() => {
    if (offsetRef.current === 0) {
      void load()
      return
    }
    setOffset(0)
  }, [load])

  return { data, loading, error, offset, reload: load, reset, showNext, showPrev }
}
