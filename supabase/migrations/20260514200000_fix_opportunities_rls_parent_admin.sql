-- Migration: adiciona suporte à Trilha 2 nas políticas RLS de opportunities.
--
-- Problema: as políticas existentes exigem membership direto em company_users
-- para a empresa da oportunidade. super_admin / system_admin da empresa pai
-- não têm esse membership, logo não conseguem ver oportunidades de empresas
-- filhas durante interpolação.
--
-- Solução: adicionar OR auth_user_is_parent_admin(company_id) nas condições
-- de todas as políticas de opportunities, seguindo o padrão já consolidado
-- em leads, sales_funnels, funnel_stages e opportunity_funnel_positions.

-- ─── SELECT ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS opportunities_select_policy ON opportunities;

CREATE POLICY opportunities_select_policy ON opportunities
  FOR SELECT
  USING (
    (
      company_id IN (
        SELECT company_users.company_id
        FROM company_users
        WHERE company_users.user_id  = auth.uid()
          AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
    AND (
      EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = opportunities.company_id
          AND cu.is_active  = true
          AND cu.role       = ANY (ARRAY[
            'super_admin'::text, 'support'::text, 'admin'::text,
            'partner'::text,     'manager'::text
          ])
      )
      OR owner_user_id = auth.uid()
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── INSERT ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS opportunities_insert_policy ON opportunities;

CREATE POLICY opportunities_insert_policy ON opportunities
  FOR INSERT
  WITH CHECK (
    (
      company_id IN (
        SELECT company_users.company_id
        FROM company_users
        WHERE company_users.user_id  = auth.uid()
          AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
    AND (
      EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = opportunities.company_id
          AND cu.is_active  = true
          AND cu.role       = ANY (ARRAY[
            'super_admin'::text, 'support'::text, 'admin'::text,
            'partner'::text,     'manager'::text
          ])
      )
      OR owner_user_id = auth.uid()
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── UPDATE ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS opportunities_update_policy ON opportunities;

CREATE POLICY opportunities_update_policy ON opportunities
  FOR UPDATE
  USING (
    (
      company_id IN (
        SELECT company_users.company_id
        FROM company_users
        WHERE company_users.user_id  = auth.uid()
          AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
    AND (
      EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = opportunities.company_id
          AND cu.is_active  = true
          AND cu.role       = ANY (ARRAY[
            'super_admin'::text, 'support'::text, 'admin'::text,
            'partner'::text,     'manager'::text
          ])
      )
      OR owner_user_id = auth.uid()
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── DELETE ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS opportunities_delete_policy ON opportunities;

CREATE POLICY opportunities_delete_policy ON opportunities
  FOR DELETE
  USING (
    (
      company_id IN (
        SELECT company_users.company_id
        FROM company_users
        WHERE company_users.user_id  = auth.uid()
          AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
    AND (
      EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = opportunities.company_id
          AND cu.is_active  = true
          AND cu.role       = ANY (ARRAY[
            'super_admin'::text, 'support'::text, 'admin'::text,
            'partner'::text,     'manager'::text
          ])
      )
      OR auth_user_is_parent_admin(company_id)
    )
  );
