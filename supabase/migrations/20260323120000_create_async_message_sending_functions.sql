-- =====================================================
-- MIGRATION: ASYNC MESSAGE SENDING
-- Data: 23/03/2026
-- Objetivo: Refatorar envio de mensagens para processamento assíncrono
-- Eliminar timeout SQL causado por HTTP síncrono
-- =====================================================

-- =====================================================
-- FUNÇÃO 1: PREPARAR MENSAGEM PARA ENVIO (SÍNCRONA - RÁPIDA)
-- =====================================================
-- Valida e prepara dados da mensagem sem fazer HTTP
-- Retorna todos os dados necessários para envio externo
-- =====================================================

CREATE OR REPLACE FUNCTION public.prepare_message_for_sending(
  p_message_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_message RECORD;
    v_conversation RECORD;
    v_instance RECORD;
    v_phone_formatted TEXT;
    v_result JSONB;
BEGIN
    -- Buscar dados da mensagem
    SELECT 
        cm.id,
        cm.conversation_id,
        cm.company_id,
        cm.instance_id,
        cm.message_type,
        cm.content,
        cm.media_url,
        cm.status,
        cm.direction
    INTO v_message
    FROM chat_messages cm
    WHERE cm.id = p_message_id 
      AND cm.company_id = p_company_id
      AND cm.direction = 'outbound'
      AND cm.status IN ('draft', 'sending');

    -- Validar se mensagem existe e pode ser enviada
    IF v_message.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Mensagem não encontrada ou não pode ser enviada',
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
    WHERE cc.id = v_message.conversation_id
      AND cc.company_id = p_company_id;

    IF v_conversation.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Conversa não encontrada',
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
    WHERE wli.id = v_message.instance_id
      AND wli.company_id = p_company_id
      AND wli.status = 'connected';

    IF v_instance.id IS NULL THEN
        -- Atualizar status da mensagem para falha
        UPDATE chat_messages 
        SET status = 'failed',
            updated_at = NOW()
        WHERE id = p_message_id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância WhatsApp não encontrada ou não conectada',
            'instance_id', v_message.instance_id
        );
    END IF;

    -- Atualizar status para 'sending'
    UPDATE chat_messages 
    SET status = 'sending',
        updated_at = NOW()
    WHERE id = p_message_id;

    -- Formatar telefone para Uazapi (formato internacional sem +)
    v_phone_formatted := format_phone_for_uazapi(v_conversation.contact_phone);

    -- Preparar dados para envio externo (SEM fazer HTTP)
    v_result := jsonb_build_object(
        'success', true,
        'message_id', p_message_id,
        'message_type', v_message.message_type,
        'content', v_message.content,
        'media_url', v_message.media_url,
        'phone', v_phone_formatted,
        'contact_name', v_conversation.contact_name,
        'instance_id', v_instance.id,
        'instance_name', v_instance.instance_name,
        'provider_token', v_instance.provider_token,
        'provider_instance_id', v_instance.provider_instance_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- Erro geral - garantir que mensagem não fique em 'sending'
    UPDATE chat_messages 
    SET status = 'failed',
        updated_at = NOW()
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
        'success', false,
        'message', 'Erro interno no processamento de envio',
        'message_id', p_message_id,
        'error', SQLERRM
    );
END;
$$;

-- =====================================================
-- FUNÇÃO 2: ATUALIZAR STATUS DA MENSAGEM (SÍNCRONA - RÁPIDA)
-- =====================================================
-- Atualiza status após envio externo
-- Chamada após resposta do Uazapi
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_message_status(
  p_message_id uuid,
  p_status text,
  p_uazapi_message_id text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    -- Validar status
    IF p_status NOT IN ('sent', 'failed', 'delivered', 'read') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Status inválido: ' || p_status
        );
    END IF;

    -- Atualizar mensagem
    UPDATE chat_messages 
    SET 
        status = p_status,
        uazapi_message_id = COALESCE(p_uazapi_message_id, uazapi_message_id),
        updated_at = NOW()
    WHERE id = p_message_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Mensagem não encontrada',
            'message_id', p_message_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message_id', p_message_id,
        'status', p_status,
        'uazapi_message_id', p_uazapi_message_id,
        'updated_at', NOW()
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message_id', p_message_id,
        'error', SQLERRM
    );
END;
$$;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION public.prepare_message_for_sending(uuid, uuid) IS 
'Prepara mensagem para envio assíncrono. Valida dados e retorna informações necessárias para envio externo via Node.js. NÃO faz requisição HTTP, evitando timeout SQL.';

COMMENT ON FUNCTION public.update_message_status(uuid, text, text, text) IS 
'Atualiza status da mensagem após envio externo. Chamada pelo Node.js após resposta do Uazapi.';

-- =====================================================
-- GRANTS (Segurança)
-- =====================================================

-- Permitir execução via service role (API)
GRANT EXECUTE ON FUNCTION public.prepare_message_for_sending(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_message_status(uuid, text, text, text) TO service_role;

-- Permitir execução via anon (frontend autenticado via RLS)
GRANT EXECUTE ON FUNCTION public.prepare_message_for_sending(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.update_message_status(uuid, text, text, text) TO anon;
