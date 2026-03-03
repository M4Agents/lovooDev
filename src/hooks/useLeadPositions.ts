// =====================================================
// HOOK: useLeadPositions
// Data: 03/03/2026
// Objetivo: Hook para gerenciar posições dos leads no funil
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import type {
  LeadFunnelPosition,
  LeadPositionFilter,
  UseLeadPositionsReturn
} from '../types/sales-funnel'

export const useLeadPositions = (funnelId: string, filter?: LeadPositionFilter): UseLeadPositionsReturn => {
  const [positions, setPositions] = useState<LeadFunnelPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Buscar posições
  const fetchPositions = useCallback(async () => {
    if (!funnelId) return
    
    try {
      setLoading(true)
      setError(undefined)
      
      const data = await funnelApi.getLeadPositions(funnelId, filter)
      setPositions(data)
    } catch (err) {
      console.error('Error fetching lead positions:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar posições dos leads')
    } finally {
      setLoading(false)
    }
  }, [funnelId, filter])

  // Carregar posições ao montar
  useEffect(() => {
    fetchPositions()
  }, [fetchPositions])

  // Mover lead para outra etapa
  const moveLeadToStage = useCallback(async (
    leadId: number,
    toStageId: string,
    position: number
  ): Promise<void> => {
    try {
      setError(undefined)
      
      // Encontrar posição atual do lead
      const currentPosition = positions.find(p => p.lead_id === leadId)
      if (!currentPosition) {
        throw new Error('Lead não encontrado no funil')
      }
      
      // Mover lead
      await funnelApi.moveLeadToStage({
        lead_id: leadId,
        funnel_id: funnelId,
        from_stage_id: currentPosition.stage_id,
        to_stage_id: toStageId,
        position_in_stage: position
      })
      
      // Atualizar lista local
      await fetchPositions()
    } catch (err) {
      console.error('Error moving lead:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao mover lead'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [funnelId, positions, fetchPositions])

  // Adicionar lead ao funil
  const addLeadToFunnel = useCallback(async (leadId: number, funnelId: string): Promise<void> => {
    try {
      setError(undefined)
      
      // Buscar primeira etapa do funil (system stage)
      const stages = await funnelApi.getStages(funnelId)
      const firstStage = stages.find(s => s.is_system_stage && s.position === 0) || stages[0]
      
      if (!firstStage) {
        throw new Error('Funil não possui etapas')
      }
      
      // Adicionar lead
      await funnelApi.addLeadToFunnel(leadId, funnelId, firstStage.id)
      
      // Atualizar lista
      await fetchPositions()
    } catch (err) {
      console.error('Error adding lead to funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao adicionar lead ao funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [fetchPositions])

  // Remover lead do funil
  const removeLeadFromFunnel = useCallback(async (leadId: number, funnelId: string): Promise<void> => {
    try {
      setError(undefined)
      await funnelApi.removeLeadFromFunnel(leadId, funnelId)
      
      // Remover da lista local
      setPositions(prev => prev.filter(p => p.lead_id !== leadId))
    } catch (err) {
      console.error('Error removing lead from funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao remover lead do funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  // Refresh
  const refreshPositions = useCallback(async () => {
    await fetchPositions()
  }, [fetchPositions])

  return {
    positions,
    loading,
    error,
    moveLeadToStage,
    addLeadToFunnel,
    removeLeadFromFunnel,
    refreshPositions
  }
}
