-- =====================================================
-- WEBHOOK SYSTEM - RECEBIMENTO DE MENSAGENS UAZAPI
-- =====================================================
-- Sistema completo para processar webhooks da Uazapi
-- Mantém 100% de compatibilidade com sistema existente

-- =====================================================
-- 1. TABELA DE LOGS DE WEBHOOK
-- =====================================================

CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    instance_token TEXT,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_webhook_logs_instance_token ON webhook_logs(instance_token);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed ON webhook_logs(processed);

-- =====================================================
-- 2. FUNÇÃO PARA EXTRAIR NÚMERO LIMPO DO JID
-- =====================================================

CREATE OR REPLACE FUNCTION extract_phone_from_jid(jid TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Remove @s.whatsapp.net, @g.us, etc
    -- Extrai apenas os números
    RETURN regexp_replace(jid, '@.*$', '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- 3. FUNÇÃO PARA AUTO-CADASTRO DE CONTATOS
-- =====================================================

CREATE OR REPLACE FUNCTION auto_create_contact(
    p_company_id UUID,
    p_phone TEXT,
    p_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_contact_id UUID;
    v_clean_phone TEXT;
BEGIN
    -- Limpar telefone
    v_clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    
    -- Verificar se contato já existe
    SELECT id INTO v_contact_id
    FROM chat_contacts
    WHERE company_id = p_company_id 
    AND phone = v_clean_phone;
    
    -- Se não existe, criar novo
    IF v_contact_id IS NULL THEN
        INSERT INTO chat_contacts (
            company_id,
            phone,
            name,
            created_at,
            updated_at
        ) VALUES (
            p_company_id,
            v_clean_phone,
            COALESCE(p_name, 'Contato ' || v_clean_phone),
            NOW(),
            NOW()
        ) RETURNING id INTO v_contact_id;
    ELSE
        -- Atualizar nome se fornecido e diferente
        IF p_name IS NOT NULL AND p_name != '' THEN
            UPDATE chat_contacts 
            SET name = p_name, updated_at = NOW()
            WHERE id = v_contact_id 
            AND (name IS NULL OR name != p_name);
        END IF;
    END IF;
    
    RETURN v_contact_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. FUNÇÃO PARA BUSCAR/CRIAR CONVERSA
-- =====================================================

CREATE OR REPLACE FUNCTION get_or_create_conversation(
    p_company_id UUID,
    p_instance_id UUID,
    p_phone TEXT,
    p_contact_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_conversation_id UUID;
    v_contact_id UUID;
    v_clean_phone TEXT;
BEGIN
    -- Limpar telefone
    v_clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    
    -- Auto-criar/atualizar contato
    v_contact_id := auto_create_contact(p_company_id, v_clean_phone, p_contact_name);
    
    -- Buscar conversa existente
    SELECT id INTO v_conversation_id
    FROM chat_conversations
    WHERE company_id = p_company_id
    AND instance_id = p_instance_id
    AND contact_phone = v_clean_phone
    AND status = 'active';
    
    -- Se não existe, criar nova conversa
    IF v_conversation_id IS NULL THEN
        INSERT INTO chat_conversations (
            company_id,
            instance_id,
            contact_phone,
            contact_name,
            status,
            created_at,
            updated_at
        ) VALUES (
            p_company_id,
            p_instance_id,
            v_clean_phone,
            COALESCE(p_contact_name, 'Contato ' || v_clean_phone),
            'active',
            NOW(),
            NOW()
        ) RETURNING id INTO v_conversation_id;
    ELSE
        -- Atualizar nome do contato se fornecido
        IF p_contact_name IS NOT NULL AND p_contact_name != '' THEN
            UPDATE chat_conversations 
            SET contact_name = p_contact_name, updated_at = NOW()
            WHERE id = v_conversation_id;
        END IF;
    END IF;
    
    RETURN v_conversation_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. FUNÇÃO PRINCIPAL - PROCESSAR WEBHOOK UAZAPI
-- =====================================================

CREATE OR REPLACE FUNCTION process_uazapi_webhook(
    p_payload JSONB
) RETURNS JSONB AS $$
DECLARE
    v_event_type TEXT;
    v_instance_token TEXT;
    v_instance_id UUID;
    v_company_id UUID;
    v_message_data JSONB;
    v_remote_jid TEXT;
    v_clean_phone TEXT;
    v_from_me BOOLEAN;
    v_message_content TEXT;
    v_contact_name TEXT;
    v_conversation_id UUID;
    v_message_id UUID;
    v_webhook_log_id UUID;
    v_result JSONB;
BEGIN
    -- Log do webhook recebido
    INSERT INTO webhook_logs (event_type, payload, created_at)
    VALUES (
        COALESCE(p_payload->>'event', 'unknown'),
        p_payload,
        NOW()
    ) RETURNING id INTO v_webhook_log_id;

    -- Extrair dados básicos
    v_event_type := p_payload->>'event';
    v_instance_token := p_payload->>'instance_id';
    
    -- Validar se é evento de mensagem
    IF v_event_type != 'messages' THEN
        UPDATE webhook_logs 
        SET processed = TRUE, processed_at = NOW(), error_message = 'Event type not supported: ' || v_event_type
        WHERE id = v_webhook_log_id;
        
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Event type not supported',
            'event_type', v_event_type
        );
    END IF;
    
    -- Validar instância existe no sistema
    SELECT wli.id, wli.company_id INTO v_instance_id, v_company_id
    FROM whatsapp_life_instances wli
    WHERE wli.instance_token = v_instance_token
    AND wli.status = 'connected';
    
    IF v_instance_id IS NULL THEN
        UPDATE webhook_logs 
        SET processed = TRUE, processed_at = NOW(), error_message = 'Instance not found or not connected: ' || v_instance_token
        WHERE id = v_webhook_log_id;
        
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Instance not found or not connected',
            'instance_token', v_instance_token
        );
    END IF;
    
    -- Extrair dados da mensagem
    v_message_data := p_payload->'data';
    v_remote_jid := v_message_data->'key'->>'remoteJid';
    v_from_me := COALESCE((v_message_data->'key'->>'fromMe')::BOOLEAN, false);
    v_contact_name := v_message_data->>'pushName';
    
    -- Processar apenas mensagens recebidas (não enviadas por nós)
    IF v_from_me = true THEN
        UPDATE webhook_logs 
        SET processed = TRUE, processed_at = NOW(), error_message = 'Message sent by us, ignoring'
        WHERE id = v_webhook_log_id;
        
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Message sent by us, ignoring'
        );
    END IF;
    
    -- Extrair número limpo
    v_clean_phone := extract_phone_from_jid(v_remote_jid);
    
    -- Extrair conteúdo da mensagem
    v_message_content := COALESCE(
        v_message_data->'message'->>'conversation',
        v_message_data->'message'->'extendedTextMessage'->>'text',
        '[Mídia]'
    );
    
    -- Buscar/criar conversa
    v_conversation_id := get_or_create_conversation(
        v_company_id,
        v_instance_id,
        v_clean_phone,
        v_contact_name
    );
    
    -- Inserir mensagem
    INSERT INTO chat_messages (
        conversation_id,
        content,
        direction,
        status,
        message_type,
        external_id,
        metadata,
        created_at
    ) VALUES (
        v_conversation_id,
        v_message_content,
        'inbound',
        'delivered',
        'text',
        v_message_data->'key'->>'id',
        jsonb_build_object(
            'uazapi_data', v_message_data,
            'contact_name', v_contact_name,
            'remote_jid', v_remote_jid
        ),
        to_timestamp((v_message_data->>'messageTimestamp')::BIGINT)
    ) RETURNING id INTO v_message_id;
    
    -- Atualizar conversa com última mensagem
    UPDATE chat_conversations SET
        last_message_at = to_timestamp((v_message_data->>'messageTimestamp')::BIGINT),
        last_message_content = v_message_content,
        last_message_direction = 'inbound',
        unread_count = unread_count + 1,
        updated_at = NOW()
    WHERE id = v_conversation_id;
    
    -- Atualizar contato com última atividade
    UPDATE chat_contacts SET
        last_activity_at = NOW(),
        updated_at = NOW()
    WHERE company_id = v_company_id 
    AND phone = v_clean_phone;
    
    -- Marcar webhook como processado
    UPDATE webhook_logs 
    SET processed = TRUE, processed_at = NOW(), instance_token = v_instance_token
    WHERE id = v_webhook_log_id;
    
    -- Resultado de sucesso
    v_result := jsonb_build_object(
        'success', true,
        'message', 'Message processed successfully',
        'conversation_id', v_conversation_id,
        'message_id', v_message_id,
        'phone', v_clean_phone,
        'contact_name', v_contact_name
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    -- Log do erro
    UPDATE webhook_logs 
    SET processed = TRUE, processed_at = NOW(), error_message = SQLERRM
    WHERE id = v_webhook_log_id;
    
    -- Retornar erro
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Error processing webhook',
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. FUNÇÃO PARA ENDPOINT HTTP (EDGE FUNCTION)
-- =====================================================

CREATE OR REPLACE FUNCTION handle_uazapi_webhook_http(
    p_method TEXT,
    p_headers JSONB,
    p_body TEXT
) RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_result JSONB;
BEGIN
    -- Validar método
    IF p_method != 'POST' THEN
        RETURN jsonb_build_object(
            'status', 405,
            'body', jsonb_build_object('error', 'Method not allowed')
        );
    END IF;
    
    -- Parse do JSON
    BEGIN
        v_payload := p_body::JSONB;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'status', 400,
            'body', jsonb_build_object('error', 'Invalid JSON payload')
        );
    END;
    
    -- Processar webhook
    v_result := process_uazapi_webhook(v_payload);
    
    -- Retornar resposta
    IF v_result->>'success' = 'true' THEN
        RETURN jsonb_build_object(
            'status', 200,
            'body', v_result
        );
    ELSE
        RETURN jsonb_build_object(
            'status', 400,
            'body', v_result
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. POLÍTICAS RLS (ROW LEVEL SECURITY)
-- =====================================================

-- Webhook logs - apenas admin
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_logs_admin_only" ON webhook_logs
FOR ALL USING (false); -- Apenas via RPC functions

-- =====================================================
-- 8. GRANTS E PERMISSÕES
-- =====================================================

-- Permitir acesso às funções
GRANT EXECUTE ON FUNCTION process_uazapi_webhook(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION handle_uazapi_webhook_http(TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION extract_phone_from_jid(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_create_contact(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_conversation(UUID, UUID, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE webhook_logs IS 'Log de todos os webhooks recebidos da Uazapi para auditoria e debug';
COMMENT ON FUNCTION process_uazapi_webhook(JSONB) IS 'Função principal para processar webhooks da Uazapi - auto-cadastra contatos e salva mensagens';
COMMENT ON FUNCTION extract_phone_from_jid(TEXT) IS 'Extrai número limpo do JID do WhatsApp (remove @s.whatsapp.net)';
COMMENT ON FUNCTION auto_create_contact(UUID, TEXT, TEXT) IS 'Auto-cadastra contatos quando recebe mensagem de número desconhecido';
COMMENT ON FUNCTION get_or_create_conversation(UUID, UUID, TEXT, TEXT) IS 'Busca conversa existente ou cria nova automaticamente';
