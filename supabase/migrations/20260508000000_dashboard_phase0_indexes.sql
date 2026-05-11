-- =====================================================
-- Migration: Fase 0 — índices de performance para KPIs da dashboard
--
-- Cobre as três queries críticas que não tinham índice composto:
--   1. leads: KPI de novos leads no período (company_id + created_at + deleted_at)
--   2. chat_conversations: KPI de conversas no período (company_id + updated_at)
--   3. chat_conversations: lista ordenada por última mensagem (company_id + last_message_at)
--
-- Usa IF NOT EXISTS — idempotente.
-- Nota: CONCURRENTLY não é suportado dentro de transaction de migration.
-- Para rodar em produção com CONCURRENTLY (sem lock), use manualmente:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_created_at_active ...
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_conversations_company_updated_at ...
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_conversations_company_last_message ...
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_leads_company_created_at_active;
--   DROP INDEX IF EXISTS public.idx_chat_conversations_company_updated_at;
--   DROP INDEX IF EXISTS public.idx_chat_conversations_company_last_message;
-- =====================================================

-- 1. leads: KPI de novos leads no período excluindo deletados
--    Cobre: .eq(company_id).gte(created_at, start).lte(created_at, end).is(deleted_at, null)
CREATE INDEX IF NOT EXISTS idx_leads_company_created_at_active
  ON public.leads (company_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 2. chat_conversations: KPI de conversas no período (intervalo fechado)
--    Cobre: .eq(company_id).gte(updated_at, start).lte(updated_at, end)
CREATE INDEX IF NOT EXISTS idx_chat_conversations_company_updated_at
  ON public.chat_conversations (company_id, updated_at DESC);

-- 3. chat_conversations: lista ordenada por última mensagem
--    Cobre: .eq(company_id).order(last_message_at DESC NULLS LAST)
CREATE INDEX IF NOT EXISTS idx_chat_conversations_company_last_message
  ON public.chat_conversations (company_id, last_message_at DESC NULLS LAST);
