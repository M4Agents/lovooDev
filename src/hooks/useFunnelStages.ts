// =====================================================
// HOOK: useFunnelStages
// Data: 03/03/2026
// Objetivo: Hook para gerenciar etapas do funil
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import type {
  FunnelStage,
  CreateStageForm,
  UpdateStageForm,
  StageFilter,
  UseFunnelStagesReturn
} from '../types/sales-funnel'

export const useFunnelStages = (funnelId: string, filter?: StageFilter): UseFunnelStagesReturn => {
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Buscar etapas
  const fetchStages = useCallback(async () => {
    if (!funnelId) return
    
    try {
      setLoading(true)
      setError(undefined)
      
      const data = await funnelApi.getStages(funnelId, filter)
      setStages(data)
    } catch (err) {
      console.error('Error fetching stages:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar etapas')
    } finally {
      setLoading(false)
    }
  }, [funnelId, filter])

  // Carregar etapas ao montar
  useEffect(() => {
    fetchStages()
  }, [fetchStages])

  // Criar etapa
  const createStage = useCallback(async (data: CreateStageForm): Promise<FunnelStage> => {
    try {
      setError(undefined)
      const newStage = await funnelApi.createStage(data)
      
      // Atualizar lista
      setStages(prev => [...prev, newStage].sort((a, b) => a.position - b.position))
      
      return newStage
    } catch (err) {
      console.error('Error creating stage:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao criar etapa'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  // Atualizar etapa
  const updateStage = useCallback(async (id: string, data: UpdateStageForm): Promise<FunnelStage> => {
    try {
      setError(undefined)
      const updatedStage = await funnelApi.updateStage(id, data)
      
      // Atualizar lista
      setStages(prev => prev.map(s => s.id === id ? updatedStage : s).sort((a, b) => a.position - b.position))
      
      return updatedStage
    } catch (err) {
      console.error('Error updating stage:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao atualizar etapa'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  // Deletar etapa
  const deleteStage = useCallback(async (id: string): Promise<void> => {
    try {
      setError(undefined)
      await funnelApi.deleteStage(id)
      
      // Remover da lista
      setStages(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      console.error('Error deleting stage:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao deletar etapa'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  // Reordenar etapas
  const reorderStages = useCallback(async (stageIds: string[]): Promise<void> => {
    try {
      setError(undefined)
      await funnelApi.reorderStages(stageIds)
      
      // Atualizar ordem local
      const reordered = stageIds.map((id, index) => {
        const stage = stages.find(s => s.id === id)
        return stage ? { ...stage, position: index } : null
      }).filter(Boolean) as FunnelStage[]
      
      setStages(reordered)
    } catch (err) {
      console.error('Error reordering stages:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao reordenar etapas'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [stages])

  // Refresh
  const refreshStages = useCallback(async () => {
    await fetchStages()
  }, [fetchStages])

  return {
    stages,
    loading,
    error,
    createStage,
    updateStage,
    deleteStage,
    reorderStages,
    refreshStages
  }
}
