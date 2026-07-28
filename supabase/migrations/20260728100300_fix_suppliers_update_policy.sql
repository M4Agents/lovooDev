-- =====================================================
-- CORREÇÃO RLS: suppliers_update — adiciona WITH CHECK
-- A policy original (20260728100000) possuía apenas USING,
-- permitindo que company_id fosse alterado para outra empresa.
-- Esta migration remove e recria apenas suppliers_update.
-- SELECT, INSERT e DELETE não são alterados.
-- =====================================================

DROP POLICY IF EXISTS suppliers_update ON suppliers;

CREATE POLICY suppliers_update ON suppliers FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
