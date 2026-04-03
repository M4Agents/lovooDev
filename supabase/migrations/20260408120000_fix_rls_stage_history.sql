-- =====================================================
-- MIGRATION: fix_rls_stage_history
-- Problema: RLS de opportunity_stage_history usava = LIMIT 1
--           sem ORDER BY, retornando company_id não determinístico
--           para usuários que pertencem a múltiplas empresas
--           (ex: super admins). Isso bloqueava silenciosamente
--           registros válidos (data: [], error: null no cliente).
--
-- Fix: usar IN ao invés de = LIMIT 1, alinhando com o padrão
--       já adotado pela tabela `opportunities`.
-- =====================================================

-- opportunity_stage_history: substituir = LIMIT 1 por IN
DROP POLICY IF EXISTS "ostagehist_tenant_isolation" ON opportunity_stage_history;

CREATE POLICY "ostagehist_tenant_isolation" ON opportunity_stage_history
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );

-- opportunity_status_history: mesma correção preventiva para consistência
DROP POLICY IF EXISTS "osh_tenant_isolation" ON opportunity_status_history;

CREATE POLICY "osh_tenant_isolation" ON opportunity_status_history
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_users WHERE user_id = auth.uid()
    )
  );
