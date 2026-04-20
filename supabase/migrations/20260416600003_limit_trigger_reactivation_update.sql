-- =============================================================================
-- MIGRATION: Triggers de UPDATE (reativação) para fechar bypass de limites
--
-- PROBLEMA:
--   Os triggers de INSERT bloqueiam criação acima do limite, mas existe um
--   bypass: criar recursos → desativar alguns → criar novos → reativar antigos.
--   Isso permite ultrapassar o limite do plano via reativação (is_active = false → true).
--
-- SOLUÇÃO:
--   Adicionar triggers BEFORE UPDATE em sales_funnels e products, disparando
--   APENAS quando is_active muda de false → true (reativação).
--
-- REUTILIZAÇÃO DE FUNÇÕES:
--   As funções check_funnel_limit() e check_products_limit() já são compatíveis
--   com UPDATE porque:
--     - Leem NEW.company_id (disponível em triggers de UPDATE)
--     - Contam registros is_active = true no banco, que ainda NÃO inclui o
--       registro em questão (ele permanece false durante a transação BEFORE UPDATE)
--   Portanto: zero duplicação de lógica.
--
-- ESCOPO:
--   sales_funnels  → enforce_funnel_reactivation_limit  (max_funnels)
--   products       → enforce_products_reactivation_limit (max_products)
--   funnel_stages  → NÃO aplicado: tabela não possui campo is_active
-- =============================================================================

-- Trigger de reativação: sales_funnels
DROP TRIGGER IF EXISTS enforce_funnel_reactivation_limit ON public.sales_funnels;

CREATE TRIGGER enforce_funnel_reactivation_limit
  BEFORE UPDATE ON public.sales_funnels
  FOR EACH ROW
  WHEN (OLD.is_active = false AND NEW.is_active = true)
  EXECUTE FUNCTION public.check_funnel_limit();

COMMENT ON TRIGGER enforce_funnel_reactivation_limit ON public.sales_funnels IS
  'Bloqueia reativação de funil (is_active: false → true) quando a empresa '
  'já atingiu max_funnels do plano. Reutiliza check_funnel_limit().';

-- Trigger de reativação: products
DROP TRIGGER IF EXISTS enforce_products_reactivation_limit ON public.products;

CREATE TRIGGER enforce_products_reactivation_limit
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  WHEN (OLD.is_active = false AND NEW.is_active = true)
  EXECUTE FUNCTION public.check_products_limit();

COMMENT ON TRIGGER enforce_products_reactivation_limit ON public.products IS
  'Bloqueia reativação de produto (is_active: false → true) quando a empresa '
  'já atingiu max_products do plano. Reutiliza check_products_limit().';
