-- =============================================================================
-- Habilitar Supabase Realtime nas tabelas Instagram
--
-- Problema: instagram_conversations e instagram_messages não estavam na
-- publicação supabase_realtime, portanto postgres_changes nunca entregava
-- eventos ao frontend mesmo com a subscription marcada como SUBSCRIBED.
--
-- REPLICA IDENTITY FULL: garante que UPDATE entregue o payload completo
-- (ex: last_message_preview, unread_count, updated_at) sem fetch adicional.
--
-- Pré-requisito para: useInstagramChatData realtime subscriptions
-- Risco: Baixo — sem impacto em queries, RPCs ou RLS existentes.
-- =============================================================================

ALTER TABLE public.instagram_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.instagram_messages      REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_messages;
