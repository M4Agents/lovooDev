-- =====================================================
-- MIGRAÇÃO 004: SISTEMA WEBHOOK UAZAPI AUTOMAÇÃO SAAS
-- =====================================================
-- Data: 2025-11-18
-- Descrição: Sistema completo de automação webhook para plataforma SaaS
-- Funcionalidades: Configuração automática, processamento mensagens, monitoramento

-- =====================================================
-- 1. HABILITAR EXTENSÃO HTTP
-- =====================================================

-- Extensão para fazer requisições HTTP automaticamente
CREATE EXTENSION IF NOT EXISTS http;

-- =====================================================
-- 2. TABELA DE CONTROLE DE WEBHOOKS
-- =====================================================

CREATE TABLE IF NOT EXISTS instance_webhook_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES whatsapp_life_instances(id) ON DELETE CASCADE,
    webhook_url TEXT NOT NULL,
    configured_at TIMESTAMP WITH TIME ZONE,
    last_test_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_instance_webhook_configs_instance_id ON instance_webhook_configs(instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_webhook_configs_status ON instance_webhook_configs(status);

-- Constraint única
ALTER TABLE instance_webhook_configs 
ADD CONSTRAINT IF NOT EXISTS unique_instance_webhook UNIQUE (instance_id);

-- RLS
ALTER TABLE instance_webhook_configs ENABLE ROW LEVEL SECURITY;

-- Política de isolamento por empresa
DROP POLICY IF EXISTS "instance_webhook_configs_company_isolation" ON instance_webhook_configs;
CREATE POLICY "instance_webhook_configs_company_isolation" ON instance_webhook_configs
FOR ALL USING (
    instance_id IN (
        SELECT id FROM whatsapp_life_instances 
        WHERE company_id = (SELECT company_id FROM companies WHERE user_id = auth.uid())
    )
);

-- =====================================================
-- 3. FUNÇÃO PARA ATUALIZAR UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_instance_webhook_configs_updated_at ON instance_webhook_configs;
CREATE TRIGGER update_instance_webhook_configs_updated_at
    BEFORE UPDATE ON instance_webhook_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. FUNÇÃO DE PROCESSAMENTO WEBHOOK (NOVO FORMATO)
-- =====================================================

CREATE OR REPLACE FUNCTION process_uazapi_webhook(
    p_payload JSONB
) RETURNS JSONB AS $$
DECLARE
    v_instance_id TEXT;
    v_from TEXT;
    v_to TEXT;
    v_message_id TEXT;
    v_message_body TEXT;
    v_message_type TEXT;
    v_timestamp BIGINT;
    v_message_time TIMESTAMP WITH TIME ZONE;
    
    v_db_instance_id UUID;
    v_company_id UUID;
    v_conversation_id UUID;
    v_db_message_id UUID;
    v_contact_id UUID;
    
    v_clean_phone TEXT;
    v_contact_name TEXT;
    v_result JSONB;
BEGIN
    -- Extrair dados do novo formato Uazapi
    v_instance_id := p_payload->>'instanceId';
    v_from := p_payload->>'from';
    v_to := p_payload->>'to';
    v_message_id := p_payload->'message'->>'id';
    v_message_body := p_payload->'message'->>'body';
    v_message_type := p_payload->'message'->>'type';
    v_timestamp := (p_payload->'message'->>'timestamp')::BIGINT;
    
    -- Converter timestamp para datetime
    v_message_time := to_timestamp(v_timestamp);
    
    -- Validar se temos dados mínimos
    IF v_instance_id IS NULL OR v_from IS NULL OR v_message_body IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Missing required fields',
            'received_data', p_payload
        );
    END IF;
    
    -- Buscar instância no sistema usando provider_instance_id
    SELECT wli.id, wli.company_id INTO v_db_instance_id, v_company_id
    FROM whatsapp_life_instances wli
    WHERE wli.provider_instance_id = v_instance_id
    AND wli.status = 'connected';
    
    IF v_db_instance_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Instance not found or not connected',
            'instance_id', v_instance_id
        );
    END IF;
    
    -- Extrair número limpo (remover @c.us, @s.whatsapp.net)
    v_clean_phone := regexp_replace(v_from, '@.*$', '');
    v_clean_phone := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
    
    -- Buscar ou criar contato
    SELECT id INTO v_contact_id
    FROM chat_contacts
    WHERE company_id = v_company_id 
    AND phone_number = v_clean_phone;
    
    IF v_contact_id IS NULL THEN
        INSERT INTO chat_contacts (
            company_id,
            phone_number,
            name,
            lead_source,
            first_contact_at,
            last_activity_at,
            created_at,
            updated_at
        ) VALUES (
            v_company_id,
            v_clean_phone,
            'Contato ' || v_clean_phone,
            'whatsapp_webhook',
            v_message_time,
            v_message_time,
            NOW(),
            NOW()
        ) RETURNING id INTO v_contact_id;
    ELSE
        -- Atualizar última atividade
        UPDATE chat_contacts 
        SET last_activity_at = v_message_time,
            total_messages = total_messages + 1,
            updated_at = NOW()
        WHERE id = v_contact_id;
    END IF;
    
    -- Buscar ou criar conversa
    SELECT id INTO v_conversation_id
    FROM chat_conversations
    WHERE company_id = v_company_id
    AND instance_id = v_db_instance_id
    AND contact_phone = v_clean_phone
    AND status = 'active';
    
    IF v_conversation_id IS NULL THEN
        INSERT INTO chat_conversations (
            company_id,
            instance_id,
            contact_phone,
            contact_name,
            status,
            unread_count,
            created_at,
            updated_at
        ) VALUES (
            v_company_id,
            v_db_instance_id,
            v_clean_phone,
            'Contato ' || v_clean_phone,
            'active',
            0,
            NOW(),
            NOW()
        ) RETURNING id INTO v_conversation_id;
    END IF;
    
    -- Verificar se mensagem já existe (evitar duplicatas)
    SELECT id INTO v_db_message_id
    FROM chat_messages
    WHERE uazapi_message_id = v_message_id
    AND conversation_id = v_conversation_id;
    
    IF v_db_message_id IS NULL THEN
        -- Inserir nova mensagem
        INSERT INTO chat_messages (
            conversation_id,
            company_id,
            instance_id,
            content,
            direction,
            status,
            message_type,
            uazapi_message_id,
            timestamp,
            created_at,
            updated_at
        ) VALUES (
            v_conversation_id,
            v_company_id,
            v_db_instance_id,
            v_message_body,
            'inbound',
            'delivered',
            CASE 
                WHEN v_message_type = 'chat' THEN 'text'
                WHEN v_message_type = 'ptt' THEN 'audio'
                WHEN v_message_type = 'image' THEN 'image'
                WHEN v_message_type = 'video' THEN 'video'
                ELSE 'text'
            END,
            v_message_id,
            v_message_time,
            NOW(),
            NOW()
        ) RETURNING id INTO v_db_message_id;
        
        -- Atualizar conversa com última mensagem
        UPDATE chat_conversations SET
            last_message_at = v_message_time,
            last_message_content = v_message_body,
            last_message_direction = 'inbound',
            unread_count = unread_count + 1,
            updated_at = NOW()
        WHERE id = v_conversation_id;
    END IF;
    
    -- Resultado de sucesso
    v_result := jsonb_build_object(
        'success', true,
        'message', 'Message processed successfully',
        'conversation_id', v_conversation_id,
        'message_id', v_db_message_id,
        'contact_id', v_contact_id,
        'phone', v_clean_phone,
        'company_id', v_company_id,
        'instance_id', v_db_instance_id,
        'message_type', v_message_type,
        'timestamp', v_message_time
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    -- Retornar erro detalhado
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Error processing webhook',
        'error', SQLERRM,
        'payload', p_payload
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. FUNÇÃO DE CONFIGURAÇÃO AUTOMÁTICA WEBHOOK
-- =====================================================

CREATE OR REPLACE FUNCTION configure_webhook_automatically(
    p_instance_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_provider_token TEXT;
    v_provider_instance_id TEXT;
    v_company_id UUID;
    v_instance_name TEXT;
    v_webhook_url TEXT;
    v_http_response RECORD;
    v_config_id UUID;
    v_result JSONB;
    v_request_payload TEXT;
    v_uazapi_endpoint TEXT;
BEGIN
    -- Buscar dados da instância
    SELECT 
        provider_token, 
        provider_instance_id, 
        company_id,
        instance_name
    INTO 
        v_provider_token, 
        v_provider_instance_id, 
        v_company_id,
        v_instance_name
    FROM whatsapp_life_instances 
    WHERE id = p_instance_id 
    AND status = 'connected';
    
    -- Validar se instância existe e está conectada
    IF v_provider_instance_id IS NULL OR v_provider_token IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Instance not found, not connected, or missing token',
            'instance_id', p_instance_id
        );
    END IF;
    
    -- URL do nosso webhook (domínio de desenvolvimento)
    v_webhook_url := 'https://lovoo-dev.vercel.app/api/webhook-uazapi-real';
    
    -- Endpoint correto da Uazapi
    v_uazapi_endpoint := 'https://lovoo.uazapi.com/webhook';
    
    -- Payload com configurações completas conforme documentação
    v_request_payload := json_build_object(
        'webhook', v_webhook_url,
        'events', json_build_array('messages', 'messages_update', 'connection'),
        'excludeMessages', json_build_array('wasSentByApi'),
        'enabled', true
    )::text;
    
    -- Fazer requisição HTTP para Uazapi
    SELECT * INTO v_http_response FROM http((
        'POST',
        v_uazapi_endpoint,
        ARRAY[
            http_header('Content-Type', 'application/json'),
            http_header('token', v_provider_token),
            http_header('instance', v_provider_instance_id)
        ],
        'application/json',
        v_request_payload
    )::http_request);
    
    -- Processar resposta
    IF v_http_response.status = 200 OR v_http_response.status = 201 THEN
        -- Sucesso - salvar configuração
        INSERT INTO instance_webhook_configs (
            instance_id,
            webhook_url,
            configured_at,
            status,
            last_test_at,
            created_at,
            updated_at
        ) VALUES (
            p_instance_id,
            v_webhook_url,
            NOW(),
            'active',
            NOW(),
            NOW(),
            NOW()
        ) 
        ON CONFLICT (instance_id) 
        DO UPDATE SET
            webhook_url = EXCLUDED.webhook_url,
            configured_at = NOW(),
            status = 'active',
            last_test_at = NOW(),
            error_message = NULL,
            updated_at = NOW()
        RETURNING id INTO v_config_id;
        
        -- Resultado de sucesso
        v_result := jsonb_build_object(
            'success', true,
            'message', 'Webhook configured automatically in Uazapi',
            'config_id', v_config_id,
            'instance_id', p_instance_id,
            'instance_name', v_instance_name,
            'provider_instance_id', v_provider_instance_id,
            'webhook_url', v_webhook_url,
            'configuration', jsonb_build_object(
                'events', json_build_array('messages', 'messages_update', 'connection'),
                'excludeMessages', json_build_array('wasSentByApi'),
                'enabled', true
            )
        );
        
    ELSE
        -- Erro - salvar detalhes
        INSERT INTO instance_webhook_configs (
            instance_id,
            webhook_url,
            configured_at,
            status,
            error_message,
            created_at,
            updated_at
        ) VALUES (
            p_instance_id,
            v_webhook_url,
            NOW(),
            'error',
            'HTTP ' || v_http_response.status || ': ' || v_http_response.content,
            NOW(),
            NOW()
        ) 
        ON CONFLICT (instance_id) 
        DO UPDATE SET
            webhook_url = EXCLUDED.webhook_url,
            configured_at = NOW(),
            status = 'error',
            error_message = 'HTTP ' || v_http_response.status || ': ' || v_http_response.content,
            updated_at = NOW();
        
        v_result := jsonb_build_object(
            'success', false,
            'message', 'Failed to configure webhook in Uazapi',
            'instance_id', p_instance_id,
            'error_details', jsonb_build_object(
                'http_status', v_http_response.status,
                'response', v_http_response.content,
                'endpoint', v_uazapi_endpoint
            )
        );
    END IF;
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Exception during webhook configuration',
        'instance_id', p_instance_id,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. FUNÇÃO PARA CONFIGURAR TODAS AS INSTÂNCIAS
-- =====================================================

CREATE OR REPLACE FUNCTION configure_all_connected_webhooks(
    p_company_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_instance RECORD;
    v_results JSONB[] := '{}';
    v_result JSONB;
    v_total_instances INT := 0;
    v_success_count INT := 0;
    v_error_count INT := 0;
BEGIN
    -- Processar todas as instâncias conectadas
    FOR v_instance IN 
        SELECT id, instance_name, provider_instance_id
        FROM whatsapp_life_instances 
        WHERE status = 'connected'
        AND (p_company_id IS NULL OR company_id = p_company_id)
        ORDER BY created_at DESC
    LOOP
        v_total_instances := v_total_instances + 1;
        
        -- Configurar webhook para esta instância
        SELECT configure_webhook_automatically(v_instance.id) INTO v_result;
        
        -- Contar sucessos e erros
        IF (v_result->>'success')::boolean THEN
            v_success_count := v_success_count + 1;
        ELSE
            v_error_count := v_error_count + 1;
        END IF;
        
        -- Adicionar resultado ao array
        v_results := v_results || v_result;
    END LOOP;
    
    -- Retornar resumo
    RETURN jsonb_build_object(
        'success', v_error_count = 0,
        'message', 'Webhook configuration completed',
        'summary', jsonb_build_object(
            'total_instances', v_total_instances,
            'success_count', v_success_count,
            'error_count', v_error_count
        ),
        'results', to_jsonb(v_results)
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. FUNÇÃO PARA MARCAR WEBHOOK COMO ATIVO
-- =====================================================

CREATE OR REPLACE FUNCTION mark_webhook_as_active(
    p_instance_id UUID
) RETURNS JSONB AS $$
BEGIN
    UPDATE instance_webhook_configs 
    SET 
        status = 'active',
        last_test_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
    WHERE instance_id = p_instance_id;
    
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Webhook marked as active',
            'instance_id', p_instance_id
        );
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Webhook configuration not found',
            'instance_id', p_instance_id
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. FUNÇÃO PARA LISTAR STATUS DOS WEBHOOKS
-- =====================================================

CREATE OR REPLACE FUNCTION get_webhook_status(
    p_company_id UUID DEFAULT NULL
) RETURNS TABLE (
    instance_id UUID,
    instance_name CHARACTER VARYING,
    provider_instance_id CHARACTER VARYING,
    webhook_url TEXT,
    status CHARACTER VARYING,
    configured_at TIMESTAMP WITH TIME ZONE,
    last_test_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wli.id,
        wli.instance_name,
        wli.provider_instance_id,
        iwc.webhook_url,
        iwc.status,
        iwc.configured_at,
        iwc.last_test_at,
        iwc.error_message
    FROM whatsapp_life_instances wli
    LEFT JOIN instance_webhook_configs iwc ON wli.id = iwc.instance_id
    WHERE (p_company_id IS NULL OR wli.company_id = p_company_id)
    AND wli.status = 'connected'
    ORDER BY wli.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 9. TRIGGER AUTOMÁTICO (OPCIONAL)
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_auto_configure_webhook()
RETURNS TRIGGER AS $$
BEGIN
    -- Só executar se instância mudou para 'connected'
    IF NEW.status = 'connected' AND (OLD.status IS NULL OR OLD.status != 'connected') THEN
        -- Executar configuração automática em background
        PERFORM configure_webhook_automatically(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger (OPCIONAL - pode ser removido se necessário)
DROP TRIGGER IF EXISTS auto_configure_webhook_trigger ON whatsapp_life_instances;
CREATE TRIGGER auto_configure_webhook_trigger
    AFTER UPDATE ON whatsapp_life_instances
    FOR EACH ROW
    EXECUTE FUNCTION trigger_auto_configure_webhook();

-- =====================================================
-- 10. GRANTS E PERMISSÕES
-- =====================================================

-- Permitir acesso às funções
GRANT EXECUTE ON FUNCTION process_uazapi_webhook(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION configure_webhook_automatically(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION configure_all_connected_webhooks(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_webhook_as_active(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_webhook_status(UUID) TO anon, authenticated;

-- =====================================================
-- 11. COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON EXTENSION http IS 'Extensão para fazer requisições HTTP - usada para automação de webhook Uazapi';
COMMENT ON TABLE instance_webhook_configs IS 'Controle de configuração de webhooks por instância WhatsApp';
COMMENT ON COLUMN instance_webhook_configs.status IS 'Status: pending, active, error, disabled';
COMMENT ON COLUMN instance_webhook_configs.webhook_url IS 'URL do webhook configurado na Uazapi';

COMMENT ON FUNCTION process_uazapi_webhook(JSONB) IS 'Processa webhooks da Uazapi no novo formato - auto-cadastra contatos e salva mensagens';
COMMENT ON FUNCTION configure_webhook_automatically(UUID) IS 'AUTOMAÇÃO SAAS: Configura webhook automaticamente na Uazapi quando instância conecta';
COMMENT ON FUNCTION configure_all_connected_webhooks(UUID) IS 'Configura webhooks para todas as instâncias conectadas de uma empresa';
COMMENT ON FUNCTION mark_webhook_as_active(UUID) IS 'Marca webhook como ativo após confirmação de funcionamento';
COMMENT ON FUNCTION get_webhook_status(UUID) IS 'Lista status de configuração dos webhooks por empresa';
COMMENT ON FUNCTION trigger_auto_configure_webhook() IS 'Trigger que executa configuração automática quando instância conecta';
COMMENT ON TRIGGER auto_configure_webhook_trigger ON whatsapp_life_instances IS 'AUTOMAÇÃO SAAS: Configura webhook automaticamente - pode ser desabilitado se necessário';

-- =====================================================
-- FIM DA MIGRAÇÃO 004
-- =====================================================
