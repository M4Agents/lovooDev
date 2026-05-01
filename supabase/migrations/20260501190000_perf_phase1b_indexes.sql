-- Fase 1-B: índices de performance para crons e automações
-- Verificados contra estado real do banco antes da criação.
-- idx_ae_timeout_paused e idx_lead_activities_notif_pending já existem com equivalentes.

-- 1. Dedup de disparo de automação (dispatchLeadCreatedTrigger, dispatchMessageReceivedTrigger, trigger-event)
--    Cobre: .eq(company_id).eq(flow_id).gte(started_at).eq(lead_id).limit(1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_company_flow_lead_started
  ON public.automation_executions (company_id, flow_id, started_at DESC, lead_id);

-- 2. Contagem mensal de execuções por empresa (executor.js - verificação de limite do plano)
--    Cobre: .select(count).eq(company_id).gte(started_at, monthStart)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_company_started
  ON public.automation_executions (company_id, started_at DESC);

-- 3. Cron process-schedules: filtro entity_type + scheduled_for para pendentes
--    Cobre: .eq(status,'pending').eq(entity_type,'delay_resume').lte(scheduled_for, now).order(scheduled_for).limit(20)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automation_schedules_cron
  ON public.automation_schedules (entity_type, scheduled_for)
  WHERE status = 'pending';
