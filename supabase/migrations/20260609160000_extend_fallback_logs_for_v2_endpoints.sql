-- =====================================================
-- Amplia os CHECK constraints de dashboard_snapshot_fallback_logs
-- para suportar os endpoints híbridos v2 (FASE 4.2 Sprint 2–6)
-- e os novos motivos de fallback gerados pelo backend.
--
-- Contexto:
--   A tabela foi criada na migration 20260524200000 com constraints
--   restritas a ('comparison', 'trends', 'seller-deltas').
--   Os endpoints v2 registram fallback diretamente no backend via
--   logHistoricalFallback() em api/lib/dashboard/observability.ts,
--   sem passar pelo endpoint /api/internal/snapshot-fallback-log.
--
-- Novos valores de endpoint:
--   executive-summary-v2, seller-ranking-v2, sla-alerts-v2,
--   forecast-v2, funnel-executive-v2
--
-- Novos valores de reason:
--   aggregate_failed   → aggregate_snapshot_period lançou erro
--   cache_empty        → funnel_stages_cache ausente (funnel-executive-v2)
--   no_snapshot_data   → período sem snapshots registrados
--
-- Garantias:
--   - Não altera dados existentes
--   - Não altera índices
--   - Não altera políticas RLS
--   - ALTER TABLE ... DROP/ADD CONSTRAINT é operação de metadados
--     (rápida mesmo com dados presentes — tabela de retenção 30 dias)
-- =====================================================

ALTER TABLE dashboard_snapshot_fallback_logs
  DROP CONSTRAINT fallback_endpoint_check,
  ADD CONSTRAINT fallback_endpoint_check CHECK (
    endpoint IN (
      'comparison',
      'trends',
      'seller-deltas',
      'executive-summary-v2',
      'seller-ranking-v2',
      'sla-alerts-v2',
      'forecast-v2',
      'funnel-executive-v2'
    )
  );

ALTER TABLE dashboard_snapshot_fallback_logs
  DROP CONSTRAINT fallback_reason_check,
  ADD CONSTRAINT fallback_reason_check CHECK (
    reason IN (
      'missing_data',
      'api_error',
      'insufficient_points',
      'freshness_stale',
      'aggregate_failed',
      'cache_empty',
      'no_snapshot_data'
    )
  );
