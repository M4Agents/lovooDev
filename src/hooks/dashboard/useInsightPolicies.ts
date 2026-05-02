// =====================================================
// useInsightPolicies
// Carrega e salva políticas de insights de uma empresa.
//
// Expõe:
//   policies  — valores atuais (mesclados com defaults)
//   defaults  — valores padrão retornados pelo backend
//   loading   — carregando policies
//   saving    — salvando policies
//   error     — mensagem de erro (load ou save)
//   load()    — força recarregamento
//   save()    — envia policies ao backend
//   reset()   — restaura form local para os defaults
// =====================================================

import { useState, useCallback, useEffect } from 'react'
import { dashboardApi, type InsightPoliciesData } from '../../services/dashboardApi'

interface UseInsightPoliciesReturn {
  policies:  InsightPoliciesData | null
  defaults:  InsightPoliciesData | null
  loading:   boolean
  saving:    boolean
  error:     string | null
  load:      () => Promise<void>
  save:      (data: Partial<InsightPoliciesData>) => Promise<boolean>
  reset:     () => void
}

export function useInsightPolicies(companyId: string | null): UseInsightPoliciesReturn {
  const [policies, setPolicies] = useState<InsightPoliciesData | null>(null)
  const [defaults, setDefaults] = useState<InsightPoliciesData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardApi.getInsightPolicies(companyId)
      setPolicies(res.data)
      setDefaults(res.defaults)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar regras'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Carrega automaticamente ao montar (ou quando companyId muda)
  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(async (data: Partial<InsightPoliciesData>): Promise<boolean> => {
    if (!companyId) return false
    setSaving(true)
    setError(null)
    try {
      const res = await dashboardApi.saveInsightPolicies(companyId, data)
      setPolicies(res.data)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar regras'
      setError(msg)
      return false
    } finally {
      setSaving(false)
    }
  }, [companyId])

  const reset = useCallback(() => {
    if (defaults) setPolicies({ ...defaults })
  }, [defaults])

  return { policies, defaults, loading, saving, error, load, save, reset }
}
