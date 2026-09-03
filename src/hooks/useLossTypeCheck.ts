/**
 * useLossTypeCheck
 *
 * Hook leve que verifica se:
 *   1. O funil exige tipo de perda ao fechar como perdido (requireLossType).
 *   2. A oportunidade já possui ao menos um vínculo em opportunity_loss_types (hasLossTypes).
 *
 * Responsabilidade única — não carrega a lista de tipos.
 * A lista é responsabilidade exclusiva de LostLossTypeSelector (CloseOpportunityModal).
 *
 * Espelho de useSaleTypeCheck.ts.
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface UseLossTypeCheckParams {
  opportunityId: string
  companyId: string
  funnelRequireLostLossType: boolean
  enabled?: boolean
}

interface UseLossTypeCheckResult {
  requireLossType: boolean
  hasLossTypes: boolean
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useLossTypeCheck({
  opportunityId,
  companyId,
  funnelRequireLostLossType,
  enabled = true,
}: UseLossTypeCheckParams): UseLossTypeCheckResult {
  const [hasLossTypes, setHasLossTypes] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const requireLossType = funnelRequireLostLossType === true

  useEffect(() => {
    if (!requireLossType || !enabled || !opportunityId || !companyId) {
      setHasLossTypes(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('opportunity_loss_types')
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', opportunityId)
      .eq('company_id', companyId)
      .then(({ count, error: queryError }) => {
        if (cancelled) return
        if (queryError) {
          setError(queryError.message)
          setHasLossTypes(false)
        } else {
          setHasLossTypes((count ?? 0) > 0)
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [opportunityId, companyId, requireLossType, enabled, tick])

  return {
    requireLossType,
    hasLossTypes,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
