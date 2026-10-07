import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { AwaitingLeadReplyItem, AwaitingLeadReplyMeta } from '../../types/dashboard'

interface Options {
  userId?: string | null
  limit?:  number
}

export function useAwaitingLeadReply(options: Options = {}) {
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const { userId = null, limit = 20 } = options

  const [data, setData]       = useState<AwaitingLeadReplyItem[]>([])
  const [meta, setMeta]       = useState<AwaitingLeadReplyMeta | null>(null)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    if (!append) setError(null)

    try {
      const res = await dashboardApi.getAwaitingLeadReply(
        companyId,
        { userId: userId ?? undefined, page: targetPage, limit },
        abortRef.current.signal,
      )
      setData(prev => append ? [...prev, ...(res.data ?? [])] : (res.data ?? []))
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar aguardando retorno do lead')
    } finally {
      setLoading(false)
    }
  }, [companyId, userId, limit])

  useEffect(() => {
    setPage(1)
    setData([])
    void fetchPage(1, false)
    return () => abortRef.current?.abort()
  }, [fetchPage])

  const refetch = useCallback(() => {
    setPage(1)
    setData([])
    void fetchPage(1, false)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (loading || !meta?.has_more) return
    const next = page + 1
    setPage(next)
    void fetchPage(next, true)
  }, [loading, meta, page, fetchPage])

  return { data, meta, loading, error, refetch, loadMore }
}
