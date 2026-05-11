// =====================================================
// useDashboardEntityActions
// Hook compartilhado para ações de entidade no dashboard.
//
// Responsabilidades:
//   - openChat(leadId)        → abre ChatModalSimple
//   - openOpportunity(id)     → carrega e abre OpportunityDetailModal
//   - estados dos modais (open, selectedX)
//   - loading de oportunidade (openingOppId)
//   - userId via useAuth (sem prop drilling)
//
// Padrão de referência: IntelligenceCentral.tsx
// =====================================================

import { useState, useCallback, useRef } from 'react'
import { funnelApi }  from '../../services/funnelApi'
import { useAuth }    from '../../contexts/AuthContext'
import type { Opportunity } from '../../types/sales-funnel'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface DashboardEntityActionsState {
  // Chat
  chatLeadId:  number | null
  chatOpen:    boolean
  openChat:    (leadId: number) => void
  closeChat:   () => void

  // Oportunidade
  selectedOpportunity: Opportunity | null
  oppModalOpen:        boolean
  openingOppId:        string | null
  openOpportunity:     (opportunityId: string) => Promise<void>
  closeOpportunity:    () => void

  // Dados para renderizar modais
  companyId: string | null
  userId:    string | undefined
}

interface Options {
  companyId: string | null | undefined
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardEntityActions({ companyId }: Options): DashboardEntityActionsState {
  const { user } = useAuth()

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [chatLeadId, setChatLeadId] = useState<number | null>(null)
  const [chatOpen,   setChatOpen]   = useState(false)

  const openChat = useCallback((leadId: number) => {
    setChatLeadId(leadId)
    setChatOpen(true)
  }, [])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    setChatLeadId(null)
  }, [])

  // ── Oportunidade ──────────────────────────────────────────────────────────
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null)
  const [oppModalOpen,        setOppModalOpen]        = useState(false)
  const [openingOppId,        setOpeningOppId]        = useState<string | null>(null)

  // Ref síncrono para guard de double-click (não depende de ciclo de state)
  const isLoadingOppRef = useRef(false)

  const openOpportunity = useCallback(async (opportunityId: string) => {
    if (isLoadingOppRef.current) return // Previne múltiplos fetches simultâneos

    isLoadingOppRef.current = true
    setOpeningOppId(opportunityId)

    try {
      const opp = await funnelApi.getOpportunityById(opportunityId)
      if (opp) {
        setSelectedOpportunity(opp)
        setOppModalOpen(true)
      }
    } catch {
      // falha silenciosa — oportunidade não encontrada ou erro de rede
    } finally {
      isLoadingOppRef.current = false
      setOpeningOppId(null)
    }
  }, []) // estável — usa ref para guard, não state

  const closeOpportunity = useCallback(() => {
    setOppModalOpen(false)
    setSelectedOpportunity(null)
  }, [])

  return {
    // Chat
    chatLeadId,
    chatOpen,
    openChat,
    closeChat,
    // Oportunidade
    selectedOpportunity,
    oppModalOpen,
    openingOppId,
    openOpportunity,
    closeOpportunity,
    // Contexto para modais
    companyId: companyId ?? null,
    userId:    user?.id,
  }
}
