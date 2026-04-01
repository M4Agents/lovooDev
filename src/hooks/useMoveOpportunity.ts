// =====================================================
// HOOK: useMoveOpportunity
// Fase 3 — Separação de leitura e mutação
//
// Responsabilidade EXCLUSIVA: mover uma oportunidade para
// outra etapa e disparar automações. Não gerencia estado
// visual do board (responsabilidade do useBoardPositions).
//
// Uso:
//   const { move, loading, error } = useMoveOpportunity(companyId)
//   await move({ opportunity_id, funnel_id, from_stage_id, to_stage_id, position_in_stage })
//
// Automações: disparadas apenas quando from_stage_id !== to_stage_id.
// Erros de automação não bloqueiam o resultado do move.
// =====================================================

import { useCallback, useState } from 'react'
import { funnelApi } from '../services/funnelApi'
import { triggerManager } from '../services/automation/TriggerManager'
import type { MoveOpportunityForm } from '../types/sales-funnel'

export interface MoveOpportunityParams extends MoveOpportunityForm {
  lead_id?: number
  conversationId?: string
  opportunityData?: Record<string, unknown>
}

export interface UseMoveOpportunityReturn {
  move: (params: MoveOpportunityParams) => Promise<void>
  loading: boolean
  error: string | undefined
}

export function useMoveOpportunity(
  companyId: string | undefined
): UseMoveOpportunityReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const move = useCallback(async (params: MoveOpportunityParams): Promise<void> => {
    setLoading(true)
    setError(undefined)

    try {
      await funnelApi.moveOpportunityToStage({
        opportunity_id:   params.opportunity_id,
        funnel_id:        params.funnel_id,
        from_stage_id:    params.from_stage_id,
        to_stage_id:      params.to_stage_id,
        position_in_stage: params.position_in_stage
      })

      // Disparar automação apenas quando a etapa realmente muda
      if (companyId && params.from_stage_id !== params.to_stage_id) {
        triggerManager
          .onOpportunityStageChanged(
            companyId,
            params.opportunity_id,
            params.from_stage_id,
            params.to_stage_id,
            {
              opportunity_id:  params.opportunity_id,
              funnel_id:       params.funnel_id,
              lead_id:         params.lead_id,
              conversation_id: params.conversationId,
              ...(params.opportunityData ?? {})
            }
          )
          .catch(automationError => {
            console.error('Automation trigger failed (non-blocking):', automationError)
          })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao mover oportunidade'
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  return { move, loading, error }
}
