-- =============================================================================
-- FASE 5.5.3 — Observabilidade mínima dos endpoints híbridos v2
--
-- Cria dashboard_endpoint_usage_logs para rastreabilidade persistente de:
--   volume de chamadas, status (ok/fallback/error), latência total e modo de
--   comparação de cada endpoint híbrido.
--
-- Escrito pelo backend via service_role (fire-and-forget).
-- Nunca acessado diretamente pelo frontend.
-- Retenção: 90 dias (pruning via cron existente).
-- =============================================================================

CREATE TABLE dashboard_endpoint_usage_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  endpoint    text        NOT NULL,
  status      text        NOT NULL,
  mode        text,
  duration_ms int,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- ── Constraints de domínio ────────────────────────────────────────────────────
ALTER TABLE dashboard_endpoint_usage_logs
  ADD CONSTRAINT usage_logs_endpoint_check CHECK (endpoint IN (
    'executive-summary-v2',
    'seller-ranking-v2',
    'sla-alerts-v2',
    'forecast-v2',
    'funnel-executive-v2'
  )),
  ADD CONSTRAINT usage_logs_status_check CHECK (
    status IN ('ok', 'fallback', 'error')
  );

-- ── Índices para consultas operacionais ───────────────────────────────────────
CREATE INDEX idx_usage_logs_occurred
  ON dashboard_endpoint_usage_logs (occurred_at DESC);

CREATE INDEX idx_usage_logs_endpoint_occurred
  ON dashboard_endpoint_usage_logs (endpoint, occurred_at DESC);

CREATE INDEX idx_usage_logs_company_occurred
  ON dashboard_endpoint_usage_logs (company_id, occurred_at DESC);
