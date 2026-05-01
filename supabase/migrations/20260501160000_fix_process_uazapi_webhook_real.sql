-- =====================================================================
-- Fase 4: Corrige public.process_uazapi_webhook_real(jsonb)
-- =====================================================================
-- Correções aplicadas:
--   1. SET search_path = 'public' (proteção search_path injection)
--   2. v_new_status movido para DECLARE externo (bug de escopo)
--   3. deleted_at IS NULL nos dois lookups de whatsapp_life_instances
--   4. company_id = v_company_id na deduplicação de chat_messages
--   5. REVOKE EXECUTE FROM PUBLIC (grants a anon/authenticated/service_role mantidos)
--
-- ROLLBACK COMPLETO (restaura estado anterior exato):
-- --------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.process_uazapi_webhook_real(p_payload jsonb)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
-- AS $function$
-- DECLARE
--     v_instance_id UUID;
--     v_company_id UUID;
--     v_event_type TEXT;
--     v_message_type TEXT;
--     v_is_group BOOLEAN;
--     v_from_me BOOLEAN;
--     v_was_sent_by_api BOOLEAN;
--     v_sender TEXT;
--     v_sender_name TEXT;
--     v_message_text TEXT;
--     v_message_id TEXT;
--     v_timestamp BIGINT;
--     v_phone_number TEXT;
--     v_contact_id UUID;
--     v_conversation_id UUID;
--     v_chat_message_id UUID;
--     v_final_message_type TEXT;
--     v_provider_instance_id TEXT;
--     v_status TEXT;
--     v_old_status TEXT;
-- BEGIN
--     v_event_type := p_payload->>'EventType';
--     RAISE NOTICE 'Webhook recebido - EventType: %', v_event_type;
--     IF v_event_type IN ('status', 'connection', 'qr', 'connection.update') THEN
--         v_provider_instance_id := p_payload->>'instanceId';
--         v_status := p_payload->>'status';
--         SELECT id, status, company_id INTO v_instance_id, v_old_status, v_company_id
--         FROM whatsapp_life_instances
--         WHERE provider_instance_id = v_provider_instance_id
--            OR provider_token = (p_payload->>'token')
--         LIMIT 1;
--         IF v_instance_id IS NULL THEN
--             RETURN jsonb_build_object('success', false, 'message', 'Instance not found for status event', 'provider_instance_id', v_provider_instance_id);
--         END IF;
--         DECLARE v_new_status TEXT; BEGIN
--             CASE v_status
--                 WHEN 'open' THEN v_new_status := 'connected';
--                 WHEN 'close' THEN v_new_status := 'disconnected';
--                 WHEN 'connecting' THEN v_new_status := 'connecting';
--                 WHEN 'qr' THEN v_new_status := 'qr_pending';
--                 WHEN 'disconnected' THEN v_new_status := 'disconnected';
--                 WHEN 'connected' THEN v_new_status := 'connected';
--                 ELSE v_new_status := 'disconnected';
--             END CASE;
--         END;
--         IF v_old_status != v_new_status THEN
--             UPDATE whatsapp_life_instances SET status = v_new_status, updated_at = NOW(),
--                 connected_at = CASE WHEN v_new_status = 'connected' THEN NOW() ELSE connected_at END
--             WHERE id = v_instance_id;
--         END IF;
--         RETURN jsonb_build_object('success', true, 'message', 'Status event processed',
--             'event_type', v_event_type, 'instance_id', v_instance_id,
--             'old_status', v_old_status, 'new_status', v_new_status);
--     END IF;
--     ... (corpo de mensagens idêntico ao atual) ...
-- END; $function$;
-- GRANT EXECUTE ON FUNCTION public.process_uazapi_webhook_real(jsonb) TO PUBLIC;
-- =====================================================================

