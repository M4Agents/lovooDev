// =====================================================
// HELPER: cycleLabels
// Objetivo: retornar chaves de i18n para valores enum
//           do Motor de Ciclos.
//
// Nenhum texto fixo aqui — componentes chamam t(key).
// =====================================================

/**
 * Retorna a chave de tradução para um close_reason.
 * Ex: 'inbound_received' → 'contactCycle.closeReasons.inboundReceived'
 */
export function getCloseReasonKey(reason: string | null | undefined): string {
  const keys: Record<string, string> = {
    manual:           'contactCycle.closeReasons.manual',
    goal_reached:     'contactCycle.closeReasons.goalReached',
    no_response:      'contactCycle.closeReasons.noResponse',
    duplicate:        'contactCycle.closeReasons.duplicate',
    inbound_received: 'contactCycle.closeReasons.inboundReceived',
  }
  return (reason && keys[reason]) ? keys[reason] : 'contactCycle.closeReasons.unknown'
}

/**
 * Retorna a chave de tradução para um trigger_reason.
 * Ex: 'whatsapp_sent' → 'contactCycle.triggerReasons.whatsappSent'
 */
export function getTriggerReasonKey(reason: string | null | undefined): string {
  const keys: Record<string, string> = {
    manual:            'contactCycle.triggerReasons.manual',
    whatsapp_sent:     'contactCycle.triggerReasons.whatsappSent',
    whatsapp_received: 'contactCycle.triggerReasons.whatsappReceived',
    system:            'contactCycle.triggerReasons.system',
  }
  return (reason && keys[reason]) ? keys[reason] : 'contactCycle.triggerReasons.unknown'
}

/** Opções disponíveis para fechar um ciclo manualmente via UI. */
export const CLOSE_REASON_OPTIONS: Array<{
  value: 'manual' | 'goal_reached' | 'no_response' | 'duplicate'
  labelKey: string
}> = [
  { value: 'manual',       labelKey: 'contactCycle.closeReasons.manual' },
  { value: 'goal_reached', labelKey: 'contactCycle.closeReasons.goalReached' },
  { value: 'no_response',  labelKey: 'contactCycle.closeReasons.noResponse' },
  { value: 'duplicate',    labelKey: 'contactCycle.closeReasons.duplicate' },
]
