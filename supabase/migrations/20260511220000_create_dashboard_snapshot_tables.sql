-- =====================================================
-- FASE 4.0 — Snapshot Executivo Histórico
-- Migration 1/3: Tabelas de snapshot + índices + RLS
--
-- Tabelas criadas:
--   dashboard_snapshots              — métricas diárias company+funil
--   dashboard_funnel_stage_snapshots — métricas por etapa (relacional, analytics)
--   dashboard_seller_snapshots       — métricas brutas por vendedor (sem score)
--   dashboard_snapshot_jobs          — log de execução do cron (TTL 90 dias)
--   dashboard_snapshot_backfills     — checkpoint persistente de backfill
--
-- Convenção OBRIGATÓRIA:
--   FLOW METRICS  → agregar com SUM ao consolidar semana/mês
--   STATE METRICS → usar LAST_VALUE (último snapshot do período); NUNCA somar
--
-- Shadow mode: estas tabelas NÃO são lidas pelo dashboard ainda.
-- Realtime continua sendo source of truth operacional.
-- =====================================================

-- =====================================================
-- 1. dashboard_snapshots
--    Métricas diárias por empresa (e opcionalmente por funil).
--    funnel_id NULL → visão company-wide (SLA, leads, conversas).
--    funnel_id NOT NULL → pipeline/forecast do funil específico.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  funnel_id  UUID REFERENCES sales_funnels(id) ON DELETE SET NULL,
  -- NULL = company-wide; NOT NULL = funil específico

  period_start DATE NOT NULL,
  period_end   DATE NOT NULL, -- = period_start para granularidade daily

  -- =========================================================
  -- FLOW METRICS — agregar com SUM ao consolidar semana/mês
  -- Representam EVENTOS ocorridos no dia.
  -- =========================================================
  leads_created          INT           NOT NULL DEFAULT 0,
  conversations_started  INT           NOT NULL DEFAULT 0,
  conversations_attended INT           NOT NULL DEFAULT 0,
  won_count              INT           NOT NULL DEFAULT 0,
  lost_count             INT           NOT NULL DEFAULT 0,
  won_value              NUMERIC(15,2) NOT NULL DEFAULT 0,
  lost_value             NUMERIC(15,2) NOT NULL DEFAULT 0,
  sla_breached_count     INT           NOT NULL DEFAULT 0,

  -- =========================================================
  -- STATE METRICS — usar LAST_VALUE (último dia do período)
  -- Representam o ESTADO atual do pipeline ao final do dia.
  -- NUNCA somar ao agregar — usar o valor do dia mais recente.
  -- =========================================================
  pipeline_total        NUMERIC(15,2) NOT NULL DEFAULT 0,
  pipeline_weighted     NUMERIC(15,2) NOT NULL DEFAULT 0,
  pipeline_risk         NUMERIC(15,2) NOT NULL DEFAULT 0,
  open_count            INT           NOT NULL DEFAULT 0,
  stalled_count         INT           NOT NULL DEFAULT 0,
  hot_count             INT           NOT NULL DEFAULT 0, -- prob >= 70
  avg_response_minutes  NUMERIC(10,2) NOT NULL DEFAULT 0,
  conversion_rate       NUMERIC(5,2)  NOT NULL DEFAULT 0,

  -- =========================================================
  -- FORECAST BUCKETS — STATE (LAST_VALUE; NUNCA somar)
  -- Distribuição do pipeline aberto por faixa de probabilidade.
  -- Base para forecast probabilístico e detecção de deterioração.
  -- =========================================================
  prob_0_20_value   NUMERIC(15,2) NOT NULL DEFAULT 0,
  prob_21_40_value  NUMERIC(15,2) NOT NULL DEFAULT 0,
  prob_41_60_value  NUMERIC(15,2) NOT NULL DEFAULT 0,
  prob_61_80_value  NUMERIC(15,2) NOT NULL DEFAULT 0,
  prob_81_100_value NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- =========================================================
  -- CACHE DE LEITURA — apenas conveniência para o frontend.
  -- Reconstruído a cada snapshot.
  -- NÃO usar para analytics — use dashboard_funnel_stage_snapshots.
  -- =========================================================
  funnel_stages_cache JSONB,

  -- Controle de versão da fórmula analítica.
  -- Incrementar quando a lógica de cálculo mudar (para reprocessamento seletivo).
  snapshot_version SMALLINT NOT NULL DEFAULT 1,

  snapshot_taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_dashboard_snapshots UNIQUE (company_id, funnel_id, period_start),
  CONSTRAINT ck_dashboard_snapshots_period CHECK (period_end >= period_start)
);

