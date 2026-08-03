-- =============================================================================
-- Nuvemshop Integration — Migration Fase 12
-- Status do script de rastreamento em nuvemshop_connections
--
-- Nota: script_id TEXT já existe na tabela desde a migration de fundação
-- (20260803110000_nuvemshop_connections.sql).
--
-- script_status TEXT:
--   Rastreia o ciclo de vida do script de rastreamento registrado via
--   Scripts API da Nuvemshop.
--
--   Valores:
--     NULL           → criação nunca tentada (conexões anteriores à Fase 12)
--     'pending'      → criação agendada mas ainda não executada
--     'created'      → script registrado com sucesso na loja
--     'failed'       → falha na criação (nova tentativa possível)
--     'config_error' → URL de script não configurada no ambiente
--     'deleted'      → script removido da loja (desconexão)
--     'delete_failed'→ falha na remoção (conexão marcada como desconectada mesmo assim)
--
-- A desconexão da integração ocorre independentemente do script_status.
-- Falha na remoção do script não bloqueia a desconexão.
-- =============================================================================

ALTER TABLE public.nuvemshop_connections
  ADD COLUMN IF NOT EXISTS script_status TEXT;

ALTER TABLE public.nuvemshop_connections
  ADD CONSTRAINT chk_conn_script_status
    CHECK (
      script_status IS NULL
      OR script_status IN ('pending', 'created', 'failed', 'config_error', 'deleted', 'delete_failed')
    );

COMMENT ON COLUMN public.nuvemshop_connections.script_status IS
  'Status do script de rastreamento: pending|created|failed|config_error|deleted|delete_failed. '
  'NULL = nunca tentado. A desconexão da integração independe deste status.';
