-- =====================================================
-- MIGRATION: Índices para Dashboard de Tendências — Fase 1
-- Data: 08/05/2026
--
-- Nota: sem CONCURRENTLY — não suportado em transações de migration.
-- Para produção com carga, aplicar manualmente com CONCURRENTLY.
-- =====================================================

-- ── 1. Filtro de leads por vendedor ──────────────────────────────────────────
-- Usado em get_dashboard_trends: leads por dia com p_user_id opcional.
-- Complementa idx_leads_company_created_at_active (Fase 0) adicionando
-- o eixo responsible_user_id para filtros por vendedor.
CREATE INDEX IF NOT EXISTS idx_leads_company_user_created
  ON public.leads (company_id, responsible_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── 2. Primeira mensagem humana outbound por conversa ─────────────────────────
-- Usado na CTE first_human_response: busca a menor created_at outbound
-- humano (direction = 'outbound' AND is_ai_generated = false) por conversa.
-- Parcial: exclui mensagens de IA do índice (footprint mínimo).
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_human_outbound
  ON public.chat_messages (company_id, conversation_id, created_at ASC)
  WHERE direction = 'outbound' AND is_ai_generated = false;

-- ── 3. Primeira mensagem inbound por conversa ─────────────────────────────────
-- Usado na CTE first_inbound: busca a menor created_at inbound por conversa.
-- Parcial: apenas mensagens inbound.
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_inbound
  ON public.chat_messages (company_id, conversation_id, created_at ASC)
  WHERE direction = 'inbound';
