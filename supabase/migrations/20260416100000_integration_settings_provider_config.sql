-- =====================================================
-- integration_settings: configuração específica por provider (aditiva, não destrutiva)
-- =====================================================

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS provider_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.integration_settings.provider_config IS
  'Parâmetros por provider em JSON (versionado no código). Direção oficial para configurações específicas; nunca armazenar API keys ou segredos.';