-- =====================================================
-- 2. dashboard_funnel_stage_snapshots
--    Fonte de verdade RELACIONAL para analytics por etapa.
--    Usada para: regressão histórica por estágio, detecção
--    de gargalo, comparação de distribuição entre períodos.
--    Todas as colunas são STATE METRICS — LAST_VALUE ao agregar.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_funnel_stage_snapshots (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  funnel_id  UUID NOT NULL REFERENCES sales_funnels(id) ON DELETE CASCADE,
  stage_id   UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,

  -- =========================================================
  -- STATE METRICS — LAST_VALUE ao agregar períodos; NUNCA somar
  -- =========================================================
  opp_count      INT           NOT NULL DEFAULT 0,
  total_value    NUMERIC(15,2) NOT NULL DEFAULT 0,
  weighted_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  stalled_count  INT           NOT NULL DEFAULT 0,
  avg_days       NUMERIC(8,2)  NOT NULL DEFAULT 0,

  snapshot_version  SMALLINT    NOT NULL DEFAULT 1,
  snapshot_taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_funnel_stage_snapshots UNIQUE (company_id, funnel_id, stage_id, period_start)
);

-- =====================================================
-- 3. dashboard_seller_snapshots
--    Métricas brutas diárias por vendedor.
--    NOTA: `score` NÃO é persistido.
--    Motivo: o algoritmo de score evoluirá — persistir
--    o score final congelaria o cálculo no tempo e exigiria
--    backfill total a cada ajuste de fórmula.
--    O score é calculado dinamicamente na API a partir
--    das métricas brutas abaixo.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_seller_snapshots (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,

  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,

  -- =========================================================
  -- FLOW METRICS — agregar com SUM ao consolidar semana/mês
  -- =========================================================
  leads_received   INT           NOT NULL DEFAULT 0,
  leads_attended   INT           NOT NULL DEFAULT 0,
  opps_generated   INT           NOT NULL DEFAULT 0,
  opps_won         INT           NOT NULL DEFAULT 0,
  won_value        NUMERIC(15,2) NOT NULL DEFAULT 0,
  sla_missed_count INT           NOT NULL DEFAULT 0,

  -- =========================================================
  -- STATE METRICS — LAST_VALUE ao agregar; NUNCA somar
  -- =========================================================
  attendance_rate  NUMERIC(5,2)  NOT NULL DEFAULT 0,
  avg_response_min NUMERIC(10,2) NOT NULL DEFAULT 0,
  conversion_rate  NUMERIC(5,2)  NOT NULL DEFAULT 0,

  snapshot_version  SMALLINT    NOT NULL DEFAULT 1,
  snapshot_taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_seller_snapshots UNIQUE (company_id, user_id, period_start)
);

-- =====================================================
-- 4. dashboard_snapshot_jobs
--    Log leve de execução do cron.
--    TTL: 90 dias — limpo automaticamente no início do cron.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshot_jobs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_date        DATE        NOT NULL,
  company_id      UUID        REFERENCES companies(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  dates_processed TEXT[],     -- datas processadas: ex. ['2026-05-10', '2026-05-09', '2026-05-08']
  error_msg       TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 5. dashboard_snapshot_backfills
--    Checkpoint persistente para backfill.
--    Permite retomar após timeout sem reiniciar do zero.
-- =====================================================
CREATE TABLE IF NOT EXISTS dashboard_snapshot_backfills (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'completed', 'failed', 'paused')),
  from_date          DATE     NOT NULL,
  to_date            DATE     NOT NULL,
  last_processed_date DATE,         -- última data processada com sucesso
  total_company_days INT,          -- estimativa: (to_date - from_date + 1) × count(empresas)
  processed_count    INT      NOT NULL DEFAULT 0,
  failed_count       INT      NOT NULL DEFAULT 0,
  company_ids        UUID[],       -- NULL = todas as empresas ativas
  error_last         TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- ÍNDICES
