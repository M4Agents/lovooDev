-- =============================================================================
-- Migration: instagram_connections — suporte a Data Deletion e Deauthorize
--
-- 1. access_token_enc: torna nullable
--    Necessário pois o cron de Data Deletion e Deauthorize nulifica o token
--    ao revogar a conexão. O campo continua NOT NULL para novas conexões
--    (a constraint é aplicada por lógica de negócio, não DB).
--
-- 2. data_deletion_requested_at / data_deletion_completed_at: novas colunas
--    Permitem rastrear o ciclo de vida de uma solicitação de exclusão LGPD.
--
-- Impactos validados:
--   - cron/refresh-instagram-tokens: filtra status IN ('active','limited') —
--     conexões revoked não são processadas; + guard access_token_enc IS NOT NULL
--   - Todos os handlers que chamam decryptInstagramToken já verificam
--     status !== 'active' antes do decrypt; adicionado guard de null adicional.
-- =============================================================================

ALTER TABLE public.instagram_connections
  ALTER COLUMN access_token_enc DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS data_deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_deletion_completed_at TIMESTAMPTZ;
