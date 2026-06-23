// =====================================================
// HOOK: useFunnels
// Data: 03/03/2026
// Objetivo: Hook para gerenciar funis de vendas
// =====================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { funnelApi } from '../services/funnelApi'
import { supabase } from '../lib/supabase'
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
  const [planFunnelLimit, setPlanFunnelLimit] = useState<number | null>(null)

  // Ref para saber se já houve ao menos uma carga inicial.
  // setLoading(true) (que substitui a tela por um spinner) só ocorre nesse primeiro load.
  // Refreshes subsequentes (ex: após toggle de campo) são silenciosos e não desmontam modais abertos.
  const initializedRef = useRef(false)

  // Buscar funis
  const fetchFunnels = useCallback(async () => {
    try {
      // Exibir spinner de tela cheia apenas na carga inicial
      if (!initializedRef.current) {
        setLoading(true)
      }
      setError(undefined)

      const data = await funnelApi.getFunnels(companyId, filter)
      setFunnels(data)

      // Atualiza selectedFunnel via functional update:
      // — evita incluir selectedFunnel nos deps (prevenindo loop infinito)
      // — garante que o funil selecionado sempre reflita os dados mais recentes do banco
      setSelectedFunnelState(prev => {
        if (!prev) {
          // Carga inicial: restaurar seleção salva ou usar padrão
          if (data.length === 0) return undefined
          const saved = localStorage.getItem('selected_funnel_id')
          if (saved) {
            const found = data.find(f => f.id === saved)
            if (found) return found
          }
          return data.find(f => f.is_default) || data[0]
        }
        // Refresh: substituir pelo objeto atualizado do banco (mesma id)
        const fresh = data.find(f => f.id === prev.id)
        // #region agent log
        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'449c25'},body:JSON.stringify({sessionId:'449c25',location:'useFunnels.ts:refresh',message:'selectedFunnel refresh',data:{prevId:prev.id,freshRequireWonSaleType:fresh?.require_won_sale_type??'not_found'},runId:'post-fix',hypothesisId:'A',timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        return fresh || prev
      })
    } catch (err) {
      console.error('Error fetching funnels:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar funis')
    } finally {
      setLoading(false)
      initializedRef.current = true
    }
  }, [companyId, filter])

  // Buscar limite de funis do plano
  useEffect(() => {
    if (!companyId) return
    supabase
      .from('companies')
      .select('plans!plan_id(max_funnels)')
      .eq('id', companyId)
      .single()
      .then(({ data }) => {
        const plan = (data as { plans?: { max_funnels?: number | null } | null })?.plans
        setPlanFunnelLimit(plan?.max_funnels ?? null)
      })
      .catch(() => setPlanFunnelLimit(null))
  }, [companyId])

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

  // Reordenar funis
  const reorderFunnels = useCallback(async (funnels: Array<{id: string, display_order: number}>): Promise<void> => {
    try {
      setError(undefined)
      
      // Update direto no Supabase (bypass da API)
      for (const funnel of funnels) {
        const { error: updateError } = await supabase
          .from('sales_funnels')
          .update({ display_order: funnel.display_order })
          .eq('id', funnel.id)
          .eq('company_id', companyId)
        
        if (updateError) {
          throw updateError
        }
      }
      
      await fetchFunnels()
    } catch (err) {
      console.error('Error reordering funnels:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erro ao reordenar funis'
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [companyId, fetchFunnels])

  // Refresh
  const refreshFunnels = useCallback(async () => {
    await fetchFunnels()
  }, [fetchFunnels])

  const isAtFunnelLimit = planFunnelLimit !== null && funnels.length >= planFunnelLimit

  return {
    funnels,
    loading,
    error,
    selectedFunnel,
    setSelectedFunnel,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    reorderFunnels,
    refreshFunnels,
    planFunnelLimit,
    isAtFunnelLimit,
  }
}
