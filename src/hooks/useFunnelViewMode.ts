// =====================================================
// HOOK: useFunnelViewMode
// Persistência do modo Kanban/Lista por companyId + userId.
// Grava somente no clique explícito, com contexto válido.
// Troca de empresa/usuário só relê — nunca escreve a chave nova
// com o modo do contexto anterior.
// =====================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FunnelViewMode } from '../types/sales-funnel'

function buildStorageKey(
  companyId: string | undefined,
  userId: string | undefined,
): string | null {
  if (!companyId || !userId) return null
  return `funnel_view_mode_${companyId}_${userId}`
}

function readStoredMode(key: string | null): FunnelViewMode {
  if (!key) return 'kanban'
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'kanban' || raw === 'list') return raw
    return 'kanban'
  } catch {
    return 'kanban'
  }
}

export interface UseFunnelViewModeReturn {
  viewMode: FunnelViewMode
  setViewMode: (mode: FunnelViewMode) => void
}

export function useFunnelViewMode(
  companyId: string | undefined,
  userId: string | undefined,
): UseFunnelViewModeReturn {
  const storageKey = useMemo(
    () => buildStorageKey(companyId, userId),
    [companyId, userId],
  )

  const [viewMode, setViewModeState] = useState<FunnelViewMode>('kanban')

  useEffect(() => {
    setViewModeState(readStoredMode(storageKey))
  }, [storageKey])

  const setViewMode = useCallback((mode: FunnelViewMode) => {
    if (mode !== 'kanban' && mode !== 'list') return
    if (!storageKey) return
    setViewModeState(mode)
    try {
      localStorage.setItem(storageKey, mode)
    } catch {
      /* quota ou bloqueio — estado local ainda reflete o clique */
    }
  }, [storageKey])

  return { viewMode, setViewMode }
}
