import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTaskBoard, TaskBoardRequestError, type TaskBoardResponse } from '../../services/taskBoardApi'
import {
  isStaleResponse,
  readWindowMinutes,
  shouldPoll,
  windowStorageKey,
  type DateMode,
  type TaskCard,
  type WindowMinutes,
} from '../../utils/taskBoardContract'

const SEARCH_DEBOUNCE_MS = 300
const POLL_MS = 60_000

export interface TaskBoardControls {
  date: DateMode
  from: string
  to: string
  q: string
  activityType: string
  priority: string
  userId: string
  card: TaskCard
  windowMinutes: WindowMinutes
}

const INITIAL: TaskBoardControls = {
  date: 'all',
  from: '',
  to: '',
  q: '',
  activityType: '',
  priority: '',
  userId: '',
  card: 'open',
  windowMinutes: 15,
}

interface Options {
  companyId: string | null
  userId: string | null
  active: boolean
}

export function useTaskBoard({ companyId, userId, active }: Options) {
  const [controls, setControls] = useState<TaskBoardControls>(INITIAL)
  const [appliedQuery, setAppliedQuery] = useState('')
  const [data, setData] = useState<TaskBoardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const seenCompany = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !companyId || seenCompany.current === companyId) return
    seenCompany.current = companyId
    const stored = window.localStorage.getItem(windowStorageKey(userId, companyId))
    setControls({ ...INITIAL, windowMinutes: readWindowMinutes(stored) })
    setAppliedQuery('')
    setData(null)
    setError(null)
  }, [userId, companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(controls.q), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [controls.q])

  const { date, from, to, activityType, priority, userId: filteredUserId, card, windowMinutes } = controls

  const load = useCallback(async (reason: 'filters' | 'poll') => {
    if (!companyId || !active) return
    if (date === 'range' && (!from || !to || from > to)) {
      abortRef.current?.abort()
      generation.current += 1
      inFlight.current = false
      setLoading(false)
      setData(null)
      setError(from && to ? 'De não pode ser maior que Até' : null)
      return
    }
    if (reason === 'poll' && !shouldPoll(active, document.visibilityState === 'visible', inFlight.current)) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++generation.current
    inFlight.current = true
    if (reason === 'filters') {
      setLoading(true)
      setData(null)
    }
    setError(null)

    try {
      const response = await fetchTaskBoard({
        companyId,
        date,
        from,
        to,
        q: appliedQuery,
        activityType,
        priority,
        userId: filteredUserId,
        card,
        windowMinutes,
        signal: controller.signal,
      })
      if (isStaleResponse(requestId, generation.current)) return
      setData(response)
      setError(null)
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') return
      if (isStaleResponse(requestId, generation.current)) return
      const message = caught instanceof TaskBoardRequestError
        ? caught.message
        : 'Não foi possível carregar as tarefas'
      setError(message)
      if (reason === 'filters') setData(null)
    } finally {
      if (abortRef.current === controller) inFlight.current = false
      if (!isStaleResponse(requestId, generation.current)) setLoading(false)
    }
  }, [active, activityType, appliedQuery, card, companyId, date, filteredUserId, from, priority, to, windowMinutes])

  useEffect(() => {
    void load('filters')
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (!active) return
    const tick = () => {
      if (!shouldPoll(true, document.visibilityState === 'visible', inFlight.current)) return
      void load('poll')
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

  const patch = (partial: Partial<TaskBoardControls>) => {
    setControls(current => {
      const next = { ...current, ...partial }
      if (partial.windowMinutes && userId && companyId) {
        window.localStorage.setItem(windowStorageKey(userId, companyId), String(partial.windowMinutes))
      }
      return next
    })
  }

  return {
    controls,
    patch,
    data,
    loading,
    error,
    reload: () => load('filters'),
  }
}
