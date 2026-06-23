/**
 * useSaleTypeCheck
 *
 * Hook leve que verifica se:
 *   1. O funil exige tipo de venda ao fechar como ganho (requireSaleType).
 *   2. A oportunidade já possui ao menos um vínculo em opportunity_sale_types (hasSaleTypes).
 *
 * Responsabilidade única — não carrega a lista de tipos.
 * A lista é responsabilidade exclusiva de WonSaleTypeSelector (CloseOpportunityModal).
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface UseSaleTypeCheckParams {
  opportunityId: string
  companyId: string
  funnelRequireWonSaleType: boolean
  enabled?: boolean
}

interface UseSaleTypeCheckResult {
  requireSaleType: boolean
  hasSaleTypes: boolean
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useSaleTypeCheck({
  opportunityId,
  companyId,
  funnelRequireWonSaleType,
  enabled = true,
}: UseSaleTypeCheckParams): UseSaleTypeCheckResult {
  const [hasSaleTypes, setHasSaleTypes] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const requireSaleType = funnelRequireWonSaleType === true

  useEffect(() => {
    if (!requireSaleType || !enabled || !opportunityId || !companyId) {
      setHasSaleTypes(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('opportunity_sale_types')
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', opportunityId)
      .eq('company_id', companyId)
      .then(({ count, error: queryError }) => {
        if (cancelled) return
        if (queryError) {
          setError(queryError.message)
          setHasSaleTypes(false)
        } else {
          setHasSaleTypes((count ?? 0) > 0)
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [opportunityId, companyId, requireSaleType, enabled, tick])

  return {
    requireSaleType,
    hasSaleTypes,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
