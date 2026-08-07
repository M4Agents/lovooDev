-- =====================================================================
-- MIGRATION: Índices de performance para get_agent_report
-- Data: 2026-08-07
--
-- Propósito:
--   Otimizar as queries do relatório do Agente de IA para volumes maiores.
--   Validado com EXPLAIN em DEV antes da criação.
--
-- EXPLAIN em DEV (2026-08-07):
--
--   agent_conversation_sessions → Seq Scan (cost=0.00..14.05 rows=1)
--     O índice parcial existente (idx_sessions_company_active WHERE status='active')
--     não cobre sessões históricas (completed, abandoned, paused).
--     A RPC get_agent_report consulta todos os status — índice full necessário.
--
--   agent_contact_schedules → Index Scan via idx_agent_contact_schedules_company
--     O índice existente em (company_id, status) é usado, mas processed_at é
--     aplicado como filtro pós-índice. A adição de processed_at ao índice
--     elimina esse filtro e melhora a eficiência a volume maior.
--
-- Ambos os índices são seguros: IF NOT EXISTS, sem DROP, sem lock prolongado.
-- =====================================================================

-- Índice 1: queries de relatório sobre agent_conversation_sessions
-- Cobre company_id + started_at sem restrição de status
-- Complementa (não substitui) o índice parcial idx_sessions_company_active
CREATE INDEX IF NOT EXISTS idx_sessions_company_started_all
  ON public.agent_conversation_sessions (company_id, started_at DESC);

-- Índice 2: follow-ups por período em agent_contact_schedules
-- Inclui processed_at para eliminar filtro pós-índice na query de follow-ups
-- status = 'sent' reduz o tamanho do índice (seletividade alta)
CREATE INDEX IF NOT EXISTS idx_agent_contact_schedules_sent_period
  ON public.agent_contact_schedules (company_id, processed_at DESC)
  WHERE status = 'sent';
