-- Corrige a policy RLS de company_media_library.
-- O padrão anterior usava auth.jwt() ->> 'company_id' (custom claim inexistente neste projeto).
-- O padrão correto usa company_users + auth.uid(), igual a todos os outros módulos.

DROP POLICY IF EXISTS "company_media_isolation" ON company_media_library;

CREATE POLICY "company_media_isolation" ON company_media_library
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );
