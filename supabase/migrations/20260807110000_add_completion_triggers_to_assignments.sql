-- =====================================================================
-- MIGRATION: completion_triggers em company_agent_assignments
-- Data: 2026-08-07
--
-- Propósito:
--   Cada assignment pode definir quais end_reason de sessão contam como
--   "atendimento concluído" para fins do relatório do Agente de IA.
--
-- Exemplos de configuração:
--   ['human_handoff']              → IC Campo Limpo: transferência = sucesso
--   ['lead_qualified']             → apenas qualificação sem humano = sucesso
--   ['human_handoff','lead_qualified'] → qualquer desfecho positivo = sucesso
--   []                             → padrão: nenhuma conclusão automática
--
-- Valores válidos de end_reason (documentados em agent_conversation_sessions):
--   human_handoff, lead_qualified, timeout, max_messages, error, conversation_closed
--
-- Segurança:
--   - Não altera RLS existente
--   - DEFAULT '{}' garante compatibilidade retroativa
--   - Nenhum dado existente é modificado
-- =====================================================================

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS completion_triggers TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.company_agent_assignments.completion_triggers IS
'Valores de end_reason em agent_conversation_sessions que contam como atendimento concluído.
Exemplos: ''{human_handoff}'' (IC Campo Limpo), ''{lead_qualified}'', ''{}''.
Usado pela RPC get_agent_report para calcular completed_sessions e completion_rate.';
