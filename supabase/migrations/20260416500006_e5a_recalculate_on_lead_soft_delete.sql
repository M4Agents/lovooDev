-- =============================================================================
-- E5a: Recalcular is_over_plan quando lead for soft-deletado
--
-- O sistema usa soft-delete via UPDATE leads SET deleted_at = NOW().
-- Quando isso acontece, a vaga liberada pode retirar a flag is_over_plan
-- de outros leads que estavam marcados como restritos.
--
-- Reutiliza a função recalculate_leads_over_plan já criada em E4a,
-- disparando-a apenas quando deleted_at muda de NULL para não-NULL.
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_recalculate_leads_on_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dispara apenas quando deleted_at passa de NULL → não-NULL (soft delete)
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM recalculate_leads_over_plan(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalculate_leads_on_soft_delete ON public.leads;

CREATE TRIGGER recalculate_leads_on_soft_delete
  AFTER UPDATE OF deleted_at
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalculate_leads_on_soft_delete();
