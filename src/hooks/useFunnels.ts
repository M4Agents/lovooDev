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

// Chave de localStorage escopada por usuário + empresa:
// evita que troca de conta ou de empresa reutilize seleção anterior.
function getLocalStorageKey(userId: string, companyId: string): string {
  return `${userId}_${companyId}_selected_funnel_id`
}

export const useFunnels = (
  companyId: string,
  filter?: FunnelFilter,
  userId?: string
): UseFunnelsReturn => {
  const [funnels, setFunnels] = useState<SalesFunnel[]>([])
  const [selectedFunnel, setSelectedFunnelState] = useState<SalesFunnel | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [planFunnelLimit, setPlanFunnelLimit] = useState<number | null>(null)

  // IDs dos funis visíveis para o usuário (null = sem restrição)
  const [visibleFunnelIds, setVisibleFunnelIds] = useState<string[] | null>(null)

  // Ref para saber se já houve ao menos uma carga inicial.
  // setLoading(true) (que substitui a tela por um spinner) só ocorre nesse primeiro load.
  // Refreshes subsequentes (ex: após toggle de campo) são silenciosos e não desmontam modais abertos.
  const initializedRef = useRef(false)

  // Determinar os funis visíveis com base nas settings do usuário.
  // Retorna null quando não há restrição (usuário vê todos os funis).
  const resolveVisibleFunnelIds = useCallback(async (
    allFunnels: SalesFunnel[]
  ): Promise<string[] | null> => {
    if (!userId || !companyId) return null

    const settings = await funnelApi.getUserFunnelSettings(companyId, userId)

    // Sem registro ou is_enabled = false → sem restrição
    if (!settings || !settings.isEnabled) return null

    // is_enabled = true + lista vazia → sem restrição
    if (settings.allowedFunnelIds.length === 0) return null

    // is_enabled = true + lista de IDs → filtrar apenas funis existentes na lista
    const allowedSet = new Set(settings.allowedFunnelIds)
    const visible = allFunnels
      .filter(f => allowedSet.has(f.id))
      .map(f => f.id)

    return visible
  }, [companyId, userId])

  // Selecionar o funil inicial com base nas prioridades definidas
  const resolveInitialFunnel = useCallback((
    allFunnels: SalesFunnel[],
    visibleIds: string[] | null,
    defaultFunnelId: string | null | undefined,
    currentSelected?: SalesFunnel
  ): SalesFunnel | undefined => {
    const visibleFunnels = visibleIds
      ? allFunnels.filter(f => visibleIds.includes(f.id))
      : allFunnels

    if (visibleFunnels.length === 0) return undefined

    // 1. Manter funil atualmente selecionado se ainda visível (refresh)
    if (currentSelected) {
      const still = visibleFunnels.find(f => f.id === currentSelected.id)
      if (still) return still
    }

    // 2. Funil padrão da settings do usuário (default_funnel_id)
    if (defaultFunnelId) {
      const fromSettings = visibleFunnels.find(f => f.id === defaultFunnelId)
      if (fromSettings) return fromSettings
    }

    // 3. localStorage escopado por userId + companyId
    if (userId && companyId) {
      const key = getLocalStorageKey(userId, companyId)
      const saved = localStorage.getItem(key)
      if (saved) {
        const found = visibleFunnels.find(f => f.id === saved)
        if (found) return found
        // ID salvo não existe mais (funil deletado ou acesso revogado) → ignorar silenciosamente
      }
    } else {
      // Fallback para chave legada (sem userId)
      const saved = localStorage.getItem('selected_funnel_id')
      if (saved) {
        const found = visibleFunnels.find(f => f.id === saved)
        if (found) return found
      }
    }

    // 4. Funil marcado como padrão da empresa
    const defaultFunnel = visibleFunnels.find(f => f.is_default)
    if (defaultFunnel) return defaultFunnel

    // 5. Primeiro funil disponível
    return visibleFunnels[0]
  }, [userId, companyId])

  // Buscar funis + settings do usuário
  const fetchFunnels = useCallback(async () => {
    try {
      // Exibir spinner de tela cheia apenas na carga inicial
      if (!initializedRef.current) {
        setLoading(true)
      }
      setError(undefined)

      const data = await funnelApi.getFunnels(companyId, filter)
      setFunnels(data)

      // Resolver funis visíveis (respeitando settings do usuário)
      const resolved = await resolveVisibleFunnelIds(data)
      setVisibleFunnelIds(resolved)

      // Buscar default_funnel_id das settings (para prioridade de seleção)
      let defaultFunnelId: string | null = null
      if (userId && companyId) {
        const settings = await funnelApi.getUserFunnelSettings(companyId, userId)
        defaultFunnelId = settings?.defaultFunnelId ?? null
      }

      // Atualiza selectedFunnel via functional update
      setSelectedFunnelState(prev => {
        if (!prev) {
          // Carga inicial
          if (data.length === 0) return undefined
          return resolveInitialFunnel(data, resolved, defaultFunnelId)
        }
        // Refresh: manter seleção ou ajustar se funil ficou inacessível
        return resolveInitialFunnel(data, resolved, defaultFunnelId, prev)
      })
    } catch (err) {
      console.error('Error fetching funnels:', err)
      setError(err instanceof Error ? err.message : 'Erro ao buscar funis')
    } finally {
      setLoading(false)
      initializedRef.current = true
    }
  }, [companyId, filter, userId, resolveVisibleFunnelIds, resolveInitialFunnel])

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

  // Selecionar funil e persistir no localStorage escopado
  const setSelectedFunnel = useCallback((funnelId: string) => {
    const funnel = funnels.find(f => f.id === funnelId)
    if (funnel) {
      setSelectedFunnelState(funnel)
      if (userId && companyId) {
        localStorage.setItem(getLocalStorageKey(userId, companyId), funnelId)
      } else {
        localStorage.setItem('selected_funnel_id', funnelId)
      }
    }
  }, [funnels, userId, companyId])

  // Criar funil
  const createFunnel = useCallback(async (data: CreateFunnelForm): Promise<SalesFunnel> => {
    try {
      setError(undefined)
      const newFunnel = await funnelApi.createFunnel(companyId, data)

      setFunnels(prev => [...prev, newFunnel])

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

      setFunnels(prev => prev.map(f => f.id === id ? updatedFunnel : f))

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

      setFunnels(prev => prev.filter(f => f.id !== id))

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

      for (const funnel of funnels) {
        const { error: updateError } = await supabase
          .from('sales_funnels')
          .update({ display_order: funnel.display_order })
          .eq('id', funnel.id)
          .eq('company_id', companyId)

        if (updateError) throw updateError
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

  // Funis filtrados pela visibilidade do usuário
  const visibleFunnels = visibleFunnelIds
    ? funnels.filter(f => visibleFunnelIds.includes(f.id))
    : funnels

  return {
    funnels: visibleFunnels,
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
    visibleFunnelIds,
  }
}
