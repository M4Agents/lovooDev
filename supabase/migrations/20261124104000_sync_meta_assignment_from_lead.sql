-- =============================================================================
-- Meta WhatsApp — sincronização transacional da atribuição (META-L1.4C.5.1E.1B)
--
-- Dispara somente quando leads.responsible_user_id muda. A fonte é NEW,
-- nunca um parâmetro enviado pelo cliente. Não altera chat_conversations,
-- funções Uazapi, autorização comercial, RLS nem a atribuição inicial.
--
-- Responsável ativo na mesma empresa é copiado. Responsável nulo, inativo,
-- inexistente ou de outra empresa limpa assigned_to. A alteração comercial
-- não é recusada por membership inválida.
--
-- Não há captura de exceção. Falha no UPDATE Meta reverte a transação,
-- inclusive efeitos comerciais e Uazapi já executados nela.
-- A desativação posterior de company_users não dispara este trigger.
-- =============================================================================

CREATE FUNCTION private.sync_meta_assignment_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_target uuid;
BEGIN
  IF NEW.responsible_user_id IS NULL THEN
    v_target := NULL;
  ELSIF EXISTS (
    SELECT 1
      FROM public.company_users AS cu
     WHERE cu.company_id = NEW.company_id
       AND cu.user_id = NEW.responsible_user_id
       AND cu.is_active IS TRUE
  ) THEN
    v_target := NEW.responsible_user_id;
  ELSE
    v_target := NULL;
  END IF;

  UPDATE public.meta_conversations AS mc
     SET assigned_to = v_target
   WHERE mc.company_id = NEW.company_id
     AND mc.lead_id = NEW.id
     AND mc.assigned_to IS DISTINCT FROM v_target;

  RETURN NULL;
END;
$fn$;

ALTER FUNCTION private.sync_meta_assignment_from_lead()
  OWNER TO postgres;

COMMENT ON FUNCTION private.sync_meta_assignment_from_lead() IS
  'AFTER UPDATE de leads.responsible_user_id. Sincroniza apenas '
  'meta_conversations.assigned_to na mesma empresa e lead. '
  'SECURITY DEFINER, search_path = pg_catalog. Sem EXECUTE para papéis de aplicação.';

REVOKE ALL ON FUNCTION private.sync_meta_assignment_from_lead()
  FROM PUBLIC;

REVOKE ALL ON FUNCTION private.sync_meta_assignment_from_lead()
  FROM anon;

REVOKE ALL ON FUNCTION private.sync_meta_assignment_from_lead()
  FROM authenticated;

REVOKE ALL ON FUNCTION private.sync_meta_assignment_from_lead()
  FROM service_role;

CREATE TRIGGER trg_meta_sync_responsible_to_conversations
  AFTER UPDATE OF responsible_user_id
  ON public.leads
  FOR EACH ROW
  WHEN (OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id)
  EXECUTE FUNCTION private.sync_meta_assignment_from_lead();

COMMENT ON TRIGGER trg_meta_sync_responsible_to_conversations
  ON public.leads IS
  'Sincroniza a atribuição Meta depois de trg_guard_lead_responsible_after '
  'e antes de webhook_trigger_on_lead_update. Não grava chat Uazapi.';
