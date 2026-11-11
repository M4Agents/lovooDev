-- Quando a instância nova do mesmo número já existe e a antiga é excluída
-- depois, as conversas permaneciam na instância apagada. O gatilho de
-- reconexão só olha instâncias já excluídas no momento em que a nova recebe
-- o telefone. Esta migration cobre a ordem inversa e realoca o que ficou
-- para trás, com a mesma regra: mesma empresa, mesmo telefone, um único
-- destino ativo e sem contato repetido.

CREATE OR REPLACE FUNCTION public.reassign_conversations_from_deleted_instance(
  p_deleted_instance_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_old public.whatsapp_life_instances%ROWTYPE;
  v_live public.whatsapp_life_instances%ROWTYPE;
  v_live_count integer := 0;
  v_moved integer := 0;
  v_flow record;
  v_new_nodes jsonb;
  v_flow_count integer := 0;
BEGIN
  SELECT *
    INTO v_old
  FROM public.whatsapp_life_instances
  WHERE id = p_deleted_instance_id;

  IF NOT FOUND OR v_old.deleted_at IS NULL THEN
    RETURN 0;
  END IF;

  IF v_old.phone_number IS NULL OR v_old.phone_number = '' OR v_old.company_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer
    INTO v_live_count
  FROM public.whatsapp_life_instances
  WHERE company_id = v_old.company_id
    AND phone_number = v_old.phone_number
    AND deleted_at IS NULL
    AND id <> v_old.id;

  IF v_live_count <> 1 THEN
    IF v_live_count > 1 THEN
      RAISE WARNING '[reassign_deleted_instance] instância % com % destinos ativos para o telefone; conversas não movidas',
        v_old.id, v_live_count;
    END IF;
    RETURN 0;
  END IF;

  SELECT *
    INTO v_live
  FROM public.whatsapp_life_instances
  WHERE company_id = v_old.company_id
    AND phone_number = v_old.phone_number
    AND deleted_at IS NULL
    AND id <> v_old.id;

  UPDATE public.chat_conversations
  SET
    instance_id = v_live.id,
    last_instance_id = v_live.id,
    last_instance_name = v_live.instance_name,
    updated_at = NOW()
  WHERE company_id = v_old.company_id
    AND instance_id = v_old.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_conversations cc2
      WHERE cc2.company_id = v_old.company_id
        AND cc2.instance_id = v_live.id
        AND cc2.contact_phone = chat_conversations.contact_phone
        AND cc2.id <> chat_conversations.id
    );

  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE LOG '[reassign_deleted_instance] instância % → % | conversas reatribuídas: %',
    v_old.id, v_live.id, v_moved;

  BEGIN
    FOR v_flow IN
      SELECT id, nodes
      FROM public.automation_flows
      WHERE company_id = v_old.company_id
        AND nodes::text LIKE '%' || v_old.id::text || '%'
    LOOP
      v_new_nodes := public.replace_automation_nodes_instance(
        v_flow.nodes,
        v_old.id,
        v_live.id,
        v_live.instance_name
      );

      IF v_new_nodes IS DISTINCT FROM v_flow.nodes THEN
        UPDATE public.automation_flows
        SET
          nodes = v_new_nodes,
          updated_at = NOW()
        WHERE id = v_flow.id
          AND company_id = v_old.company_id;

        v_flow_count := v_flow_count + 1;
      END IF;
    END LOOP;

    RAISE LOG '[reassign_deleted_instance] instância % → % | automações atualizadas: %',
      v_old.id, v_live.id, v_flow_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[reassign_deleted_instance] falha ao atualizar automações % → %: %',
      v_old.id, v_live.id, SQLERRM;
  END;

  RETURN v_moved;
END;
$function$;

COMMENT ON FUNCTION public.reassign_conversations_from_deleted_instance(uuid) IS
'Move conversas da instância excluída para a única instância ativa da mesma empresa e do mesmo telefone. Não altera responsável nem mensagens. Não move quando o contato já existe no destino.';

REVOKE ALL ON FUNCTION public.reassign_conversations_from_deleted_instance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_conversations_from_deleted_instance(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reassign_conversations_from_deleted_instance(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.reassign_conversations_on_instance_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  PERFORM public.reassign_conversations_from_deleted_instance(NEW.id);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.reassign_conversations_on_instance_soft_delete() IS
'Ao excluir uma instância, realoca as conversas se já existir uma instância ativa com o mesmo telefone na empresa.';

DROP TRIGGER IF EXISTS trg_reassign_conversations_on_instance_soft_delete
  ON public.whatsapp_life_instances;

CREATE TRIGGER trg_reassign_conversations_on_instance_soft_delete
  AFTER UPDATE OF deleted_at ON public.whatsapp_life_instances
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.reassign_conversations_on_instance_soft_delete();

-- Conversas que ficaram na instância excluída porque a nova nasceu antes.
DO $$
DECLARE
  v_old_id uuid;
  v_moved integer;
  v_total integer := 0;
BEGIN
  FOR v_old_id IN
    SELECT old.id
    FROM public.whatsapp_life_instances old
    WHERE old.deleted_at IS NOT NULL
      AND COALESCE(old.phone_number, '') <> ''
      AND (
        SELECT count(*)
        FROM public.whatsapp_life_instances live
        WHERE live.company_id = old.company_id
          AND live.phone_number = old.phone_number
          AND live.deleted_at IS NULL
          AND live.id <> old.id
      ) = 1
  LOOP
    v_moved := public.reassign_conversations_from_deleted_instance(v_old_id);
    v_total := v_total + COALESCE(v_moved, 0);
  END LOOP;

  RAISE LOG '[reassign_deleted_instance] backfill concluído | conversas reatribuídas: %', v_total;
END $$;
