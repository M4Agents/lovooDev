-- Quando o mesmo número de WhatsApp volta em uma instância nova,
-- as automações da empresa que apontavam para a instância excluída
-- passam a apontar para a instância nova. O nome pode ser outro.
-- Só troca config.instanceId / config.instanceName. Histórico de
-- debug dentro do fluxo permanece como estava.

CREATE OR REPLACE FUNCTION public.replace_automation_nodes_instance(
  p_nodes jsonb,
  p_old_instance_id uuid,
  p_new_instance_id uuid,
  p_new_instance_name text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public
AS $function$
DECLARE
  v_old text := p_old_instance_id::text;
  v_new text := p_new_instance_id::text;
  v_name text := COALESCE(p_new_instance_name, '');
  v_result jsonb := '[]'::jsonb;
  v_node record;
  v_elem jsonb;
  v_triggers jsonb;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' OR jsonb_array_length(p_nodes) = 0 THEN
    RETURN p_nodes;
  END IF;

  FOR v_node IN
    SELECT elem, ord
    FROM jsonb_array_elements(p_nodes) WITH ORDINALITY AS t(elem, ord)
    ORDER BY ord
  LOOP
    v_elem := v_node.elem;

    IF v_elem #>> '{data,config,instanceId}' = v_old THEN
      v_elem := jsonb_set(v_elem, '{data,config,instanceId}', to_jsonb(v_new), false);
      v_elem := jsonb_set(v_elem, '{data,config,instanceName}', to_jsonb(v_name), true);
    END IF;

    IF jsonb_typeof(v_elem #> '{data,triggers}') = 'array' THEN
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN trig #>> '{config,instanceId}' = v_old THEN
            jsonb_set(
              jsonb_set(trig, '{config,instanceId}', to_jsonb(v_new), false),
              '{config,instanceName}',
              to_jsonb(v_name),
              true
            )
          ELSE trig
        END
        ORDER BY trig_ord
      ), '[]'::jsonb)
      INTO v_triggers
      FROM jsonb_array_elements(v_elem #> '{data,triggers}') WITH ORDINALITY AS tr(trig, trig_ord);

      v_elem := jsonb_set(v_elem, '{data,triggers}', v_triggers, false);
    END IF;

    v_result := v_result || jsonb_build_array(v_elem);
  END LOOP;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.replace_automation_nodes_instance(jsonb, uuid, uuid, text) IS
'Troca o id da instância nos gatilhos e blocos de mensagem de um fluxo. Não altera histórico de execução gravado no nó.';

CREATE OR REPLACE FUNCTION public.reassign_conversations_on_instance_reconnect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_old_instance RECORD;
    v_reassigned_count INTEGER := 0;
    v_flow RECORD;
    v_new_nodes jsonb;
    v_flow_count INTEGER := 0;
BEGIN
    IF NEW.phone_number IS NULL OR NEW.phone_number = '' THEN
        RETURN NEW;
    END IF;

    FOR v_old_instance IN
        SELECT id
        FROM whatsapp_life_instances
        WHERE company_id   = NEW.company_id
          AND phone_number = NEW.phone_number
          AND deleted_at   IS NOT NULL
          AND id           != NEW.id
    LOOP
        UPDATE chat_conversations
        SET
            instance_id        = NEW.id,
            last_instance_id   = NEW.id,
            last_instance_name = NEW.instance_name,
            updated_at         = NOW()
        WHERE (instance_id = v_old_instance.id OR last_instance_id = v_old_instance.id)
          AND NOT EXISTS (
              SELECT 1
              FROM chat_conversations cc2
              WHERE cc2.company_id    = NEW.company_id
                AND cc2.instance_id   = NEW.id
                AND cc2.contact_phone = chat_conversations.contact_phone
          );

        GET DIAGNOSTICS v_reassigned_count = ROW_COUNT;

        RAISE LOG '[trigger] reassign_conversations: instância % → % | conversas reatribuídas: %',
            v_old_instance.id, NEW.id, v_reassigned_count;

        v_flow_count := 0;

        BEGIN
            FOR v_flow IN
                SELECT id, nodes
                FROM automation_flows
                WHERE company_id = NEW.company_id
                  AND nodes::text LIKE '%' || v_old_instance.id::text || '%'
            LOOP
                v_new_nodes := public.replace_automation_nodes_instance(
                    v_flow.nodes,
                    v_old_instance.id,
                    NEW.id,
                    NEW.instance_name
                );

                IF v_new_nodes IS DISTINCT FROM v_flow.nodes THEN
                    UPDATE automation_flows
                    SET
                        nodes = v_new_nodes,
                        updated_at = NOW()
                    WHERE id = v_flow.id
                      AND company_id = NEW.company_id;

                    v_flow_count := v_flow_count + 1;
                END IF;
            END LOOP;

            RAISE LOG '[trigger] reassign_conversations: instância % → % | automações atualizadas: %',
                v_old_instance.id, NEW.id, v_flow_count;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[trigger] reassign_conversations: falha ao atualizar automações % → %: %',
                v_old_instance.id, NEW.id, SQLERRM;
        END;
    END LOOP;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.reassign_conversations_on_instance_reconnect() IS
'Ao conectar um número que já teve instância excluída na mesma empresa, move as conversas e a instância selecionada nas automações para a instância nova.';
