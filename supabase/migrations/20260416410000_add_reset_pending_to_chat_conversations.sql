-- =============================================================================
-- Migration: add_reset_pending_to_chat_conversations
--
-- Adiciona a coluna reset_pending BOOLEAN à tabela chat_conversations para
-- suportar o fluxo de reset em 2 etapas (/resetar + /confirmar_reset).
--
-- DESIGN:
--   - BOOLEAN NOT NULL DEFAULT false — nunca nulo, backward compatible
--   - Nenhuma RLS alterada — company_id já filtra a tabela
--   - Escrita exclusivamente pelo webhook (comando de sistema)
--   - A expiração do pending é verificada via updated_at no backend (10 min)
--
-- FLUXO:
--   /resetar         → SET reset_pending = true, updated_at = NOW()
--   /confirmar_reset → verifica reset_pending + expiração → executa reset
--                      → SET reset_pending = false, memory = '{}'
--
-- ISOLAMENTO:
--   Todo UPDATE filtra por id + company_id — multi-tenant garantido.
-- =============================================================================

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS reset_pending BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.chat_conversations.reset_pending IS
  'Indicador de reset pendente de confirmação. '
  'Setado como true pelo comando /resetar (webhook). '
  'Limpo para false após /confirmar_reset ou expiração (10 min via updated_at). '
  'Nunca escrito pelo agentExecutor ou LLM.';
