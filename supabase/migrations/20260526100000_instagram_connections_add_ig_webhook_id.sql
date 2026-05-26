-- Migration: adiciona coluna ig_webhook_id em instagram_connections
--
-- Contexto:
--   A Meta retorna dois IDs diferentes para a mesma conta Instagram:
--     - instagram_user_id  → ID retornado pelo OAuth (/me → id)
--     - ig_webhook_id      → IGBID retornado pelos webhooks (entry.id) e pelo campo user_id do /me
--
--   Contas novas têm IDs distintos. Contas antigas (ex: @lovoocrm) podem ter IDs iguais
--   pois foram criadas antes da separação de tipos de ID pela Meta.
--
--   O webhook usa o IGBID. Para encontrar a conexão correta, precisamos armazenar ambos.
--   O lookup no webhook passa a usar: ig_webhook_id OR instagram_user_id (fallback).

ALTER TABLE public.instagram_connections
  ADD COLUMN IF NOT EXISTS ig_webhook_id text;

-- Índice para lookup eficiente no processamento de webhooks
CREATE INDEX IF NOT EXISTS idx_instagram_connections_ig_webhook_id
  ON public.instagram_connections (ig_webhook_id)
  WHERE ig_webhook_id IS NOT NULL;
