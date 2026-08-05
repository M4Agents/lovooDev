-- Migration: Corrige reassign_conversations_on_instance_reconnect
-- Problema: Ao reconectar uma instância com histórico de múltiplas conexões anteriores
--           (mesmo phone_number em várias instâncias deletadas), o gatilho tenta mover
--           conversas de todas as instâncias antigas em loop. Quando o mesmo contact_phone
--           já foi movido na primeira iteração, a segunda iteração causa unique constraint
--           violation em chat_conversations(company_id, instance_id, contact_phone),
--           derrubando toda a transação e impedindo a criação da instância permanente.
-- Correção: Adicionar NOT EXISTS para pular conversas cujo contact_phone já existe
--           na nova instância, evitando duplicatas sem perder reatribuições válidas.

CREATE OR REPLACE FUNCTION public.reassign_conversations_on_instance_reconnect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_old_instance RECORD;
    v_reassigned_count INTEGER := 0;
BEGIN
    -- Só age quando phone_number está preenchido
    IF NEW.phone_number IS NULL OR NEW.phone_number = '' THEN
        RETURN NEW;
    END IF;

    -- Busca instâncias deletadas da mesma empresa com mesmo número
    FOR v_old_instance IN
        SELECT id
        FROM whatsapp_life_instances
        WHERE company_id   = NEW.company_id
          AND phone_number = NEW.phone_number
          AND deleted_at   IS NOT NULL
          AND id           != NEW.id
    LOOP
        -- Reatribuir conversas que apontavam para a instância antiga
        -- Pula conversas cujo contact_phone já existe na nova instância
        -- (evita unique constraint violation quando o mesmo contato aparece
        --  em múltiplas instâncias históricas do mesmo número)
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
              WHERE cc2.company_id   = NEW.company_id
                AND cc2.instance_id  = NEW.id
                AND cc2.contact_phone = chat_conversations.contact_phone
          );

        GET DIAGNOSTICS v_reassigned_count = ROW_COUNT;

        RAISE LOG '[trigger] reassign_conversations: instância % → % | conversas reatribuídas: %',
            v_old_instance.id, NEW.id, v_reassigned_count;
    END LOOP;

    RETURN NEW;
END;
$function$;
