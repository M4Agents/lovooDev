-- =====================================================
-- TRIGGER: Reatribuir conversas ao reconectar instância WhatsApp
-- Data: 14/04/2026
-- Motivo: Quando uma instância é deletada e uma nova é criada com o mesmo
--         número de telefone, as conversas anteriores devem ser reatribuídas
--         automaticamente à nova instância, sem intervenção manual.
-- =====================================================

CREATE OR REPLACE FUNCTION public.reassign_conversations_on_instance_reconnect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        UPDATE chat_conversations
        SET
            instance_id        = NEW.id,
            last_instance_id   = NEW.id,
            last_instance_name = NEW.instance_name,
            updated_at         = NOW()
        WHERE instance_id = v_old_instance.id
           OR last_instance_id = v_old_instance.id;

        GET DIAGNOSTICS v_reassigned_count = ROW_COUNT;

        RAISE LOG '[trigger] reassign_conversations: instância % → % | conversas reatribuídas: %',
            v_old_instance.id, NEW.id, v_reassigned_count;
    END LOOP;

    RETURN NEW;
END;
$$;

-- =====================================================
-- TRIGGER: dispara após qualquer INSERT na tabela
-- =====================================================
DROP TRIGGER IF EXISTS trg_reassign_conversations_on_instance_reconnect
    ON whatsapp_life_instances;

CREATE TRIGGER trg_reassign_conversations_on_instance_reconnect
    AFTER INSERT ON whatsapp_life_instances
    FOR EACH ROW
    EXECUTE FUNCTION public.reassign_conversations_on_instance_reconnect();

COMMENT ON FUNCTION public.reassign_conversations_on_instance_reconnect() IS
'Trigger: ao inserir nova instância WhatsApp com phone_number preenchido, reatribui automaticamente todas as chat_conversations que apontavam para instâncias deletadas do mesmo número/empresa.';