CREATE OR REPLACE FUNCTION public.process_uazapi_webhook_real(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'  -- FIX 1: previne search_path injection
AS $function$
DECLARE
    v_instance_id          UUID;
    v_company_id           UUID;
    v_event_type           TEXT;
    v_message_type         TEXT;
    v_is_group             BOOLEAN;
    v_from_me              BOOLEAN;
    v_was_sent_by_api      BOOLEAN;
    v_sender               TEXT;
    v_sender_name          TEXT;
    v_message_text         TEXT;
    v_message_id           TEXT;
    v_timestamp            BIGINT;
    v_phone_number         TEXT;
    v_contact_id           UUID;
    v_conversation_id      UUID;
    v_chat_message_id      UUID;
    v_final_message_type   TEXT;
    v_provider_instance_id TEXT;
    v_status               TEXT;
    v_old_status           TEXT;
    v_new_status           TEXT;  -- FIX 2: movido do bloco interno para DECLARE externo
BEGIN
    -- Extrair event type
    v_event_type := p_payload->>'EventType';

    RAISE NOTICE 'Webhook recebido - EventType: %', v_event_type;

    -- =====================================================
    -- PROCESSAR EVENTOS DE STATUS/CONEXÃO
    -- =====================================================
    IF v_event_type IN ('status', 'connection', 'qr', 'connection.update') THEN
        v_provider_instance_id := p_payload->>'instanceId';
        v_status               := p_payload->>'status';

        -- FIX 3: added deleted_at IS NULL
        SELECT id, status, company_id
        INTO v_instance_id, v_old_status, v_company_id
        FROM whatsapp_life_instances
        WHERE (
            provider_instance_id = v_provider_instance_id
            OR provider_token = (p_payload->>'token')
        )
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_instance_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Instance not found for status event',
                'provider_instance_id', v_provider_instance_id
            );
        END IF;

        -- Mapear status da uazapi para nosso sistema
        -- FIX 2: CASE agora usa v_new_status do DECLARE externo (sem bloco aninhado)
        CASE v_status
            WHEN 'open'         THEN v_new_status := 'connected';
            WHEN 'close'        THEN v_new_status := 'disconnected';
            WHEN 'connecting'   THEN v_new_status := 'connecting';
            WHEN 'qr'           THEN v_new_status := 'qr_pending';
            WHEN 'disconnected' THEN v_new_status := 'disconnected';
            WHEN 'connected'    THEN v_new_status := 'connected';
            ELSE                     v_new_status := 'disconnected';
        END CASE;

        -- Atualizar status apenas se mudou
        IF v_old_status != v_new_status THEN
            UPDATE whatsapp_life_instances
            SET
                status       = v_new_status,
                updated_at   = NOW(),
                connected_at = CASE
                    WHEN v_new_status = 'connected' THEN NOW()
                    ELSE connected_at
                END
            WHERE id = v_instance_id;

            RAISE NOTICE 'Status atualizado: % -> % (instância: %)', v_old_status, v_new_status, v_instance_id;
        END IF;

        RETURN jsonb_build_object(
            'success',    true,
            'message',    'Status event processed',
            'event_type', v_event_type,
            'instance_id', v_instance_id,
            'old_status', v_old_status,
            'new_status', v_new_status  -- FIX 2: variável agora acessível aqui
        );
    END IF;

    -- =====================================================
    -- PROCESSAR EVENTOS DE MENSAGENS
    -- =====================================================
    IF v_event_type != 'messages' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Event type not supported: ' || v_event_type);
    END IF;

    -- Extrair dados da mensagem
    v_message_type    := LOWER(p_payload->'message'->>'messageType');
    v_is_group        := (p_payload->'message'->>'isGroup')::BOOLEAN;
    v_from_me         := (p_payload->'message'->>'fromMe')::BOOLEAN;
    v_was_sent_by_api := (p_payload->'message'->>'wasSentByApi')::BOOLEAN;
    v_sender          := p_payload->'message'->>'sender';
    v_sender_name     := p_payload->'message'->>'senderName';
    v_message_text    := COALESCE(p_payload->'message'->>'text', p_payload->'message'->>'content');
    v_message_id      := p_payload->'message'->>'id';
    v_timestamp       := (p_payload->'message'->>'messageTimestamp')::BIGINT;

    -- Filtros de validação
    IF v_from_me = true OR v_was_sent_by_api = true THEN
        RETURN jsonb_build_object('success', false, 'message', 'Message sent by API - ignored to prevent loops');
    END IF;

    IF v_is_group = true THEN
        RETURN jsonb_build_object('success', false, 'message', 'Group messages ignored for now');
    END IF;

    IF v_message_type NOT IN ('conversation', 'extendedtextmessage', 'textmessage') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Message type not supported: ' || v_message_type);
    END IF;

    -- FIX 3: added deleted_at IS NULL
    SELECT id, company_id
    INTO v_instance_id, v_company_id
    FROM whatsapp_life_instances
    WHERE provider_token = (p_payload->>'token')
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_instance_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Instance not found for token');
    END IF;

    -- Extrair número do telefone
    v_phone_number := REGEXP_REPLACE(v_sender, '@.*$', '');

    IF LENGTH(v_phone_number) < 10 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid phone number: ' || v_phone_number);
    END IF;

    -- Mapear message_type
    CASE v_message_type
        WHEN 'conversation'        THEN v_final_message_type := 'text';
        WHEN 'extendedtextmessage' THEN v_final_message_type := 'text';
        WHEN 'textmessage'         THEN v_final_message_type := 'text';
        WHEN 'imagemessage'        THEN v_final_message_type := 'image';
        WHEN 'documentmessage'     THEN v_final_message_type := 'document';
        WHEN 'audiomessage'        THEN v_final_message_type := 'audio';
        WHEN 'videomessage'        THEN v_final_message_type := 'video';
        ELSE                            v_final_message_type := 'text';
    END CASE;

    -- Buscar ou criar contato
    SELECT id INTO v_contact_id
    FROM chat_contacts
    WHERE phone_number = v_phone_number AND company_id = v_company_id;

    IF v_contact_id IS NULL THEN
        INSERT INTO chat_contacts (
            phone_number, name, company_id, lead_source, created_at, updated_at
        ) VALUES (
            v_phone_number,
            COALESCE(v_sender_name, 'Contato ' || v_phone_number),
            v_company_id, 'whatsapp_webhook', NOW(), NOW()
        ) RETURNING id INTO v_contact_id;
    END IF;

    -- Buscar ou criar conversa
    SELECT id INTO v_conversation_id
    FROM chat_conversations
    WHERE contact_phone = v_phone_number AND company_id = v_company_id;

    IF v_conversation_id IS NULL THEN
        INSERT INTO chat_conversations (
            contact_phone, company_id, instance_id, status, created_at, updated_at
        ) VALUES (
            v_phone_number, v_company_id, v_instance_id, 'active', NOW(), NOW()
        ) RETURNING id INTO v_conversation_id;
    END IF;

    -- FIX 4: deduplicação agora filtra por company_id (isolamento multi-tenant)
    SELECT id INTO v_chat_message_id
    FROM chat_messages
    WHERE uazapi_message_id = v_message_id
      AND company_id = v_company_id;

    IF v_chat_message_id IS NULL THEN
        INSERT INTO chat_messages (
            conversation_id, company_id, instance_id, uazapi_message_id,
            content, message_type, direction, status, timestamp, created_at
        ) VALUES (
            v_conversation_id, v_company_id, v_instance_id, v_message_id,
            v_message_text, v_final_message_type, 'inbound',
            'delivered', TO_TIMESTAMP(v_timestamp / 1000.0), NOW()
        ) RETURNING id INTO v_chat_message_id;
    END IF;

    RETURN jsonb_build_object(
        'success',         true,
        'message',         'Message processed successfully',
        'phone',           v_phone_number,
        'sender_name',     v_sender_name,
        'contact_id',      v_contact_id,
        'conversation_id', v_conversation_id,
        'message_id',      v_chat_message_id,
        'instance_id',     v_instance_id,
        'company_id',      v_company_id
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Error processing webhook',
        'error',   SQLERRM
    );
END;
$function$;

-- FIX 5: remover grant a PUBLIC (anon/authenticated/service_role mantêm grants explícitos)
REVOKE EXECUTE ON FUNCTION public.process_uazapi_webhook_real(jsonb) FROM PUBLIC;
