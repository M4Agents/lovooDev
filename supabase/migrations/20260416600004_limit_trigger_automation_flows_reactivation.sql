-- =============================================================================
-- MIGRATION: Trigger de UPDATE (reativação) para automation_flows
--
-- PROBLEMA:
--   O trigger de INSERT já bloqueia criação acima do limite max_automation_flows,
--   mas existe um bypass via reativação:
--     1. Usuário cria flows até o limite
--     2. Desativa alguns (is_active = false)
--     3. Cria novos flows (INSERT passa porque count considera apenas is_active = true)
--     4. Reativa os antigos (UPDATE sem proteção → limite ultrapassado)
--
-- SOLUÇÃO:
--   Trigger BEFORE UPDATE disparando apenas quando is_active muda de false → true,
--   reutilizando check_automation_flow_limit() sem qualquer alteração na função.
--
-- REUTILIZAÇÃO:
--   check_automation_flow_limit() já é compatível com UPDATE porque:
--     - Lê NEW.company_id (disponível em triggers de UPDATE)
--     - Conta flows is_active = true no banco, que ainda NÃO inclui o registro
--       em reativação (ele permanece false durante a transação BEFORE UPDATE)
--   Zero duplicação de lógica. Zero alteração em funções existentes.
--
-- CONSISTÊNCIA:
--   Segue exatamente o mesmo padrão de enforce_funnel_reactivation_limit
--   e enforce_products_reactivation_limit criados anteriormente.
-- =============================================================================

DROP TRIGGER IF EXISTS enforce_automation_flow_reactivation_limit ON public.automation_flows;

CREATE TRIGGER enforce_automation_flow_reactivation_limit
  BEFORE UPDATE ON public.automation_flows
  FOR EACH ROW
  WHEN (OLD.is_active = false AND NEW.is_active = true)
  EXECUTE FUNCTION public.check_automation_flow_limit();

COMMENT ON TRIGGER enforce_automation_flow_reactivation_limit ON public.automation_flows IS
  'Bloqueia reativação de automation flow (is_active: false → true) quando a empresa '
  'já atingiu max_automation_flows do plano. Reutiliza check_automation_flow_limit().';
