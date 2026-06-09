-- =====================================================
-- Sprint 0.5 — Observabilidade e Maturidade de Tenants
-- Migration: atualiza get_snapshot_health_score
--
-- Alterações:
--   1. Adiciona dimensão "maturity" no retorno JSONB
--      - status: 'mature' (>= 30 dias de histórico) | 'new' (< 30 dias)
--      - days_of_history: dias de snapshots disponíveis
--      - threshold_days: 30 (constante)
--
--   2. Adiciona campo "classification" no retorno JSONB
--      - 'healthy'              → tenant maduro com health_score >= 85
--      - 'insufficient_history' → tenant novo (< 30 dias), independente do score
--      - 'degraded'             → tenant maduro com score entre 65 e 84
--      - 'critical'             → tenant maduro com score < 65
--
--   3. Para tenants 'insufficient_history':
--      - readiness_4_2.ready = false
--      - readiness_4_2.blocker = 'insufficient_history'
--      - severity reflete o score real (para monitoramento interno)
--
-- Motivação:
--   Empresa nova sem histórico NÃO é falha operacional.
--   Diferenciá-la evita que bloqueie a liberação da FASE 4.2
--   para tenants maduros e saudáveis.
--
-- Compatibilidade:
--   - Retorno é JSONB — campos novos não quebram consumers existentes
--   - health_score numérico mantido sem alteração
--   - severity mantido sem alteração
--   - readiness_4_2.ready continua false para insufficient_history
--     (comportamento conservador — tenant novo nunca é ready)
-- =====================================================

