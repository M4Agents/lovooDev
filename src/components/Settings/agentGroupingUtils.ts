// =============================================================================
// src/components/Settings/agentGroupingUtils.ts
//
// Utilitários puros de agrupamento de mensagens para AgentForm.
// Extraídos como funções puras para facilitar testes sem renderização React.
// =============================================================================

/** Menor valor aceito para message_grouping_window_s quando habilitado. */
export const GROUPING_WINDOW_MIN = 1

/** Maior valor aceito para message_grouping_window_s. */
export const GROUPING_WINDOW_MAX = 120

/** Valor default exibido no campo quando o toggle é habilitado pela primeira vez. */
export const GROUPING_WINDOW_DEFAULT = 30

/**
 * Inicializa o estado de agrupamento a partir do model_config do agente.
 *
 * - Se message_grouping_window_s for inteiro em [1, 120]: toggle habilitado + janela = valor.
 * - Caso contrário (0, ausente ou inválido): toggle desabilitado + janela = DEFAULT.
 */
export function initGroupingState(modelConfig: Record<string, unknown> | null | undefined): {
  enabled: boolean
  window: number
} {
  const v = modelConfig?.message_grouping_window_s
  if (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= GROUPING_WINDOW_MIN &&
    v <= GROUPING_WINDOW_MAX
  ) {
    return { enabled: true, window: v }
  }
  return { enabled: false, window: GROUPING_WINDOW_DEFAULT }
}

/**
 * Computa o valor de message_grouping_window_s a ser incluído no model_config.
 *
 * - Toggle desligado → 0 (desabilitado explicitamente).
 * - Toggle ligado    → window (inteiro fornecido pelo usuário).
 */
export function computeGroupingPayload(enabled: boolean, window: number): number {
  return enabled ? window : 0
}

/**
 * Valida a entrada de agrupamento antes do submit.
 *
 * Retorna uma mensagem de erro legível, ou null se válido.
 */
export function validateGroupingInput(enabled: boolean, window: number): string | null {
  if (!enabled) return null
  if (!Number.isInteger(window) || window < GROUPING_WINDOW_MIN || window > GROUPING_WINDOW_MAX) {
    return `O tempo de espera deve ser um inteiro entre ${GROUPING_WINDOW_MIN} e ${GROUPING_WINDOW_MAX} segundos.`
  }
  return null
}
