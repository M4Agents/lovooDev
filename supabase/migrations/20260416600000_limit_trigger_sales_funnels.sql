-- =============================================================================
-- MIGRATION: Trigger de limite max_funnels em sales_funnels
--
-- OBJETIVO:
--   Impedir criação de novos funis quando a empresa atingiu o limite do plano
--   (plans.max_funnels), independente do caminho de criação (frontend, API, etc).
--
-- ESTRATÉGIA:
--   Trigger BEFORE INSERT — hard block antes de qualquer INSERT.
--   SECURITY DEFINER — acessa plans sem depender da sessão do usuário.
--   Segue o mesmo padrão de enforce_automation_flow_limit.
--
-- COMPORTAMENTO:
--   NULL em plans.max_funnels = ilimitado → prossegue sem restrição.
--   Empresa sem plan_id = sem limite configurado → prossegue sem restrição.
--   COUNT considera apenas funis com is_active = true.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_funnel_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_funnels   INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Buscar limite via companies.plan_id → plans.max_funnels
  SELECT pl.max_funnels
  INTO v_max_funnels
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = NEW.company_id;

  -- NULL = ilimitado
  IF v_max_funnels IS NULL THEN
    RETURN NEW;
  END IF;

  -- Contar apenas funis ativos
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.sales_funnels
  WHERE company_id = NEW.company_id
    AND is_active = true;

  IF v_current_count >= v_max_funnels THEN
    RAISE EXCEPTION 'plan_funnels_limit_exceeded'
      USING DETAIL = format(
        'Limite de funis do plano atingido (%s/%s) para a empresa %s.',
        v_current_count, v_max_funnels, NEW.company_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_funnel_limit ON public.sales_funnels;

CREATE TRIGGER enforce_funnel_limit
  BEFORE INSERT ON public.sales_funnels
  FOR EACH ROW
  EXECUTE FUNCTION public.check_funnel_limit();

COMMENT ON FUNCTION public.check_funnel_limit() IS
  'Verifica max_funnels do plano antes de criar novo funil. '
  'NULL = ilimitado. Conta apenas funis is_active = true. Hard block via RAISE EXCEPTION.';