CREATE OR REPLACE FUNCTION get_snapshot_health_score(
  p_company_id    UUID,
  p_reference_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  -- Componentes do score (0.0–1.0)
  v_freshness_score  NUMERIC := 0.0;
  v_drift_score      NUMERIC := 0.8; -- benefício da dúvida se sem dados
  v_coverage_score   NUMERIC := 0.0;
  v_cron_score       NUMERIC := 0.8; -- benefício da dúvida se sem dados

  -- Score final e severidade
  v_health_score     NUMERIC;
  v_severity         TEXT;
  v_classification   TEXT;

  -- Freshness
  v_freshness_status TEXT    := 'missing';
  v_latest_date      DATE;
  v_days_since       INT;

  -- Drift
  v_drift_max        NUMERIC;
  v_drift_status     TEXT    := 'no_data';

  -- Coverage (últimos 30 dias)
  v_days_covered     INT     := 0;
  v_total_days       INT     := 30;
  v_coverage_raw     NUMERIC := 0.0;

  -- Cron (últimos 7 dias)
  v_jobs_total       INT     := 0;
  v_jobs_ok          INT     := 0;
  v_cron_rate        NUMERIC := 0.0;

  -- Maturidade do tenant
  v_days_of_history  INT     := 0;
  v_maturity_status  TEXT    := 'new';
  v_maturity_days    CONSTANT INT := 30;

  -- Readiness blocker
  v_blocker          TEXT;
BEGIN
  -- ── 1. FRESHNESS SCORE ────────────────────────────────────────────────────
  -- Último snapshot company-wide (funnel_id IS NULL)
  SELECT MAX(period_start) INTO v_latest_date
  FROM dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL;

  IF v_latest_date IS NULL THEN
    v_freshness_score  := 0.0;
    v_freshness_status := 'missing';
    v_days_since       := NULL;
  ELSE
    v_days_since := (p_reference_date - v_latest_date);

    IF v_days_since <= 1 THEN
      -- D-1 presente (snapshot de ontem para referência = hoje)
      v_freshness_score  := 1.0;
      v_freshness_status := 'fresh';
    ELSIF v_days_since <= 2 THEN
      -- D-2 é o mais recente
      v_freshness_score  := 0.7;
      v_freshness_status := 'delayed';
    ELSIF v_days_since <= 3 THEN
      -- D-3 é o mais recente
      v_freshness_score  := 0.3;
      v_freshness_status := 'stale';
    ELSE
      -- Mais de 3 dias sem snapshot
      v_freshness_score  := 0.0;
      v_freshness_status := 'missing';
    END IF;
  END IF;

  -- ── 2. DRIFT SCORE ────────────────────────────────────────────────────────
  -- Última verificação de drift para este tenant
  SELECT max_drift_pct, status
    INTO v_drift_max, v_drift_status
  FROM dashboard_snapshot_drift_logs
  WHERE company_id = p_company_id
  ORDER BY checked_at DESC
  LIMIT 1;

  IF v_drift_max IS NULL THEN
    -- Sem dados de drift ainda: benefício da dúvida
    v_drift_score  := 0.8;
    v_drift_status := 'no_data';
  ELSIF v_drift_max < 2.0 THEN
    v_drift_score := 1.0;
  ELSIF v_drift_max < 5.0 THEN
    v_drift_score := 0.7;
  ELSIF v_drift_max < 10.0 THEN
    v_drift_score := 0.3;
  ELSE
    v_drift_score := 0.0;
  END IF;

  -- ── 3. COVERAGE SCORE (últimos 30 dias) ─────────────────────────────────
  SELECT COUNT(DISTINCT period_start)
    INTO v_days_covered
  FROM dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL
    AND period_start >= (p_reference_date - INTERVAL '30 days')
    AND period_start <  p_reference_date;

  v_coverage_raw := COALESCE(v_days_covered, 0)::NUMERIC / v_total_days::NUMERIC;

  IF v_coverage_raw >= 0.95 THEN
    v_coverage_score := 1.0;
  ELSIF v_coverage_raw >= 0.85 THEN
    v_coverage_score := 0.7;
  ELSIF v_coverage_raw >= 0.70 THEN
    v_coverage_score := 0.3;
  ELSE
    v_coverage_score := 0.0;
  END IF;

  -- ── 4. CRON SCORE (últimas 7 execuções de cron) ──────────────────────────
  SELECT
    COUNT(*)                                                AS total,
    COUNT(*) FILTER (WHERE status = 'completed')            AS ok_count
  INTO v_jobs_total, v_jobs_ok
  FROM dashboard_snapshot_cron_runs
  WHERE run_date >= (p_reference_date - INTERVAL '7 days')
    AND run_date <  p_reference_date;

  IF v_jobs_total = 0 THEN
    -- Sem execuções registradas: benefício da dúvida (tabela pode ser nova)
    v_cron_score := 0.8;
    v_cron_rate  := NULL;
  ELSE
    v_cron_rate := v_jobs_ok::NUMERIC / v_jobs_total::NUMERIC;
    IF v_cron_rate >= 0.98 THEN
      v_cron_score := 1.0;
    ELSIF v_cron_rate >= 0.90 THEN
      v_cron_score := 0.7;
    ELSIF v_cron_rate >= 0.80 THEN
      v_cron_score := 0.3;
    ELSE
      v_cron_score := 0.0;
    END IF;
  END IF;

  -- ── 5. SCORE FINAL ────────────────────────────────────────────────────────
  v_health_score := ROUND(
    (v_freshness_score * 0.35 +
     v_drift_score     * 0.30 +
     v_coverage_score  * 0.20 +
     v_cron_score      * 0.15) * 100.0,
  1);

  -- ── 6. SEVERIDADE ─────────────────────────────────────────────────────────
  IF    v_health_score >= 85 THEN v_severity := 'healthy';
  ELSIF v_health_score >= 65 THEN v_severity := 'degraded';
  ELSIF v_health_score >= 40 THEN v_severity := 'warning';
  ELSE                             v_severity := 'critical';
  END IF;

  -- ── 7. MATURIDADE DO TENANT ───────────────────────────────────────────────
  -- Quantos dias distintos de snapshots existem (janela histórica total).
  -- Considera todo o histórico disponível, não apenas os últimos 30 dias.
  SELECT COUNT(DISTINCT period_start)
    INTO v_days_of_history
  FROM dashboard_snapshots
  WHERE company_id = p_company_id
    AND funnel_id IS NULL
    AND period_start < p_reference_date;

  v_maturity_status := CASE
    WHEN v_days_of_history >= v_maturity_days THEN 'mature'
    ELSE 'new'
  END;

  -- ── 8. CLASSIFICAÇÃO CONSOLIDADA ─────────────────────────────────────────
  -- Empresa nova sempre é 'insufficient_history', independente do score.
  -- Empresa madura: classificação segue o health_score.
  IF v_maturity_status = 'new' THEN
    v_classification := 'insufficient_history';
  ELSIF v_health_score >= 85 THEN
    v_classification := 'healthy';
  ELSIF v_health_score >= 65 THEN
    v_classification := 'degraded';
  ELSE
    v_classification := 'critical';
  END IF;

  -- ── 9. BLOCKER (o componente mais fraco que impede FASE 4.2) ─────────────
  IF v_classification = 'insufficient_history' THEN
    v_blocker := 'insufficient_history';
  ELSIF v_classification = 'healthy' THEN
    v_blocker := NULL;
  ELSE
    -- Tenant maduro com problema: identificar o componente mais fraco
    IF    v_freshness_score < 0.7 THEN v_blocker := 'freshness';
    ELSIF v_drift_score     < 0.7 THEN v_blocker := 'drift';
    ELSIF v_coverage_score  < 0.7 THEN v_blocker := 'coverage';
    ELSIF v_cron_score      < 0.7 THEN v_blocker := 'cron_reliability';
    ELSE                                v_blocker := 'composite_score';
    END IF;
  END IF;

  -- ── 10. RETORNO ───────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'company_id',      p_company_id,
    'reference_date',  p_reference_date,
    'health_score',    v_health_score,
    'severity',        v_severity,
    'classification',  v_classification,
    'maturity', jsonb_build_object(
      'status',        v_maturity_status,
      'days_of_history', v_days_of_history,
      'threshold_days',  v_maturity_days
    ),
    'components', jsonb_build_object(
      'freshness', jsonb_build_object(
        'score',        v_freshness_score,
        'status',       v_freshness_status,
        'latest_date',  v_latest_date,
        'days_since',   v_days_since
      ),
      'drift', jsonb_build_object(
        'score',         v_drift_score,
        'status',        v_drift_status,
        'max_drift_pct', v_drift_max
      ),
      'coverage', jsonb_build_object(
        'score',        v_coverage_score,
        'days_covered', v_days_covered,
        'total_days',   v_total_days,
        'coverage_pct', ROUND(v_coverage_raw * 100, 1)
      ),
      'cron', jsonb_build_object(
        'score',       v_cron_score,
        'jobs_ok',     v_jobs_ok,
        'jobs_total',  v_jobs_total,
        'success_rate', CASE
          WHEN v_jobs_total > 0 THEN ROUND(v_cron_rate * 100, 1)
          ELSE NULL
        END
      )
    ),
    'readiness_4_2', jsonb_build_object(
      'ready',   (v_classification = 'healthy'),
      'blocker', v_blocker
    )
  );
END;
$$;

-- Permissões: apenas service_role via SECURITY DEFINER
-- authenticated pode chamar via endpoint snapshot-health (que usa service_role)
REVOKE ALL ON FUNCTION get_snapshot_health_score(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_snapshot_health_score(UUID, DATE) TO service_role;
