-- =============================================================================
-- MIGRATION E4a: Liberação automática de leads restritos ao trocar plano
--
-- OBJETIVO:
--   Quando companies.plan_id é atualizado, recalcular is_over_plan para todos
--   os leads da empresa de forma determinística e automática.
--
-- REGRA DE LIBERAÇÃO:
--   1. Novo plano com max_leads = NULL (ilimitado): libera TODOS.
--   2. Novo plano com max_leads >= total leads: libera TODOS.
--   3. Novo plano com max_leads < total leads: recalcula posições.
--      Os leads mais antigos (created_at ASC, id ASC) têm prioridade.
--      Os primeiros max_leads leads ficam com is_over_plan = false.
--      Os demais ficam/permanecem com is_over_plan = true.
--
-- DETERMINISMO:
--   - Sempre ordena por (created_at ASC, id ASC) — estável e auditável.
--   - Funciona para leads criados por API, webhook, WhatsApp ou importação.
--   - Garante que apenas leads realmente afetados (mudança de estado) são tocados.
--
-- ATIVAÇÃO:
--   Trigger AFTER UPDATE OF plan_id na tabela companies.
--   Não depende de ação manual do usuário.
--   Não depende de intervenção administrativa.
-- =============================================================================

-- Função de recálculo (chamada pelo trigger e pode ser chamada manualmente)
CREATE OR REPLACE FUNCTION public.recalculate_leads_over_plan(p_company_id UUID)
RETURNS INTEGER  -- número de leads cujo is_over_plan foi alterado
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_leads INTEGER;
  v_affected  INTEGER := 0;
BEGIN
  -- Buscar max_leads do plano atual via companies.plan_id → plans
  -- LEFT JOIN garante NULL quando empresa não tem plan_id (= ilimitado)
  SELECT pl.max_leads
  INTO v_max_leads
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  IF v_max_leads IS NULL THEN
    -- Plano ilimitado: liberar todos os leads restritos
    UPDATE public.leads
    SET is_over_plan = false,
        updated_at   = NOW()
    WHERE company_id  = p_company_id
      AND is_over_plan = true
      AND deleted_at  IS NULL;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE LOG 'recalculate_leads_over_plan: empresa % — % leads liberados (plano ilimitado)', p_company_id, v_affected;
    END IF;
    RETURN v_affected;
  END IF;

  -- Recalcular from scratch com base na posição ordenada.
  -- Leads além da posição max_leads → is_over_plan = true.
  -- Leads até a posição max_leads → is_over_plan = false.
  -- Apenas atualiza registros onde o valor muda (performance).
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
    FROM public.leads
    WHERE company_id = p_company_id
      AND deleted_at IS NULL
  ),
  updated AS (
    UPDATE public.leads l
    SET is_over_plan = CASE WHEN r.rn > v_max_leads THEN true ELSE false END,
        updated_at   = NOW()
    FROM ranked r
    WHERE l.id = r.id
      AND l.is_over_plan IS DISTINCT FROM (r.rn > v_max_leads)
    RETURNING l.id
  )
  SELECT COUNT(*) INTO v_affected FROM updated;

  IF v_affected > 0 THEN
    RAISE LOG 'recalculate_leads_over_plan: empresa % — % leads atualizados (max_leads=%)', p_company_id, v_affected, v_max_leads;
  END IF;

  RETURN v_affected;
END;
$$;

COMMENT ON FUNCTION public.recalculate_leads_over_plan(UUID) IS
  'Recalcula is_over_plan para todos os leads de uma empresa com base no plano atual. '
  'Chamada automaticamente pelo trigger recalculate_leads_on_plan_change quando companies.plan_id muda. '
  'Pode ser chamada manualmente por admins se necessário. '
  'Retorna o número de leads cujo is_over_plan foi alterado.';

-- Função de trigger
CREATE OR REPLACE FUNCTION public.trigger_recalculate_leads_on_plan_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só dispara quando plan_id realmente muda (NULL IS DISTINCT FROM UUID)
  IF OLD.plan_id IS DISTINCT FROM NEW.plan_id THEN
    PERFORM public.recalculate_leads_over_plan(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_recalculate_leads_on_plan_change() IS
  'Trigger function: dispara recalculate_leads_over_plan quando companies.plan_id é alterado.';

-- Trigger AFTER UPDATE OF plan_id
DROP TRIGGER IF EXISTS recalculate_leads_on_plan_change ON public.companies;

CREATE TRIGGER recalculate_leads_on_plan_change
  AFTER UPDATE OF plan_id ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recalculate_leads_on_plan_change();
