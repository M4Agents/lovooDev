-- =============================================================================
-- Habilitar Supabase Realtime para instagram_connections
--
-- Necessário para que mudanças de status feitas pelo cron (token_refresh,
-- reauth_required) propaguem em tempo real para a UI sem reload.
--
-- Idempotente: verifica se a tabela já está na publicação antes de adicioná-la.
-- =============================================================================

ALTER TABLE public.instagram_connections REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE  pubname   = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'instagram_connections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_connections;
  END IF;
END $$;
