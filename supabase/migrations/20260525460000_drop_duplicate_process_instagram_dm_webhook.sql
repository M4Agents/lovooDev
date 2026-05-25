-- =============================================================================
-- Migration: remover overload antigo de process_instagram_dm_webhook
--
-- PROBLEMA: existem duas versões da função com assinaturas distintas.
-- O PostgreSQL não consegue resolver qual usar quando chamada pelo Supabase
-- client com parâmetros nomeados (erro: "Could not choose the best candidate").
--
-- Versão antiga (11 params, sem reply_to): será removida.
-- Versão nova (14 params, com reply_to): mantida como única versão.
--
-- Evidência nos logs:
--   instagram_webhook_events.error_detail = "Could not choose the best
--   candidate function between: process_instagram_dm_webhook(...)"
--   → eventos com processing_status = 'failed' em 2026-05-24
-- =============================================================================

DROP FUNCTION IF EXISTS public.process_instagram_dm_webhook(
  text,  -- p_instagram_user_id
  text,  -- p_ig_message_id
  text,  -- p_ig_thread_id
  text,  -- p_participant_ig_user_id
  text,  -- p_participant_name
  text,  -- p_participant_username
  text,  -- p_direction
  text,  -- p_message_type
  text,  -- p_content
  text,  -- p_media_url
  timestamp with time zone  -- p_timestamp
);
