// =====================================================
// HOOK: usePlanUserLimit
// Expõe limite de usuários do plano e estado de saturação
// para a empresa ativa.
// =====================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface UsePlanUserLimitReturn {
  /** Limite máximo de usuários do plano. null = ilimitado. */
  planUserLimit: number | null
  /** Quantidade atual de usuários ativos não-platform. */
  currentUserCount: number
  /** TRUE quando currentUserCount >= planUserLimit (e planUserLimit não é null). */
  isAtUserLimit: boolean
  /** Recarregar os dados manualmente. */
  refetch: () => void
}

export function usePlanUserLimit(companyId: string | undefined): UsePlanUserLimitReturn {
  const [planUserLimit, setPlanUserLimit]     = useState<number | null>(null)
  const [currentUserCount, setCurrentUserCount] = useState(0)

  const fetchLimits = () => {
    if (!companyId) return

    Promise.all([
      supabase
        .from('companies')
        .select('plans!plan_id(max_users)')
        .eq('id', companyId)
        .single(),
      supabase
        .from('company_users')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('is_active', true)
        .eq('is_platform_member', false),
    ]).then(([companyRes, countRes]) => {
      const plan = (companyRes.data as { plans?: { max_users?: number | null } | null })?.plans
      setPlanUserLimit(plan?.max_users ?? null)
      setCurrentUserCount(countRes.count ?? 0)
    }).catch(() => {
      // Silencioso — o componente funciona sem o dado de limite
    })
  }

  useEffect(() => {
    fetchLimits()
  }, [companyId])

  const isAtUserLimit = planUserLimit !== null && currentUserCount >= planUserLimit

  return { planUserLimit, currentUserCount, isAtUserLimit, refetch: fetchLimits }
}
