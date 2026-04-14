-- Trigger para manter execution_count, success_count, error_count e
-- last_executed_at em automation_flows atualizados automaticamente
-- quando uma execução é inserida ou muda de status.

CREATE OR REPLACE FUNCTION public.update_flow_execution_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Só age quando o status muda (ou na inserção)
  IF (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  -- Recalcula contadores diretamente do banco (evita race condition)
  UPDATE automation_flows
  SET
    execution_count  = (
      SELECT COUNT(*) FROM automation_executions
      WHERE flow_id = NEW.flow_id AND company_id = NEW.company_id
    ),
    success_count    = (
      SELECT COUNT(*) FROM automation_executions
      WHERE flow_id = NEW.flow_id AND company_id = NEW.company_id
        AND status = 'completed'
    ),
    error_count      = (
      SELECT COUNT(*) FROM automation_executions
      WHERE flow_id = NEW.flow_id AND company_id = NEW.company_id
        AND status = 'failed'
    ),
    last_executed_at = (
      SELECT MAX(started_at) FROM automation_executions
      WHERE flow_id = NEW.flow_id AND company_id = NEW.company_id
    )
  WHERE id = NEW.flow_id
    AND company_id = NEW.company_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_flow_execution_counters ON automation_executions;

CREATE TRIGGER trg_update_flow_execution_counters
  AFTER INSERT OR UPDATE OF status
  ON automation_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_flow_execution_counters();
