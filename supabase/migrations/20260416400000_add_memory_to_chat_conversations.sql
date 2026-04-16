-- =============================================================================
-- Migration: add_memory_to_chat_conversations
--
-- Adiciona a coluna memory JSONB à tabela chat_conversations para armazenar
-- a memória conversacional semântica do agente de IA.
--
-- DESIGN:
--   - JSONB sem limite fixo de tamanho (hard cap enforced no backend, ~8KB)
--   - DEFAULT '{}' garante backward compatibility — todas as linhas existentes
--     recebem um objeto vazio, nunca NULL
--   - Nenhuma RLS alterada — company_id já filtra a tabela
--   - Apenas o agentExecutor (via LLM) pode escrever nesta coluna
--     (controle feito pelo parâmetro source='llm_extraction' no backend)
--
-- ISOLAMENTO:
--   UPDATE sempre filtra por id + company_id — multi-tenant garantido.
-- =============================================================================

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS memory JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.chat_conversations.memory IS
  'Memória conversacional semântica do agente IA. '
  'Escrita exclusivamente pelo agentExecutor após processamento do LLM. '
  'Nunca escrita por webhooks, integrações ou APIs externas. '
  'Schema: { v, summary, facts, intents, objections, open_loops, conversation_stage, '
  'last_interaction_at, interaction_count, updated_at }';
