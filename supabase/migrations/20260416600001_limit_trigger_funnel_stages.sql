-- =============================================================================
-- MIGRATION: Trigger de limite max_funnel_stages em funnel_stages
--
-- OBJETIVO:
--   Impedir criação de novas etapas quando o funil atingiu o limite do plano
--   (plans.max_funnel_stages), independente do caminho de criação.
--
-- ESTRATÉGIA:
--   Trigger BEFORE INSERT — hard block antes de qualquer INSERT.
--   SECURITY DEFINER — acessa plans sem depender da sessão do usuário.
--   funnel_stages não tem company_id direto → obtido via JOIN com sales_funnels.
--
-- INTERPRETAÇÃO DE max_funnel_stages:
--   Limite de etapas por funil (não total da empresa).
--   Estágios marcados como is_system_stage = true (ex: "Ganho", "Perdido")
--   são criados automaticamente pelo sistema e NÃO contam no limite do usuário.
--
-- COMPORTAMENTO:
--   NULL em plans.max_funnel_stages = ilimitado → prossegue sem restrição.
--   Empresa sem plan_id = sem limite configurado → prossegue sem restrição.
--   funnel_id inexistente → deixa o INSERT prosseguir (FK violation vai capturar).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_funnel_stages_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id    UUID;
  v_max_stages    INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Obter company_id via o funil ao qual a etapa pertence
  SELECT sf.company_id
  INTO v_company_id
  FROM public.sales_funnels sf
  WHERE sf.id = NEW.funnel_id;

  -- funnel_id inválido: deixar o banco recusar via FK constraint
  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Buscar limite via companies.plan_id → plans.max_funnel_stages
  SELECT pl.max_funnel_stages
  INTO v_max_stages
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = v_company_id;

  -- NULL = ilimitado
  IF v_max_stages IS NULL THEN
    RETURN NEW;
  END IF;

  -- Contar apenas stages criados pelo usuário (excluir stages de sistema)
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.funnel_stages
  WHERE funnel_id = NEW.funnel_id
    AND COALESCE(is_system_stage, false) = false;

  IF v_current_count >= v_max_stages THEN
    RAISE EXCEPTION 'plan_funnel_stages_limit_exceeded'
      USING DETAIL = format(
        'Limite de etapas do plano atingido (%s/%s) no funil %s (empresa %s).',
        v_current_count, v_max_stages, NEW.funnel_id, v_company_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_funnel_stages_limit ON public.funnel_stages;

CREATE TRIGGER enforce_funnel_stages_limit
  BEFORE INSERT ON public.funnel_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.check_funnel_stages_limit();

COMMENT ON FUNCTION public.check_funnel_stages_limit() IS
  'Verifica max_funnel_stages do plano antes de criar nova etapa de funil. '
  'Limite aplicado por funil. Stages de sistema (is_system_stage = true) não contam. '
  'NULL = ilimitado. Hard block via RAISE EXCEPTION.';
