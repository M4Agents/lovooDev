// =====================================================
// HOOK: useLeadPositions (ATUALIZADO PARA OPORTUNIDADES)
// Data: 03/03/2026 - Atualizado: 04/03/2026
// Objetivo: Hook para gerenciar posições das oportunidades no funil
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import { supabase } from '../lib/supabase'
import type {
  OpportunityFunnelPosition,
  LeadPositionFilter,
  UseLeadPositionsReturn
} from '../types/sales-funnel'

export const useLeadPositions = (funnelId: string, filter?: LeadPositionFilter): UseLeadPositionsReturn => {
  const [positions, setPositions] = useState<OpportunityFunnelPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Buscar posições (ATUALIZADO PARA OPORTUNIDADES)
  const fetchPositions = useCallback(async () => {
    if (!funnelId) return
    
    try {
      setLoading(true)
      setError(undefined)
      
      const data = await funnelApi.getOpportunityPositions(funnelId, filter)
      setPositions(data)
    } catch (err) {
      console.error('Error fetching opportunity positions:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar posições das oportunidades')
    } finally {
      setLoading(false)
    }
  }, [funnelId, filter])

  // Carregar posições ao montar
  useEffect(() => {
    fetchPositions()
  }, [fetchPositions])

  // Mover oportunidade para outra etapa (ATUALIZADO)
  const moveLeadToStage = useCallback(async (
    leadId: number,
    toStageId: string,
    position: number
  ): Promise<void> => {
    try {
      setError(undefined)
      
      // Encontrar posição atual da oportunidade pelo lead_id
      const currentPosition = positions.find(p => p.lead_id === leadId)
      if (!currentPosition) {
        throw new Error('Oportunidade não encontrada no funil')
      }
      
      // Mover oportunidade
      await funnelApi.moveOpportunityToStage({
        opportunity_id: currentPosition.opportunity_id,
        funnel_id: funnelId,
        from_stage_id: currentPosition.stage_id,
        to_stage_id: toStageId,
        position_in_stage: position
      })
      
      // Atualizar lista local
      await fetchPositions()
    } catch (err) {
      console.error('Error moving opportunity:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao mover oportunidade'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [funnelId, positions, fetchPositions])

  // Adicionar lead ao funil (CRIA OPORTUNIDADE AUTOMATICAMENTE)
  const addLeadToFunnel = useCallback(async (leadId: number, funnelId: string): Promise<void> => {
    try {
      setError(undefined)
      
      // Buscar primeira etapa do funil (system stage)
      const stages = await funnelApi.getStages(funnelId)
      const firstStage = stages.find(s => s.is_system_stage && s.position === 0) || stages[0]
      
      if (!firstStage) {
        throw new Error('Funil não possui etapas')
      }
      
      // Buscar dados do lead para criar oportunidade
      const { data: lead } = await supabase
        .from('leads')
        .select('name, company_id, origin, responsible_user_id')
        .eq('id', leadId)
        .single()
      
      if (!lead) {
        throw new Error('Lead não encontrado')
      }
      
      // Criar oportunidade automaticamente
      const opportunity = await funnelApi.createOpportunity({
        lead_id: leadId,
        company_id: lead.company_id,
        title: `Oportunidade - ${lead.name}`,
        source: lead.origin,
        owner_user_id: lead.responsible_user_id
      })
      
      // Adicionar oportunidade ao funil
      await funnelApi.addOpportunityToFunnel(opportunity.id, funnelId, firstStage.id)
      
      // Atualizar lista
      await fetchPositions()
    } catch (err) {
      console.error('Error adding lead to funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao adicionar lead ao funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [fetchPositions])

  // Mover oportunidade por opportunity_id (lookup direto, sem ambiguidade por lead_id)
  const moveOpportunityById = useCallback(async (
    opportunityId: string,
    toStageId: string,
    position: number
  ): Promise<void> => {
    try {
      setError(undefined)

      const currentPosition = positions.find(p => p.opportunity_id === opportunityId)
      if (!currentPosition) {
        throw new Error('Oportunidade não encontrada no funil')
      }

      await funnelApi.moveOpportunityToStage({
        opportunity_id: opportunityId,
        funnel_id: funnelId,
        from_stage_id: currentPosition.stage_id,
        to_stage_id: toStageId,
        position_in_stage: position
      })

      await fetchPositions()
    } catch (err) {
      console.error('Error moving opportunity by id:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao mover oportunidade'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [funnelId, positions, fetchPositions])

  // Remover oportunidade do funil (ATUALIZADO)
  const removeLeadFromFunnel = useCallback(async (leadId: number, funnelId: string): Promise<void> => {
    try {
      setError(undefined)
      
      // Encontrar oportunidade pelo lead_id
      const position = positions.find(p => p.lead_id === leadId)
      if (!position) {
        throw new Error('Oportunidade não encontrada')
      }
      
      // Remover oportunidade do funil
      await funnelApi.removeOpportunityFromFunnel(position.opportunity_id, funnelId)
      
      // Remover da lista local
      setPositions(prev => prev.filter(p => p.lead_id !== leadId))
    } catch (err) {
      console.error('Error removing opportunity from funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao remover oportunidade do funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [positions])

  // Refresh
  const refreshPositions = useCallback(async () => {
    await fetchPositions()
  }, [fetchPositions])

  return {
    positions,
    loading,
    error,
    moveLeadToStage,
    moveOpportunityById,
    addLeadToFunnel,
    removeLeadFromFunnel,
    refreshPositions
  }
}
