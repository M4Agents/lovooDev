-- =====================================================
-- MIGRATION: Índices para Dashboard de Ativação Comercial
-- Data: 20/05/2026
--
-- Índices que suportam a RPC get_dashboard_activation:
--   • Prospecção: conv_first_msg (qualquer outbound no período)
--   • Resgate: rescue_candidates (qualquer outbound por lead no período)
--   • Filtro de vendedor: assigned_to com prefixo company_id
--
-- Índices já existentes e reutilizados (não criados novamente):
--   idx_chat_messages_conv_inbound         → inbound por conversa (Fase 1)
--   idx_chat_messages_conv_human_outbound  → outbound humano (Fase 1)
--   idx_chat_conversations_lead_id         → (lead_id, company_id)
--   idx_chat_conversations_assigned_to     → (assigned_to) — sem company_id, não ideal
--
-- NOTA: CONCURRENTLY não é suportado em transações de migration.
--       Todos os índices usam CREATE INDEX IF NOT EXISTS (seguro para re-run).
-- =====================================================

-- ── 1. Qualquer outbound por conversa (inclui IA e automação) ─────────────────
-- Suporta CTE conv_first_msg (prospecção) e rescue_candidates (resgate).
-- Os índices existentes (conv_human_outbound, company_outbound_human) têm
-- filtro is_ai_generated = false e portanto não cobrem IA/automação.
-- Este índice cobre TODOS os outbounds para a detecção correta de origem.
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_any_outbound
  ON public.chat_messages (company_id, conversation_id, created_at ASC)
  WHERE direction = 'outbound';

-- ── 2. Filtro de vendedor em conversas com company_id como prefixo ────────────
-- O índice existente (idx_chat_conversations_assigned_to) só tem (assigned_to)
-- sem company_id. Para queries filtradas por empresa + assigned_to, o planner
-- precisa fazer filter adicional. Este índice elimina esse custo.
CREATE INDEX IF NOT EXISTS idx_chat_conversations_company_assigned
  ON public.chat_conversations (company_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
