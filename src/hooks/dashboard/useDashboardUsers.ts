// =====================================================
// useDashboardUsers
// Busca lista de usuários filtráveis para o UserSelector.
// Depende apenas de companyId — não é sensível ao período.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { DashboardUser } from '../../types/dashboard'

interface UseDashboardUsersResult {
  users:   DashboardUser[]
  loading: boolean
  error:   string | null
}

export function useDashboardUsers(): UseDashboardUsersResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [users,   setUsers]   = useState<DashboardUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchUsers = useCallback(async () => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getDashboardUsers(companyId, abortRef.current.signal)
      setUsers(res.data ?? [])
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void fetchUsers()
    return () => abortRef.current?.abort()
  }, [fetchUsers])

  return { users, loading, error }
}
