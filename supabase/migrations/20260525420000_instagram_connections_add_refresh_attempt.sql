-- =============================================================================
-- Adiciona coluna last_refresh_attempt_at em instagram_connections
--
-- Objetivo:
--   Proteger contra corrida de execuções simultâneas no cron de refresh
--   de tokens Instagram, usando lock otimista via UPDATE condicional.
--
-- Estratégia de concorrência:
--   O cron usa:
--     UPDATE instagram_connections
--     SET last_refresh_attempt_at = now()
--     WHERE id = ?
--       AND (last_refresh_attempt_at IS NULL
--            OR last_refresh_attempt_at < now() - interval '2 hours')
--   Se UPDATE afeta 0 linhas → outra execução já assumiu a conexão → skip.
--
-- Sem índice novo (tabela pequena, max dezenas de linhas por empresa).
-- Sem policy nova (apenas service_role escreve em instagram_connections).
-- =============================================================================

ALTER TABLE public.instagram_connections
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at TIMESTAMPTZ;
