// =====================================================
// insightDefaults
// Valores padrão para políticas de insights por empresa.
//
// Estes valores são usados como fallback quando a empresa
// não possui uma policy customizada em ai_insight_policies.
//
// Regra: NUNCA retornar null/undefined — sempre cair no default.
// =====================================================

export const INSIGHT_DEFAULTS = {
  /** Dias sem atualização para considerar oportunidade como "esfriando" */
  cooling_threshold_days: 3,

  /** Probabilidade mínima (%) para considerar oportunidade como "quente" */
  hot_probability_threshold: 70,

  /** Taxa de conversão (%) abaixo da qual é sinalizado como queda */
  conversion_drop_threshold: 40,

  /** Média de dias em etapa a partir do qual é considerado gargalo */
  bottleneck_min_days: 3,

  /** Taxa de erro (%) em agent_tool_executions que dispara insight de IA */
  ai_error_rate_threshold: 20,
} as const

export type InsightPolicyKey = keyof typeof INSIGHT_DEFAULTS
