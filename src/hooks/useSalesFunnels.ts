// =====================================================
// HOOK: USE SALES FUNNELS
// Data: 14/03/2026
// Objetivo: Buscar funis de vendas da empresa
// =====================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { SalesFunnel } from '../types/sales-funnel'

export function useSalesFunnels(companyId: string | undefined) {
  const [funnels, setFunnels] = useState<SalesFunnel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!companyId) {
      setLoading(false)
      return
    }

    async function loadFunnels() {
      try {
        setLoading(true)
        setError(undefined)

        const { data, error: fetchError } = await supabase
          .from('sales_funnels')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('display_order')

        if (fetchError) throw fetchError

        setFunnels(data || [])
      } catch (err) {
        console.error('Erro ao carregar funis:', err)
        setError(err instanceof Error ? err.message : 'Erro ao carregar funis')
      } finally {
        setLoading(false)
      }
    }

    loadFunnels()
  }, [companyId])

  return { funnels, loading, error }
}
