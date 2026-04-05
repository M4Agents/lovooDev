-- =====================================================
-- Corrige políticas RLS de integration_settings para o UUID real
-- da empresa Pai (M4 Digital). Bancos que já aplicaram a migration
-- anterior com o UUID incorreto precisam desta correção.
-- =====================================================

DROP POLICY IF EXISTS "integration_settings_select_parent_admins" ON public.integration_settings;
DROP POLICY IF EXISTS "integration_settings_insert_parent_admins" ON public.integration_settings;
DROP POLICY IF EXISTS "integration_settings_update_parent_admins" ON public.integration_settings;

CREATE POLICY "integration_settings_select_parent_admins"
  ON public.integration_settings
  FOR SELECT
  TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
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
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  );

CREATE POLICY "integration_settings_update_parent_admins"
  ON public.integration_settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = integration_settings.company_id
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  )
  WITH CHECK (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role IN ('super_admin', 'admin')
        AND cu.is_active IS NOT FALSE
    )
  );
