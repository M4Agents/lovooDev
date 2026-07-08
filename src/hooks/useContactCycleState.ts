// =====================================================
// useContactCycleState
//
// Hook responsável por avaliar elegibilidade de tentativa
// de contato após envio de mensagem no chat.
//
// Fluxo:
//   1. ChatArea chama triggerCheck(leadId, whatsappMessageId)
//      imediatamente após envio bem-sucedido
//   2. Hook chama GET /api/contact-cycles/by-lead/{leadId}
//   3. Se eligible_for_attempt = true → preenche modalState
//   4. Modal lê modalState e se abre
//   5. Usuário confirma ou cancela → dismiss() limpa o estado
//
// Garantias:
//   - Nunca lança erro para o ChatArea
//   - Nunca bloqueia envio de mensagem
//   - leadId nulo ou inválido → no-op silencioso
//   - Qualquer erro de API → no-op silencioso (log apenas)
//   - eligible_for_attempt = false → no-op silencioso
// =====================================================

import { useState, useCallback } from 'react'
import { contactCycleApi } from '../services/contactCycleApi'
import type { ContactCycleByLeadState } from '../types/contact-cycles'

// ── Interface pública do modalState ─────────────────────────────

/**
 * Estado passado para o ContactAttemptModal quando há elegibilidade.
 * null = modal fechado.
 */
export interface ContactAttemptModalState {
  /** UUID da oportunidade resolvida pelo backend */
  opportunityId: string
  /** ID da mensagem WhatsApp que originou a tentativa (para linkagem) */
  whatsappMessageId: string | null
  /** Snapshot completo retornado por /by-lead — disponível ao modal para contexto */
  cycleState: ContactCycleByLeadState
}

// ── Hook ────────────────────────────────────────────────────────

interface UseContactCycleStateReturn {
  /**
   * Estado atual do modal.
   * null quando o modal está fechado.
   * Preenchido quando eligible_for_attempt = true após triggerCheck.
   */
  modalState: ContactAttemptModalState | null

  /**
   * Chamar após envio bem-sucedido de mensagem.
   * Avalia elegibilidade e preenche modalState se aplicável.
   * Nunca lança erro — falhas são capturadas internamente.
   *
   * @param leadId           ID numérico do lead (null/undefined → no-op)
   * @param whatsappMessageId ID da mensagem enviada (opcional, para linkagem)
   */
  triggerCheck: (
    leadId: number | null | undefined,
    whatsappMessageId?: string | null,
  ) => Promise<void>

  /**
   * Fechar o modal sem registrar tentativa (cancelamento pelo usuário).
   * Limpa modalState sem efeito colateral.
   */
  dismiss: () => void
}

export function useContactCycleState(companyId: string): UseContactCycleStateReturn {
  const [modalState, setModalState] = useState<ContactAttemptModalState | null>(null)

  const triggerCheck = useCallback(
    async (
      leadId: number | null | undefined,
      whatsappMessageId?: string | null,
    ): Promise<void> => {
      // Guard: leadId inválido → no-op silencioso
      if (!leadId || !Number.isInteger(leadId) || leadId <= 0) return

      // Guard: companyId ausente → no-op silencioso
      if (!companyId) return

      try {
        const state = await contactCycleApi.getStateByLead(leadId, companyId)

        // Sem oportunidade válida ou não elegível → no-op
        if (!state.eligible_for_attempt || !state.opportunity_id) return

        // Elegível: preencher modalState para abrir o modal
        setModalState({
          opportunityId:    state.opportunity_id,
          whatsappMessageId: whatsappMessageId ?? null,
          cycleState:       state,
        })
      } catch (err) {
        // Nunca propagar erro — falhas de elegibilidade não devem impactar o chat
        console.warn('[useContactCycleState] Falha ao verificar elegibilidade:', err)
      }
    },
    [companyId],
  )

  const dismiss = useCallback(() => {
    setModalState(null)
  }, [])

  return { modalState, triggerCheck, dismiss }
}
