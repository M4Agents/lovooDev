-- =============================================================================
-- Instagram BYO — metadados do webhook por credencial
--
-- Adiciona colunas nulas. Não gera rota, não atualiza linhas existentes
-- e não altera App ID, segredos, versão ou contas associadas.
-- Não executa nesta entrega. Aplicar somente após autorização explícita.
--
-- Rollback:
--   ALTER TABLE public.instagram_byo_company_credentials
--     DROP CONSTRAINT IF EXISTS chk_ig_byo_cred_webhook_route,
--     DROP CONSTRAINT IF EXISTS chk_ig_byo_cred_webhook_hash,
--     DROP CONSTRAINT IF EXISTS chk_ig_byo_cred_webhook_pair,
--     DROP CONSTRAINT IF EXISTS chk_ig_byo_cred_webhook_enabled;
--   DROP INDEX IF EXISTS public.uq_ig_byo_cred_webhook_route;
--   ALTER TABLE public.instagram_byo_company_credentials
--     DROP COLUMN IF EXISTS webhook_enabled,
--     DROP COLUMN IF EXISTS webhook_verify_token_hash,
--     DROP COLUMN IF EXISTS webhook_route_id;
-- =============================================================================

ALTER TABLE public.instagram_byo_company_credentials
  ADD COLUMN webhook_route_id TEXT,
  ADD COLUMN webhook_verify_token_hash TEXT,
  ADD COLUMN webhook_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.instagram_byo_company_credentials
  ADD CONSTRAINT chk_ig_byo_cred_webhook_route
    CHECK (webhook_route_id IS NULL OR webhook_route_id ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_ig_byo_cred_webhook_hash
    CHECK (webhook_verify_token_hash IS NULL OR webhook_verify_token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_ig_byo_cred_webhook_pair
    CHECK (webhook_verify_token_hash IS NULL OR webhook_route_id IS NOT NULL),
  ADD CONSTRAINT chk_ig_byo_cred_webhook_enabled
    CHECK (
      webhook_enabled = false
      OR (webhook_route_id IS NOT NULL AND webhook_verify_token_hash IS NOT NULL)
    );

CREATE UNIQUE INDEX uq_ig_byo_cred_webhook_route
  ON public.instagram_byo_company_credentials (webhook_route_id)
  WHERE webhook_route_id IS NOT NULL;
