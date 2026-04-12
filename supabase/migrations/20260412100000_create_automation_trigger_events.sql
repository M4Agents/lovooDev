-- =====================================================
-- Migration: create automation_trigger_events
--
-- Tabela de auditoria persistente para eventos de trigger
-- do pipeline de automações backend.
--
-- Registra: triggered | not_matched | duplicate | error
-- Retenção: 60 dias (limpa via cron process-timeouts)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.automation_trigger_events (
  id            uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid         NOT NULL,
  flow_id       uuid         NULL,
  execution_id  uuid         NULL,
  event_type    varchar(120) NOT NULL,
  status        varchar(30)  NOT NULL, -- triggered | not_matched | duplicate | error
  matched       boolean      NOT NULL DEFAULT false,
  reason        text         NULL,
  dedup_key     varchar(255) NULL,
  payload       jsonb        NOT NULL DEFAULT '{}',
  triggered_at  timestamptz  NOT NULL DEFAULT now()
);

-- Índice principal: consulta por empresa ordenada por data
CREATE INDEX IF NOT EXISTS idx_ate_company_triggered
  ON public.automation_trigger_events (company_id, triggered_at DESC);

-- Índice de suporte para filtragem por flow
CREATE INDEX IF NOT EXISTS idx_ate_flow_triggered
  ON public.automation_trigger_events (flow_id, triggered_at DESC)
  WHERE flow_id IS NOT NULL;

-- Índice para lookup de deduplication key (debug/análise)
CREATE INDEX IF NOT EXISTS idx_ate_dedup_key
  ON public.automation_trigger_events (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Índice de retenção: usado pelo DELETE de limpeza periódica
CREATE INDEX IF NOT EXISTS idx_ate_retention
  ON public.automation_trigger_events (triggered_at);
