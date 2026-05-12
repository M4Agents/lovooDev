// =====================================================
// useFeatureFlags — Feature flags para FASE 4.1
//
// Lidas de variáveis de ambiente VITE_FEATURE_*.
// Se a flag não estiver definida, o comportamento padrão
// é FALSE (conservador) — nenhuma funcionalidade nova é ativada.
//
// Regra de segurança: com flags desligadas o dashboard
// se comporta exatamente como antes da FASE 4.1.
// =====================================================

export interface FeatureFlags {
  /** Exibe badge delta WoW/MoM nos KPIs (DeltaBadge + TrendSparkline) */
  snapshotDelta:      boolean
  /** Exibe trendline histórica (SLA trendline, trendlines expandidas) */
  snapshotTrends:     boolean
  /** Exibe comparação de período lado a lado nos KPIs */
  snapshotComparison: boolean
}

function parseFlag(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

export function useFeatureFlags(): FeatureFlags {
  return {
    snapshotDelta:      parseFlag(import.meta.env.VITE_FEATURE_SNAPSHOT_DELTA),
    snapshotTrends:     parseFlag(import.meta.env.VITE_FEATURE_SNAPSHOT_TRENDS),
    snapshotComparison: parseFlag(import.meta.env.VITE_FEATURE_SNAPSHOT_COMPARISON),
  }
}
