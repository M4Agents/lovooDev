// =====================================================
// useFeatureFlags — Feature flags para FASE 4.1 / 4.2
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
  snapshotDelta:             boolean
  /** Exibe trendline histórica (SLA trendline, trendlines expandidas) */
  snapshotTrends:            boolean
  /**
   * FASE 4.2 Sprint 2 — Executive Summary híbrido.
   * Quando true + canUseSnapshots, usa /api/dashboard/executive-summary-v2
   * (realtime + comparação num único request) em vez do fluxo v1 separado.
   * Padrão: false (rollback instantâneo ao desligar).
   */
  hybridExecutiveSummary:    boolean
  /**
   * FASE 4.2 Sprint 3 — Seller Ranking híbrido.
   * Quando true + canUseSnapshots, usa /api/dashboard/seller-ranking-v2
   * (ranking realtime + deltas históricos num único request),
   * eliminando o request separado para snapshot-seller-deltas.
   * Padrão: false (rollback instantâneo ao desligar).
   */
  hybridSellerRanking:       boolean
  /**
   * FASE 4.2 Sprint 4 — SLA Alerts híbrido.
   * Quando true + canUseSnapshots, usa /api/dashboard/sla-alerts-v2
   * (alertas realtime + trend de sla_breached_count num único request).
   * SlaAlertsPanel permanece sem alteração — recebe SnapshotTrendsData compatível.
   * Padrão: false (rollback instantâneo ao desligar).
   */
  hybridSlaAlerts:           boolean
  /**
   * FASE 4.2 Sprint 5 — Forecast Híbrido.
   * Ativa o endpoint forecast-v2 (realtime + comparação histórica WoW/MoM).
   * ForecastSection recebe DeltaBadge para pipeline_weighted, pipeline_risk,
   * won_value e stalled_count.
   * Padrão: false (rollback instantâneo ao desligar).
   */
  hybridForecast:            boolean
  /**
   * FASE 4.2 Sprint 6 — Funnel Executive Híbrido.
   * Ativa o endpoint funnel-executive-v2 (realtime por etapa + deltas WoW/MoM).
   * FunnelExecutiveSection exibe DeltaBadge em weighted_value e stalled_count.
   * Padrão: false (rollback instantâneo ao desligar).
   */
  hybridFunnelExecutive:     boolean
}

function parseFlag(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

export function useFeatureFlags(): FeatureFlags {
  return {
    snapshotDelta:          parseFlag(import.meta.env.VITE_FEATURE_SNAPSHOT_DELTA),
    snapshotTrends:         parseFlag(import.meta.env.VITE_FEATURE_SNAPSHOT_TRENDS),
    hybridExecutiveSummary: parseFlag(import.meta.env.VITE_FEATURE_HYBRID_EXECUTIVE_SUMMARY),
    hybridSellerRanking:    parseFlag(import.meta.env.VITE_FEATURE_HYBRID_SELLER_RANKING),
    hybridSlaAlerts:        parseFlag(import.meta.env.VITE_FEATURE_HYBRID_SLA_ALERTS),
    hybridForecast:         parseFlag(import.meta.env.VITE_FEATURE_HYBRID_FORECAST),
    hybridFunnelExecutive:  parseFlag(import.meta.env.VITE_FEATURE_HYBRID_FUNNEL_EXECUTIVE),
  }
}
