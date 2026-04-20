-- =============================================================================
-- MIGRATION: Trigger de limite max_products em products
--
-- OBJETIVO:
--   Impedir criação de novos produtos quando a empresa atingiu o limite do plano
--   (plans.max_products), independente do caminho de criação (frontend, API, etc).
--
-- ESTRATÉGIA:
--   Trigger BEFORE INSERT — hard block antes de qualquer INSERT.
--   SECURITY DEFINER — acessa plans sem depender da sessão do usuário.
--   Segue o mesmo padrão de enforce_automation_flow_limit.
--
-- COMPORTAMENTO:
--   NULL em plans.max_products = ilimitado → prossegue sem restrição.
--   Empresa sem plan_id = sem limite configurado → prossegue sem restrição.
--   COUNT considera apenas produtos com is_active = true.
--   Nota: a tabela products não possui deleted_at; is_active = false é o
--         equivalente de soft-delete/inativação para este recurso.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_products_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_products  INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Buscar limite via companies.plan_id → plans.max_products
  SELECT pl.max_products
  INTO v_max_products
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = NEW.company_id;

  -- NULL = ilimitado
  IF v_max_products IS NULL THEN
    RETURN NEW;
  END IF;

  -- Contar apenas produtos ativos
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.products
  WHERE company_id = NEW.company_id
    AND is_active = true;

  IF v_current_count >= v_max_products THEN
    RAISE EXCEPTION 'plan_products_limit_exceeded'
      USING DETAIL = format(
        'Limite de produtos do plano atingido (%s/%s) para a empresa %s.',
        v_current_count, v_max_products, NEW.company_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_products_limit ON public.products;

CREATE TRIGGER enforce_products_limit
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_products_limit();

COMMENT ON FUNCTION public.check_products_limit() IS
  'Verifica max_products do plano antes de criar novo produto. '
  'NULL = ilimitado. Conta apenas produtos is_active = true. Hard block via RAISE EXCEPTION.';
