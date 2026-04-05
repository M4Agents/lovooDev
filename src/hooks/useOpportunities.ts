// =====================================================
// HOOK: useOpportunities
// Data: 04/03/2026
// Objetivo: Hook para gerenciar oportunidades de um lead
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import type {
  Opportunity,
  CreateOpportunityForm,
  UpdateOpportunityForm,
  UpdateOpportunityOptions
} from '../types/sales-funnel'

export interface UseOpportunitiesReturn {
  opportunities: Opportunity[]
  loading: boolean
  error?: string
  createOpportunity: (data: CreateOpportunityForm) => Promise<Opportunity>
  updateOpportunity: (
    id: string,
    data: UpdateOpportunityForm,
    options?: UpdateOpportunityOptions
  ) => Promise<Opportunity>
  refreshOpportunities: () => Promise<void>
}

export const useOpportunities = (leadId: number): UseOpportunitiesReturn => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Buscar oportunidades do lead
  const fetchOpportunities = useCallback(async () => {
    console.log('🔍 useOpportunities - fetchOpportunities called with leadId:', leadId)
    
    if (!leadId || isNaN(leadId)) {
      console.warn('⚠️ useOpportunities - Invalid leadId:', leadId)
      setLoading(false)
      setOpportunities([])
      return
    }
    
    try {
      setLoading(true)
      setError(undefined)
      
      console.log('📡 useOpportunities - Fetching opportunities for lead:', leadId)
      const data = await funnelApi.getOpportunitiesByLead(leadId)
      console.log('✅ useOpportunities - Opportunities fetched:', data.length)
      setOpportunities(data)
    } catch (err) {
      console.error('❌ useOpportunities - Error fetching opportunities:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar oportunidades')
    } finally {
      setLoading(false)
    }
  }, [leadId])

  // Carregar oportunidades ao montar
  useEffect(() => {
    fetchOpportunities()
  }, [fetchOpportunities])

  // Criar nova oportunidade
  const createOpportunity = useCallback(async (data: CreateOpportunityForm): Promise<Opportunity> => {
    try {
      setError(undefined)
      
      const opportunity = await funnelApi.createOpportunity(data)
      
      // Adicionar à lista local
      setOpportunities(prev => [opportunity, ...prev])
      
      return opportunity
    } catch (err) {
      console.error('Error creating opportunity:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao criar oportunidade'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  // Atualizar oportunidade
  const updateOpportunity = useCallback(
    async (
      id: string,
      data: UpdateOpportunityForm,
      options?: UpdateOpportunityOptions
    ): Promise<Opportunity> => {
      try {
        setError(undefined)

        const opportunity = await funnelApi.updateOpportunity(id, data, options)

        // Atualizar na lista local
        setOpportunities(prev => prev.map(o => (o.id === id ? opportunity : o)))

        return opportunity
      } catch (err) {
        console.error('Error updating opportunity:', err)
        const errorMessage = err instanceof Error ? err.message : 'Erro ao atualizar oportunidade'
        setError(errorMessage)
        throw new Error(errorMessage)
      }
    },
    []
  )

  // Refresh
  const refreshOpportunities = useCallback(async () => {
    await fetchOpportunities()
  }, [fetchOpportunities])

  return {
    opportunities,
    loading,
    error,
    createOpportunity,
    updateOpportunity,
    refreshOpportunities
  }
}
