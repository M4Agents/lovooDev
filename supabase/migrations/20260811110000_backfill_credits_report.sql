-- =====================================================================
-- MIGRATION: Backfill de créditos históricos para relatório
-- Data: 2026-08-11
--
-- Propósito:
--   Recuperar dados de crédito em ai_agent_execution_logs e ai_usage_daily
--   para execuções whatsapp que não foram contabilizadas após 2026-08-02
--   devido a saldo insuficiente (debit_credits_atomic retornava ok=false
--   silenciosamente).
--
-- Escopo: apenas relatório
--   - Atualiza ai_agent_execution_logs.credits_used e feature_type
--   - Popula ai_usage_daily (fonte do relatório get_agent_report)
--   - NÃO altera company_credits nem credit_transactions
--
-- Fórmula idêntica ao billing real:
--   credits = CEIL(total_tokens / 1000.0 * 1.6 * 1)   (whatsapp multiplier = 1)
--
-- Idempotente:
--   A CTE usa RETURNING — se não há registros com credits_used IS NULL,
--   nenhuma linha é inserida em ai_usage_daily na segunda execução.
-- =====================================================================

WITH updated_logs AS (
  UPDATE public.ai_agent_execution_logs
  SET
    credits_used = CEIL(total_tokens / 1000.0 * 1.6),
    feature_type = 'whatsapp'
  WHERE
    credits_used    IS NULL
    AND status       = 'success'
    AND channel      = 'whatsapp'
    AND total_tokens IS NOT NULL
    AND total_tokens  > 0
    AND created_at   > '2026-08-02'
  RETURNING
    consumer_company_id,
    created_at,
    total_tokens,
    CEIL(total_tokens / 1000.0 * 1.6) AS computed_credits
),
daily_agg AS (
  SELECT
    consumer_company_id                                    AS company_id,
    (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE   AS agg_date,
    'whatsapp'::TEXT                                       AS feature_type,
    SUM(total_tokens)                                      AS total_tokens,
    SUM(computed_credits)                                  AS total_credits_used,
    COUNT(*)                                               AS executions_count
  FROM updated_logs
  GROUP BY
    consumer_company_id,
    (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE
)
INSERT INTO public.ai_usage_daily (
  company_id,
  date,
  feature_type,
  total_tokens,
  total_credits_used,
  executions_count
)
SELECT
  company_id,
  agg_date,
  feature_type,
  total_tokens,
  total_credits_used,
  executions_count
FROM daily_agg
ON CONFLICT (company_id, date, feature_type) DO UPDATE
  SET
    total_tokens       = ai_usage_daily.total_tokens       + EXCLUDED.total_tokens,
    total_credits_used = ai_usage_daily.total_credits_used + EXCLUDED.total_credits_used,
    executions_count   = ai_usage_daily.executions_count   + EXCLUDED.executions_count,
    updated_at         = now();