-- =====================================================

-- dashboard_snapshots: lookup primário e comparação de períodos
CREATE INDEX IF NOT EXISTS idx_dash_snap_company_date
  ON dashboard_snapshots (company_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_dash_snap_company_funnel_date
  ON dashboard_snapshots (company_id, funnel_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_dash_snap_company_funnel_null_date
  ON dashboard_snapshots (company_id, period_start DESC)
  WHERE funnel_id IS NULL;

-- dashboard_funnel_stage_snapshots: analytics por etapa
CREATE INDEX IF NOT EXISTS idx_dash_stage_snap_company_funnel_date
  ON dashboard_funnel_stage_snapshots (company_id, funnel_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_dash_stage_snap_stage_date
  ON dashboard_funnel_stage_snapshots (company_id, stage_id, period_start DESC);

-- dashboard_seller_snapshots: histórico por vendedor
CREATE INDEX IF NOT EXISTS idx_dash_seller_snap_company_date
  ON dashboard_seller_snapshots (company_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_dash_seller_snap_user_date
  ON dashboard_seller_snapshots (company_id, user_id, period_start DESC);

-- dashboard_snapshot_jobs: lookup por data + status
CREATE INDEX IF NOT EXISTS idx_dash_snap_jobs_date_status
  ON dashboard_snapshot_jobs (job_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_dash_snap_jobs_company_date
  ON dashboard_snapshot_jobs (company_id, job_date DESC);

-- dashboard_snapshot_backfills: backfills ativos/recentes
CREATE INDEX IF NOT EXISTS idx_dash_snap_backfills_status
  ON dashboard_snapshot_backfills (status, created_at DESC);

-- =====================================================
-- RLS — Row Level Security
--
-- Tabelas de snapshot são lidas via RPCs SECURITY DEFINER
-- (backfill, geração, comparação) — não expostas ao frontend.
-- RLS restritivo garante que nenhuma leitura direta seja possível
-- mesmo se uma chave anon vazar.
-- =====================================================
ALTER TABLE dashboard_snapshots              ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_funnel_stage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_seller_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_snapshot_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_snapshot_backfills     ENABLE ROW LEVEL SECURITY;

-- Leitura autenticada: apenas a própria empresa
CREATE POLICY "snap_select_own_company"
  ON dashboard_snapshots FOR SELECT
  USING (auth_user_is_company_member(company_id));

CREATE POLICY "stage_snap_select_own_company"
  ON dashboard_funnel_stage_snapshots FOR SELECT
  USING (auth_user_is_company_member(company_id));

CREATE POLICY "seller_snap_select_own_company"
  ON dashboard_seller_snapshots FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- Jobs e backfills: apenas admins de plataforma
CREATE POLICY "snap_jobs_platform_admin"
  ON dashboard_snapshot_jobs FOR SELECT
  USING (auth_user_is_platform_admin());

CREATE POLICY "snap_backfills_platform_admin"
  ON dashboard_snapshot_backfills FOR ALL
  USING (auth_user_is_platform_admin());

-- INSERT/UPDATE/DELETE: proibido via RLS para usuários autenticados
-- (feito exclusivamente por RPCs SECURITY DEFINER via service_role)
CREATE POLICY "snap_no_direct_write"
  ON dashboard_snapshots FOR INSERT
  WITH CHECK (false);

CREATE POLICY "snap_no_direct_update"
  ON dashboard_snapshots FOR UPDATE
  USING (false);

CREATE POLICY "stage_snap_no_direct_write"
  ON dashboard_funnel_stage_snapshots FOR INSERT
  WITH CHECK (false);

CREATE POLICY "seller_snap_no_direct_write"
  ON dashboard_seller_snapshots FOR INSERT
  WITH CHECK (false);

CREATE POLICY "snap_jobs_no_direct_write"
  ON dashboard_snapshot_jobs FOR INSERT
  WITH CHECK (false);

-- GRANT de leitura para authenticated (leitura via RLS acima)
GRANT SELECT ON dashboard_snapshots              TO authenticated;
GRANT SELECT ON dashboard_funnel_stage_snapshots TO authenticated;
GRANT SELECT ON dashboard_seller_snapshots       TO authenticated;
