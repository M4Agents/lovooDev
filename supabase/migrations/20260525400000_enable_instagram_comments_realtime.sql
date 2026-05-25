-- =============================================================================
-- Habilitar Supabase Realtime na tabela instagram_comments
--
-- Pré-requisito para: useInstagramCommentsData realtime subscriptions
-- Risco: Baixo — sem impacto em queries, RPCs ou RLS existentes.
-- REPLICA IDENTITY FULL garante payload completo nos eventos UPDATE.
-- =============================================================================

ALTER TABLE public.instagram_comments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_comments;
