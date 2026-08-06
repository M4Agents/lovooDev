// =====================================================
// useAgentReport — busca e estado do Relatório do Agente de IA
// =====================================================

import { useEffect, useRef, useState } from 'react'
import { agentReportApi } from '../services/agentReportApi'
import type { AgentReport } from '../types/agent-report'

interface UseAgentReportParams {
  companyId: string
  dateFrom: Date
  dateTo: Date
  enabled?: boolean
}

interface UseAgentReportResult {
  data: AgentReport | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAgentReport({
  companyId,
  dateFrom,
  dateTo,
  enabled = true,
}: UseAgentReportParams): UseAgentReportResult {
  const [data, setData] = useState<AgentReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchCountRef = useRef(0)

  const fetch = () => {
    if (!companyId || !enabled) return

    const currentFetch = ++fetchCountRef.current
    setLoading(true)
    setError(null)

    agentReportApi
      .getReport(companyId, dateFrom, dateTo)
      .then((result) => {
        if (currentFetch !== fetchCountRef.current) return
        setData(result)
      })
      .catch((err: unknown) => {
        if (currentFetch !== fetchCountRef.current) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      })
      .finally(() => {
        if (currentFetch !== fetchCountRef.current) return
        setLoading(false)
      })
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, dateFrom.toISOString(), dateTo.toISOString(), enabled])

  return { data, loading, error, refetch: fetch }
}
