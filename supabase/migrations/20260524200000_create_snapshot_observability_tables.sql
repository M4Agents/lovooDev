-- =====================================================
-- FASE 4.1.5 — Hardening e Observabilidade
-- Migration 1/2: Tabelas operacionais de observabilidade
--
-- Tabelas criadas:
--   dashboard_snapshot_cron_runs     — registro de execuções do cron (1 linha/rodada global)
--   dashboard_snapshot_drift_logs    — histórico de drift por tenant (amostragem automática)
--   dashboard_snapshot_fallback_logs — rastreamento de fallbacks silenciosos do frontend
--
-- IMPORTANTE:
--   Estas são tabelas OPERACIONAIS (logs), não históricas.
--   Têm retenção definida e são purgadas pelo cron.
--   NÃO contêm dados de negócio — apenas metadados de observabilidade.
--   Sem PII.
--
-- Tabelas históricas (dashboard_snapshots, dashboard_seller_snapshots,
-- dashboard_funnel_stage_snapshots) NÃO são alteradas — retenção indefinida.
-- =====================================================

-- =====================================================
-- 1. dashboard_snapshot_cron_runs
--    Uma linha por execução do cron (registro global, não por empresa).
--    Retenção: 365 dias.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshot_cron_runs (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date         DATE    NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  status           TEXT    NOT NULL DEFAULT 'running',
  -- 'running' | 'completed' | 'partial' | 'failed'

  total_companies  INT     NOT NULL DEFAULT 0,
  processed_count  INT     NOT NULL DEFAULT 0,
  failed_count     INT     NOT NULL DEFAULT 0,
  timeout_hit      BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms      INT,

  -- Drift check automático: quantas empresas foram verificadas nesta rodada
  drift_checked    INT     NOT NULL DEFAULT 0,
  drift_alerts     INT     NOT NULL DEFAULT 0,  -- empresas com max_drift_pct > 5%

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cron_runs_status_check CHECK (
    status IN ('running', 'completed', 'partial', 'failed')
  )
);

-- Índice para queries de monitoramento (últimas N execuções)
CREATE INDEX IF NOT EXISTS idx_snapshot_cron_runs_run_date
  ON dashboard_snapshot_cron_runs (run_date DESC);

-- Unique: apenas uma execução completa por dia (permite múltiplas 'running')
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_cron_runs_completed_per_day
  ON dashboard_snapshot_cron_runs (run_date)
  WHERE status = 'completed';

-- RLS — tabela de uso exclusivo do backend (service_role)
ALTER TABLE dashboard_snapshot_cron_runs ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy de usuário: service_role bypassa RLS. Usuários não acessam diretamente.


-- =====================================================
-- 2. dashboard_snapshot_drift_logs
--    Resultado do drift check automático por tenant por data.
--    Retenção: 180 dias.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshot_drift_logs (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_date      DATE    NOT NULL,       -- data do snapshot verificado
  max_drift_pct   NUMERIC(6,2) NOT NULL,  -- maior desvio percentual encontrado
  drift_count     INT     NOT NULL DEFAULT 0, -- número de métricas fora do threshold
  metrics_json    JSONB   NOT NULL DEFAULT '{}',
  -- { "pipeline_total": {"snap": 100, "rt": 102, "pct": 2.0}, ... }
  status          TEXT    NOT NULL,
  -- 'ok' (< 2%) | 'warning' (2-5%) | 'critical' (> 5%)

  CONSTRAINT drift_logs_status_check CHECK (
    status IN ('ok', 'warning', 'critical')
  )
);

-- Índices para queries de health score e monitoramento
CREATE INDEX IF NOT EXISTS idx_snapshot_drift_logs_company_date
  ON dashboard_snapshot_drift_logs (company_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_drift_logs_status
  ON dashboard_snapshot_drift_logs (status, checked_at DESC);

-- RLS
ALTER TABLE dashboard_snapshot_drift_logs ENABLE ROW LEVEL SECURITY;

-- Leitura para membros da empresa (usado pelo endpoint snapshot-health)
CREATE POLICY "drift_logs_select_members"
  ON dashboard_snapshot_drift_logs
  FOR SELECT
  USING (
    auth_user_is_company_member(company_id)
  );

-- INSERT/UPDATE/DELETE apenas via service_role (cron e jobs internos)


-- =====================================================
-- 3. dashboard_snapshot_fallback_logs
--    Rastreamento de fallbacks silenciosos do frontend.
--    Retenção: 30 dias.
--    Sem PII — apenas company_id, endpoint e reason.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshot_fallback_logs (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  endpoint    TEXT    NOT NULL,
  -- 'comparison' | 'trends' | 'seller-deltas'
  reason      TEXT    NOT NULL,
  -- 'missing_data' | 'api_error' | 'insufficient_points' | 'freshness_stale'
  mode        TEXT,   -- 'wow' | 'mom' | null (não obrigatório)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fallback_endpoint_check CHECK (
    endpoint IN ('comparison', 'trends', 'seller-deltas')
  ),
  CONSTRAINT fallback_reason_check CHECK (
    reason IN ('missing_data', 'api_error', 'insufficient_points', 'freshness_stale')
  )
);

-- Índices para queries de degradação (fallback rate por empresa)
CREATE INDEX IF NOT EXISTS idx_snapshot_fallback_logs_company_time
  ON dashboard_snapshot_fallback_logs (company_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_fallback_logs_endpoint_time
  ON dashboard_snapshot_fallback_logs (endpoint, occurred_at DESC);

-- RLS
ALTER TABLE dashboard_snapshot_fallback_logs ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy de usuário: inserções e leituras via service_role (endpoint backend)
-- Fallback tracking é dado operacional interno, não exposto ao usuário.


-- =====================================================
-- Grants (Supabase service_role já tem acesso implícito)
-- Necessário para que a anon/authenticated key NÃO acesse diretamente
-- =====================================================
REVOKE ALL ON dashboard_snapshot_cron_runs     FROM anon, authenticated;
REVOKE ALL ON dashboard_snapshot_drift_logs    FROM anon;
REVOKE ALL ON dashboard_snapshot_fallback_logs FROM anon, authenticated;

-- authenticated pode ler drift_logs via policy acima (select_members)
GRANT SELECT ON dashboard_snapshot_drift_logs TO authenticated;
