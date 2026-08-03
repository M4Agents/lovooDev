-- =============================================================================
-- Nuvemshop Integration — Migration (Fase 3)
-- Campos adicionais em nuvemshop_connections para refinamentos da revisão:
--
-- metadata_status: rastreia o resultado do GET /store no callback OAuth.
--   success  → store info obtida com sucesso
--   pending  → fetch em andamento ou não realizado
--   failed   → GET /store falhou (conexão salva sem metadados da loja)
--
-- oauth_nonce: implementa state single-use.
--   Armazena o nonce do último state OAuth consumido com sucesso.
--   Impede replay de states válidos (defesa em profundidade contra CSRF).
-- =============================================================================

ALTER TABLE public.nuvemshop_connections
  ADD COLUMN IF NOT EXISTS metadata_status TEXT,
  ADD COLUMN IF NOT EXISTS oauth_nonce      TEXT;

ALTER TABLE public.nuvemshop_connections
  ADD CONSTRAINT chk_nvconn_metadata_status
    CHECK (metadata_status IS NULL OR metadata_status IN ('success', 'pending', 'failed'));
