-- =====================================================================
-- Migration: Adicionar reply_to_message_id em chat_messages
-- Data: 2026-05-06
--
-- Objetivo:
--   Suporte a "responder mensagem" no chat Uazapi.
--   A coluna armazena a FK para a mensagem original que foi respondida.
--
-- Estratégia:
--   ON DELETE SET NULL — se a mensagem original for deletada,
--   o vínculo é removido sem quebrar a mensagem que respondeu.
--
-- Segurança:
--   Índice parcial apenas em registros não-NULL para mínimo overhead.
--   Sem alteração em RLS (a coluna é lida/gravada somente via RPCs
--   SECURITY DEFINER existentes).
-- =====================================================================

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
    REFERENCES public.chat_messages(id) ON DELETE SET NULL;

-- Índice parcial — somente mensagens que são respostas
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_message_id
  ON public.chat_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

COMMENT ON COLUMN public.chat_messages.reply_to_message_id IS
'FK para a mensagem original respondida. NULL quando não é uma resposta. '
'Gerenciada somente via RPCs SECURITY DEFINER para garantir isolamento multi-tenant.';
