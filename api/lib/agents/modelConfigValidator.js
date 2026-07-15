// =============================================================================
// api/lib/agents/modelConfigValidator.js
//
// Validações puras de campos do model_config de agentes conversacionais.
// Funções síncronas sem dependências externas — seguras para testes unitários.
// =============================================================================

/**
 * Valida o campo message_grouping_window_s do model_config.
 *
 * Regras:
 *   - ausente (undefined/null) → permitido
 *   - 0                        → permitido (agrupamento desabilitado)
 *   - inteiro 1–120            → permitido
 *   - qualquer outro valor     → erro (string descritiva)
 *
 * @param {unknown} value - Valor a validar (model_config.message_grouping_window_s).
 * @returns {string|null} Mensagem de erro, ou null se válido.
 */
export function validateMessageGroupingWindowS(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 120) {
    return 'model_config.message_grouping_window_s deve ser um inteiro entre 0 e 120 (0 = desabilitado).';
  }
  return null;
}
