-- =====================================================================
-- Migration: Atualizar prepare_message_for_sending para retornar reply_to_uazapi_message_id
-- Data: 2026-05-06
--
-- Objetivo:
--   Quando uma mensagem outbound é uma resposta (reply_to_message_id IS NOT NULL),
--   retornar o uazapi_message_id da mensagem original para que o backend
--   possa incluir replyid no payload do Uazapi.
--
-- Estratégia:
--   LEFT JOIN em chat_messages para obter uazapi_message_id da mensagem referenciada.
--   Se a mensagem original não tiver uazapi_message_id, retorna NULL (envio normal).
--
-- Compatibilidade retroativa:
--   O campo reply_to_uazapi_message_id é novo no retorno — clientes existentes ignoram.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.prepare_message_for_sending(
  p_message_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_message      RECORD;
    v_conversation RECORD;
    v_instance     RECORD;
    v_phone_formatted          TEXT;
    v_reply_uazapi_message_id  TEXT;
    v_result       JSONB;
BEGIN
    -- Buscar dados da mensagem + uazapi_message_id da mensagem original (se reply)
    SELECT
        cm.id,
        cm.conversation_id,
        cm.company_id,
        cm.instance_id,
        cm.message_type,
        cm.content,
        cm.media_url,
        cm.status,
        cm.direction,
        cm.reply_to_message_id,
        rm.uazapi_message_id AS reply_uazapi_message_id
    INTO v_message
    FROM chat_messages cm
    LEFT JOIN chat_messages rm
      ON rm.id         = cm.reply_to_message_id
     AND rm.company_id = cm.company_id
    WHERE cm.id          = p_message_id
      AND cm.company_id  = p_company_id
      AND cm.direction   = 'outbound'
      AND cm.status IN ('draft', 'sending');

    IF v_message.id IS NULL THEN
        RETURN jsonb_build_object(
            'success',    false,
            'error',      'Mensagem não encontrada ou não pode ser enviada',
            'message_id', p_message_id
        );
    END IF;

    -- Buscar dados da conversa
    SELECT
        cc.id,
        cc.contact_phone,
        cc.contact_name,
        cc.instance_id
    INTO v_conversation
    FROM chat_conversations cc
    WHERE cc.id        = v_message.conversation_id
      AND cc.company_id = p_company_id;

    IF v_conversation.id IS NULL THEN
        RETURN jsonb_build_object(
            'success',         false,
            'error',           'Conversa não encontrada',
            'conversation_id', v_message.conversation_id
        );
    END IF;

    -- Buscar dados da instância WhatsApp
    SELECT
        wli.id,
        wli.provider_instance_id,
        wli.provider_token,
        wli.status,
        wli.instance_name
    INTO v_instance
    FROM whatsapp_life_instances wli
    WHERE wli.id         = v_message.instance_id
      AND wli.company_id = p_company_id
      AND wli.status     = 'connected';

    IF v_instance.id IS NULL THEN
        UPDATE chat_messages
        SET status = 'failed', updated_at = NOW()
        WHERE id = p_message_id;

        RETURN jsonb_build_object(
            'success',     false,
            'error',       'Instância WhatsApp não encontrada ou não conectada',
            'instance_id', v_message.instance_id
        );
    END IF;

    -- Atualizar status para 'sending'
    UPDATE chat_messages
    SET status = 'sending', updated_at = NOW()
    WHERE id = p_message_id;

    -- Formatar telefone para Uazapi (formato internacional sem +)
    v_phone_formatted := format_phone_for_uazapi(v_conversation.contact_phone);

    v_result := jsonb_build_object(
        'success',                    true,
        'message_id',                 p_message_id,
        'message_type',               v_message.message_type,
        'content',                    v_message.content,
        'media_url',                  v_message.media_url,
        'phone',                      v_phone_formatted,
        'contact_name',               v_conversation.contact_name,
        'instance_id',                v_instance.id,
        'instance_name',              v_instance.instance_name,
        'provider_token',             v_instance.provider_token,
        'provider_instance_id',       v_instance.provider_instance_id,
        'reply_to_message_id',        v_message.reply_to_message_id,
        'reply_to_uazapi_message_id', v_message.reply_uazapi_message_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    UPDATE chat_messages
    SET status = 'failed', updated_at = NOW()
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
        'success',    false,
        'message',    'Erro interno no processamento de envio',
        'message_id', p_message_id,
        'error',      SQLERRM
    );
END;
$$;
