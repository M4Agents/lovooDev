-- =============================================================================
-- MIGRATION E3a: Adicionar is_over_plan à tabela leads
--
-- OBJETIVO:
--   Marcar leads criados quando a empresa já havia atingido o limite max_leads
--   do plano. O lead SEMPRE é criado — é a visibilidade que é restrita.
--
-- REGRA DE NEGÓCIO:
--   Lead nunca é bloqueado por plano. Se criado acima do limite:
--   - is_over_plan = true
--   - name visível
--   - phone, email, company_* devem ser mascarados (implementado em E3/E4)
--   - existência visível no chat, funil e lista
--
-- PADRÃO: igual a is_duplicate BOOLEAN DEFAULT FALSE já existente na tabela.
-- DEFAULT FALSE: leads existentes antes desta migration = dentro do plano.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_over_plan BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice parcial: otimiza queries de leads restritos por empresa
CREATE INDEX IF NOT EXISTS idx_leads_is_over_plan_company
  ON public.leads (company_id, is_over_plan)
  WHERE is_over_plan = TRUE;

COMMENT ON COLUMN public.leads.is_over_plan IS
  'TRUE quando o lead foi criado enquanto a empresa estava acima do limite max_leads do plano. '
  'O lead existe e é acessível, mas dados sensíveis (phone, email, etc.) devem ser mascarados no frontend e backend. '
  'DEFAULT FALSE: leads criados antes desta coluna são tratados como dentro do plano.';
