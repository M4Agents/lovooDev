-- =====================================================
-- MIGRATION: Índices Dashboard Fase 2 — Gestão Comercial
-- Data: 09/05/2026
--
-- Índices para suportar as queries de:
--   - get_dashboard_seller_ranking  (opps, leads por seller)
--   - get_dashboard_sla_alerts      (last inbound, has_response)
--   - get_dashboard_lead_origins    (leads por origin)
--
-- NOTA: CONCURRENTLY não é suportado em transações de migration.
--       Todos os índices usam CREATE INDEX IF NOT EXISTS.
-- =====================================================

-- Oportunidades por lead (JOIN leads → opportunities)
CREATE INDEX IF NOT EXISTS idx_opportunities_lead_id_status_dates
  ON public.opportunities (lead_id, status, created_at, closed_at);

-- Leads por origin (para get_dashboard_lead_origins)
CREATE INDEX IF NOT EXISTS idx_leads_company_origin_created
  ON public.leads (company_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Mensagens inbound por empresa + conversa (SLA alerts + first_inbound)
-- Complementa o índice de Fase 1 (idx_chat_messages_conv_inbound)
CREATE INDEX IF NOT EXISTS idx_chat_messages_company_inbound_created
  ON public.chat_messages (company_id, conversation_id, created_at DESC)
  WHERE direction = 'inbound';

-- Mensagens outbound humanas por empresa + conversa (has_response)
-- Complementa o índice de Fase 1 (idx_chat_messages_conv_human_outbound)
CREATE INDEX IF NOT EXISTS idx_chat_messages_company_outbound_human
  ON public.chat_messages (company_id, conversation_id, created_at ASC)
  WHERE direction = 'outbound' AND is_ai_generated = false;
