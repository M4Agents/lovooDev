-- =====================================================
-- Migration: drop_chat_create_message_11params
-- Data: 2026-05-12
--
-- Problema: existem dois overloads de chat_create_message:
--   - 11 params (original, sem p_reply_to_message_id)
--   - 12 params (atual, com p_reply_to_message_id DEFAULT NULL)
--
-- O PostgREST não consegue resolver a ambiguidade quando a função
-- é chamada com 11 params (PGRST203), bloqueando o envio de
-- mensagens pelo agente de IA.
--
-- Solução: remover o overload antigo de 11 params.
-- A versão de 12 params (com DEFAULT NULL) é retrocompatível —
-- todas as chamadas existentes continuam funcionando sem alteração.
-- =====================================================

DROP FUNCTION IF EXISTS public.chat_create_message(
  p_conversation_id  uuid,
  p_company_id       uuid,
  p_content          text,
  p_message_type     text,
  p_direction        text,
  p_sent_by          uuid,
  p_media_url        text,
  p_is_ai_generated  boolean,
  p_ai_run_id        uuid,
  p_ai_block_index   smallint,
  p_ai_block_type    text
);
