-- =====================================================
-- MIGRATION: Corrigir trigger de reatribuição de conversas
-- Data: 31/07/2026
-- Motivo: O trigger original (AFTER INSERT) sempre encontrava
--         phone_number = NULL porque o número só é definido
--         via UPDATE após a instância conectar. Adicionando um
--         segundo trigger (AFTER UPDATE OF phone_number) para
--         cobrir esse cenário.
-- =====================================================

-- Trigger que dispara quando phone_number é preenchido pela
-- primeira vez (NULL → valor) em uma instância ativa (não deletada).
-- Reutiliza a mesma função já consolidada.
DROP TRIGGER IF EXISTS trg_reassign_conversations_on_phone_set
    ON whatsapp_life_instances;

CREATE TRIGGER trg_reassign_conversations_on_phone_set
    AFTER UPDATE OF phone_number ON whatsapp_life_instances
    FOR EACH ROW
    WHEN (
        OLD.phone_number IS NULL
        AND NEW.phone_number IS NOT NULL
        AND NEW.phone_number != ''
        AND NEW.deleted_at IS NULL
    )
    EXECUTE FUNCTION public.reassign_conversations_on_instance_reconnect();

COMMENT ON TRIGGER trg_reassign_conversations_on_phone_set ON whatsapp_life_instances IS
'Complementa trg_reassign_conversations_on_instance_reconnect: dispara quando phone_number '
'é preenchido pela primeira vez via UPDATE (fluxo de reconexão), '
'reatribuindo conversas de instâncias deletadas com o mesmo número.';
