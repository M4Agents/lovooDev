-- =====================================================
-- integration_settings: configuração operacional de integrações (sem secrets)
-- OpenAI: company_id = empresa Pai, provider = 'openai'
-- =====================================================

CREATE TABLE IF NOT EXISTS public.integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  model text NOT NULL DEFAULT 'gpt-4.1-mini',
  timeout_ms integer NOT NULL DEFAULT 60000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_settings_provider_nonempty CHECK (length(trim(provider)) > 0),
  CONSTRAINT integration_settings_model_nonempty CHECK (length(trim(model)) > 0),
  CONSTRAINT integration_settings_timeout_positive CHECK (timeout_ms >= 1000 AND timeout_ms <= 600000),
  CONSTRAINT integration_settings_company_provider_unique UNIQUE (company_id, provider)
);

CREATE INDEX IF NOT EXISTS integration_settings_company_provider_idx
  ON public.integration_settings (company_id, provider);

COMMENT ON TABLE public.integration_settings IS
  'Configurações de integrações por empresa; nunca armazenar API keys ou segredos.';

COMMENT ON COLUMN public.integration_settings.provider IS
  'Ex.: openai — combinação única com company_id.';

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

-- Somente Super Admin e Admin vinculados à empresa Pai podem ler/escrever a linha da Pai.
CREATE POLICY "integration_settings_select_parent_admins"
  ON public.integration_settings
  FOR SELECT
  TO authenticated
  USING (
    company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = integration_settings.company_id
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  );

CREATE POLICY "integration_settings_insert_parent_admins"
  ON public.integration_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  );

CREATE POLICY "integration_settings_update_parent_admins"
  ON public.integration_settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = integration_settings.company_id
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  )
  WITH CHECK (
    company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'::uuid
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  );

CREATE TRIGGER integration_settings_updated_at
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
