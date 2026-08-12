-- Adiciona coluna history_mode à tabela company_agent_assignments.
-- Controla o modo de fornecimento de histórico ao LLM por assignment.
--
-- mem_block  (padrão): histórico textual injetado no system prompt (comportamento atual).
-- multi_turn          : mensagens reais user/assistant enviadas à API OpenAI como turns.
--
-- Coberto pelas RLS policies existentes da tabela (SELECT por membro, INSERT/UPDATE por admin+).
-- Não altera nenhuma policy existente.
--
-- DÍVIDA TÉCNICA V1: em multi_turn, o histórico representa apenas o transcript lead↔IA.
-- Mensagens humanas outbound (is_ai_generated = false) são excluídas desta V1.

ALTER TABLE public.company_agent_assignments
  ADD COLUMN IF NOT EXISTS history_mode TEXT NOT NULL DEFAULT 'mem_block'
    CHECK (history_mode IN ('mem_block', 'multi_turn'));

COMMENT ON COLUMN public.company_agent_assignments.history_mode IS
  'Modo de fornecimento de histórico ao LLM: '
  'mem_block (padrão) injeta histórico textual no system prompt; '
  'multi_turn passa turns reais user/assistant para a API OpenAI. '
  'V1: multi_turn representa apenas o transcript lead↔IA (mensagens humanas excluídas — dívida técnica).';
