-- =============================================================================
-- MIGRATION E2e: Trigger de limite max_automation_flows em automation_flows
--
-- OBJETIVO:
--   Impedir criação de novos automation flows quando a empresa atingiu o
--   limite do plano (plans.max_automation_flows), independente de qual caminho
--   a criação segue (frontend direto via Supabase JS, API, etc).
--
-- ESTRATÉGIA:
--   Trigger BEFORE INSERT — executa antes de qualquer INSERT na tabela.
--   SECURITY DEFINER — acessa plans sem depender da sessão do usuário.
--   RAISE EXCEPTION — diferente do soft block de leads, aqui é um HARD BLOCK:
--     a criação falha de forma explícita com mensagem clara para o frontend.
--
-- RAZÃO DO HARD BLOCK (não soft):
--   - Criar um automation_flow é uma ação deliberada do usuário (não automática)
--   - O erro é recebido pelo frontend imediatamente via Supabase JS client
--   - O frontend pode exibir a mensagem ao usuário e sugerir upgrade de plano
--   - Ao contrário do webhook de leads, aqui não há risco de perder mensagem
--
-- COMPORTAMENTO:
--   NULL em plans.max_automation_flows = ilimitado → prossegue sem restrição
--   Empresa sem plan_id = sem limite configurado → prossegue sem restrição
--   COUNT considera apenas flows com is_active = true
--   is_active = false não conta (flow desativado não usa a cota)
--
-- IMPACTO IMEDIATO:
--   Todos os planos Elite existentes têm max_automation_flows = NULL (ilimitado).
--   O trigger será criado mas nunca disparará para eles.
--   Passa a ser relevante quando planos com limite explícito forem atribuídos.
-- =============================================================================

-- Função de verificação (SECURITY DEFINER para acesso aos plans)
CREATE OR REPLACE FUNCTION public.check_automation_flow_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_flows     INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Buscar limite via companies.plan_id → plans.max_automation_flows
  -- LEFT JOIN garante que empresa sem plan_id retorna NULL (= ilimitado)
  -- Filtro is_active = true evita usar plano desativado
  SELECT pl.max_automation_flows
  INTO v_max_flows
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = NEW.company_id;

  -- NULL = ilimitado (sem plan_id ou plano sem limite configurado)
  IF v_max_flows IS NULL THEN
    RETURN NEW;
  END IF;

  -- Contar apenas flows ATIVOS para não penalizar flows desativados
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.automation_flows
  WHERE company_id = NEW.company_id
    AND is_active = true;

  IF v_current_count >= v_max_flows THEN
    RAISE EXCEPTION 'plan_automation_flows_limit_exceeded'
      USING DETAIL = format(
        'Limite de automation flows do plano atingido (%s/%s) para a empresa %s.',
        v_current_count, v_max_flows, NEW.company_id
      );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger BEFORE INSERT (não AFTER — bloqueia antes de gravar)
DROP TRIGGER IF EXISTS enforce_automation_flow_limit ON public.automation_flows;

CREATE TRIGGER enforce_automation_flow_limit
  BEFORE INSERT ON public.automation_flows
  FOR EACH ROW
  EXECUTE FUNCTION public.check_automation_flow_limit();

COMMENT ON FUNCTION public.check_automation_flow_limit() IS
  'Verifica max_automation_flows do plano antes de criar novo automation flow. '
  'NULL = ilimitado. Conta apenas flows is_active = true. Hard block via RAISE EXCEPTION.';
