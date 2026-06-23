/**
 * useWonItemCheck
 *
 * Hook leve que verifica se:
 *   1. O funil exige produto/serviço ao fechar como ganho (requireItems).
 *   2. A oportunidade já possui ao menos um item em opportunity_items (hasItems).
 *
 * Responsabilidade única — não carrega catálogo.
 * Catálogo é responsabilidade exclusiva do CloseOpportunityModal.
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface UseWonItemCheckParams {
  opportunityId: string
  companyId: string
  /** Valor de sales_funnels.require_won_items para o funil atual. */
  funnelRequireWonItems: boolean
  /** Controla se o hook deve executar (ex.: só quando o modal está prestes a abrir). */
  enabled?: boolean
}

interface UseWonItemCheckResult {
  requireItems: boolean
  hasItems: boolean
  loading: boolean
  error: string | null
  /** Força re-check (útil após adicionar/remover item). */
  refetch: () => void
}

export function useWonItemCheck({
  opportunityId,
  companyId,
  funnelRequireWonItems,
  enabled = true,
}: UseWonItemCheckParams): UseWonItemCheckResult {
  const [hasItems, setHasItems] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const requireItems = funnelRequireWonItems === true

  useEffect(() => {
    // Se não requer itens, não executar query
    if (!requireItems || !enabled || !opportunityId || !companyId) {
      setHasItems(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('opportunity_items')
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', opportunityId)
      .eq('company_id', companyId)
      .then(({ count, error: queryError }) => {
        if (cancelled) return
        if (queryError) {
          setError(queryError.message)
          setHasItems(false)
        } else {
          setHasItems((count ?? 0) > 0)
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [opportunityId, companyId, requireItems, enabled, tick])

  return {
    requireItems,
    hasItems,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
