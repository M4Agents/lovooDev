-- =====================================================
-- Permite SELECT/INSERT/UPDATE em integration_settings da empresa Pai
-- para super admin legado (companies.user_id + is_super_admin), alinhado
-- a api/lib/openai/auth.ts e canManageOpenAIIntegration no frontend.
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
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = auth.uid()
          AND cu.company_id = integration_settings.company_id
          AND cu.role IN ('super_admin', 'admin')
          AND cu.is_active IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );

CREATE POLICY "integration_settings_insert_parent_admins"
  ON public.integration_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = auth.uid()
          AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND cu.role IN ('super_admin', 'admin')
          AND cu.is_active IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );

CREATE POLICY "integration_settings_update_parent_admins"
  ON public.integration_settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = auth.uid()
          AND cu.company_id = integration_settings.company_id
          AND cu.role IN ('super_admin', 'admin')
          AND cu.is_active IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  )
  WITH CHECK (
    company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = auth.uid()
          AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND cu.role IN ('super_admin', 'admin')
          AND cu.is_active IS NOT FALSE
      )
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
          AND c.user_id = auth.uid()
          AND c.is_super_admin IS TRUE
      )
    )
  );
