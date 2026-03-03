// =====================================================
// HOOK: useFunnels
// Data: 03/03/2026
// Objetivo: Hook para gerenciar funis de vendas
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import type {
  SalesFunnel,
  CreateFunnelForm,
  UpdateFunnelForm,
  FunnelFilter,
  UseFunnelsReturn
} from '../types/sales-funnel'

export const useFunnels = (companyId: string, filter?: FunnelFilter): UseFunnelsReturn => {
  const [funnels, setFunnels] = useState<SalesFunnel[]>([])
  const [selectedFunnel, setSelectedFunnelState] = useState<SalesFunnel | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Buscar funis
  const fetchFunnels = useCallback(async () => {
    try {
      setLoading(true)
      setError(undefined)
      
      const data = await funnelApi.getFunnels(companyId, filter)
      setFunnels(data)
      
      // Se não tem funil selecionado, selecionar o padrão
      if (!selectedFunnel && data.length > 0) {
        const defaultFunnel = data.find(f => f.is_default) || data[0]
        setSelectedFunnelState(defaultFunnel)
      }
    } catch (err) {
      console.error('Error fetching funnels:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar funis')
    } finally {
      setLoading(false)
    }
  }, [companyId, filter, selectedFunnel])

  // Carregar funis ao montar
  useEffect(() => {
    if (companyId) {
      fetchFunnels()
    }
  }, [companyId, fetchFunnels])

  // Selecionar funil
  const setSelectedFunnel = useCallback((funnelId: string) => {
    const funnel = funnels.find(f => f.id === funnelId)
    if (funnel) {
      setSelectedFunnelState(funnel)
      // Salvar no localStorage para persistir seleção
      localStorage.setItem('selected_funnel_id', funnelId)
    }
  }, [funnels])

  // Criar funil
  const createFunnel = useCallback(async (data: CreateFunnelForm): Promise<SalesFunnel> => {
    try {
      setError(undefined)
      const newFunnel = await funnelApi.createFunnel(companyId, data)
      
      // Atualizar lista
      setFunnels(prev => [...prev, newFunnel])
      
      // Se é o primeiro funil ou é marcado como padrão, selecionar
      if (funnels.length === 0 || data.is_default) {
        setSelectedFunnelState(newFunnel)
      }
      
      return newFunnel
    } catch (err) {
      console.error('Error creating funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao criar funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [companyId, funnels.length])

  // Atualizar funil
  const updateFunnel = useCallback(async (id: string, data: UpdateFunnelForm): Promise<SalesFunnel> => {
    try {
      setError(undefined)
      const updatedFunnel = await funnelApi.updateFunnel(id, data)
      
      // Atualizar lista
      setFunnels(prev => prev.map(f => f.id === id ? updatedFunnel : f))
      
      // Se é o funil selecionado, atualizar
      if (selectedFunnel?.id === id) {
        setSelectedFunnelState(updatedFunnel)
      }
      
      return updatedFunnel
    } catch (err) {
      console.error('Error updating funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao atualizar funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [selectedFunnel])

  // Deletar funil
  const deleteFunnel = useCallback(async (id: string): Promise<void> => {
    try {
      setError(undefined)
      await funnelApi.deleteFunnel(id)
      
      // Remover da lista
      setFunnels(prev => prev.filter(f => f.id !== id))
      
      // Se era o funil selecionado, selecionar outro
      if (selectedFunnel?.id === id) {
        const remaining = funnels.filter(f => f.id !== id)
        setSelectedFunnelState(remaining[0])
      }
    } catch (err) {
      console.error('Error deleting funnel:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao deletar funil'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [selectedFunnel, funnels])

  // Refresh
  const refreshFunnels = useCallback(async () => {
    await fetchFunnels()
  }, [fetchFunnels])

  return {
    funnels,
    loading,
    error,
    selectedFunnel,
    setSelectedFunnel,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    refreshFunnels
  }
}
