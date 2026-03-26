-- Migration: Modificar RPC para ignorar instâncias deletadas na validação de nome duplicado
-- Isso permite reconexão de instâncias com soft delete sem erro de duplicação

CREATE OR REPLACE FUNCTION generate_whatsapp_qr_code_180s_timeout(
    p_company_id UUID,
    p_instance_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_plan_check JSONB;
    v_temp_instance_id TEXT;
    v_uazapi_name TEXT;
    v_http_response http_response;
    v_init_response JSONB;
    v_instance_token TEXT;
    v_uazapi_instance_id TEXT;
    v_connect_response http_response;
    v_connect_result JSONB;
    v_qrcode TEXT;
    v_paircode TEXT;
    v_debug_info JSONB := '{}';
    v_step_start TIMESTAMP;
    v_step_duration INTERVAL;
    v_total_start TIMESTAMP;
BEGIN
    v_total_start := clock_timestamp();
    
    -- Verificações básicas
    v_user_id := auth.uid();
    
    IF v_user_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM companies 
            WHERE id = p_company_id 
            AND (user_id = v_user_id OR is_super_admin = true)
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Acesso negado à empresa'
            );
        END IF;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Empresa não encontrada'
        );
    END IF;
    
    -- Verificar limite do plano
    SELECT check_whatsapp_life_plan_limit(p_company_id) INTO v_plan_check;
    
    IF NOT (v_plan_check ->> 'canAdd')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Limite de instâncias atingido para seu plano',
            'planInfo', v_plan_check
        );
    END IF;
    
    -- ✅ CORREÇÃO: Verificar se já existe instância com mesmo nome (IGNORANDO DELETADAS)
    IF EXISTS (
        SELECT 1 FROM whatsapp_life_instances 
        WHERE company_id = p_company_id 
        AND instance_name = p_instance_name
        AND deleted_at IS NULL  -- ✅ Ignora instâncias com soft delete
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Já existe uma instância com este nome'
        );
    END IF;
    
    -- Gerar ID temporário e nome único
    v_temp_instance_id := gen_random_uuid()::text;
    v_uazapi_name := substring(p_company_id::text, 1, 8) || '_' || 
                     regexp_replace(p_instance_name, '[^a-zA-Z0-9]', '', 'g') || '_' || 
                     substring(v_temp_instance_id, 1, 8);
    
    -- Inserir registro temporário
    INSERT INTO whatsapp_temp_instances (
        temp_instance_id, company_id, instance_name, uazapi_name, status
    ) VALUES (
        v_temp_instance_id, p_company_id, p_instance_name, v_uazapi_name, 'creating'
    );
    
    BEGIN
        -- =====================================================
        -- ETAPA 1: CRIAR INSTÂNCIA
        -- =====================================================
        v_step_start := clock_timestamp();
        
        SELECT * FROM http((
            'POST',
            'https://lovoo.uazapi.com/instance/init',
            ARRAY[
                http_header('Content-Type', 'application/json'),
                http_header('admintoken', 'Qz8m6fc3Gcfc0jKAdZbCPaHRYa2nCGpOapTNJT5J4C2km6GdQB'),
                http_header('User-Agent', 'LovoCRM-180sTimeout/1.0')
            ],
            'application/json',
            jsonb_build_object('name', v_uazapi_name)::text
        )) INTO v_http_response;
        
        v_step_duration := clock_timestamp() - v_step_start;
        
        v_debug_info := v_debug_info || jsonb_build_object(
            'step1_init', jsonb_build_object(
                'status', v_http_response.status,
                'duration_ms', extract(milliseconds from v_step_duration)::integer,
                'approach', '180s_timeout_version'
            )
        );
        
        IF v_http_response.status != 200 THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'error', 
                error_message = 'Falha na criação da instância',
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Erro ao criar instância WhatsApp'
            );
        END IF;
        
        -- Parse da resposta
        BEGIN
            v_init_response := v_http_response.content::jsonb;
            v_instance_token := v_init_response ->> 'token';
            v_uazapi_instance_id := v_init_response -> 'instance' ->> 'id';
        EXCEPTION WHEN OTHERS THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'error', 
                error_message = 'Resposta inválida na criação',
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Erro na criação da instância WhatsApp'
            );
        END;
        
        IF v_instance_token IS NULL OR v_uazapi_instance_id IS NULL THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'error', 
                error_message = 'Dados da instância não retornados',
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Erro na configuração da instância WhatsApp'
            );
        END IF;
        
        -- Atualizar com dados da instância
        UPDATE whatsapp_temp_instances 
        SET uazapi_instance_id = v_uazapi_instance_id,
            uazapi_token = v_instance_token,
            status = 'created',
            updated_at = NOW()
        WHERE temp_instance_id = v_temp_instance_id;
        
        -- =====================================================
        -- ETAPA 2: OBTER QR CODE COM TIMEOUT DE 180 SEGUNDOS
        -- =====================================================
        v_step_start := clock_timestamp();
        
        -- CONFIGURAR TIMEOUT DE 180 SEGUNDOS
        PERFORM set_config('http.timeout_msec', '180000', true);
        
        -- Chamada exata da referência com headers corretos
        SELECT * FROM http((
            'POST',
            'https://lovoo.uazapi.com/instance/connect',
            ARRAY[
                http_header('Content-Type', 'application/json'),
                http_header('token', v_instance_token),
                http_header('User-Agent', 'LovoCRM-180sTimeout/1.0')
            ],
            'application/json',
            '{}'::text
        )) INTO v_connect_response;
        
        v_step_duration := clock_timestamp() - v_step_start;
        
        v_debug_info := v_debug_info || jsonb_build_object(
            'step2_connect_180s', jsonb_build_object(
                'status', v_connect_response.status,
                'duration_ms', extract(milliseconds from v_step_duration)::integer,
                'timeout_used', '180000ms',
                'headers_used', 'token_instance_correct',
                'body_sent', 'empty_for_qrcode'
            )
        );
        
        -- Verificar resposta do connect
        IF v_connect_response.status != 200 THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'created_no_qr',
                error_message = 'Connect falhou: HTTP ' || v_connect_response.status,
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Não foi possível gerar o QR Code. Tente novamente.',
                'debug_info', v_debug_info
            );
        END IF;
        
        -- Parse da resposta do connect
        BEGIN
            v_connect_result := v_connect_response.content::jsonb;
        EXCEPTION WHEN OTHERS THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'created_no_qr',
                error_message = 'Resposta connect inválida',
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Erro na resposta do servidor. Tente novamente.',
                'debug_info', v_debug_info
            );
        END;
        
        -- Extrair QR Code de múltiplos campos
        v_qrcode := COALESCE(
            v_connect_result ->> 'qrcode',
            v_connect_result ->> 'base64',
            v_connect_result -> 'instance' ->> 'qrcode',
            v_connect_result -> 'instance' ->> 'base64',
            v_connect_result -> 'data' ->> 'qrcode',
            v_connect_result -> 'data' ->> 'base64'
        );
        
        v_paircode := COALESCE(
            v_connect_result ->> 'paircode',
            v_connect_result -> 'instance' ->> 'paircode',
            v_connect_result -> 'data' ->> 'paircode'
        );
        
        -- Verificar se obteve QR Code
        IF v_qrcode IS NULL AND v_paircode IS NULL THEN
            UPDATE whatsapp_temp_instances 
            SET status = 'created_no_qr',
                error_message = 'QR Code não retornado na resposta',
                updated_at = NOW()
            WHERE temp_instance_id = v_temp_instance_id;
            
            RETURN jsonb_build_object(
                'success', false,
                'error', 'QR Code não foi gerado. Tente novamente em alguns segundos.',
                'debug_info', v_debug_info || jsonb_build_object(
                    'connect_response_keys', array(SELECT jsonb_object_keys(v_connect_result))
                )
            );
        END IF;
        
        -- Atualizar registro com QR Code
        UPDATE whatsapp_temp_instances 
        SET qrcode = v_qrcode,
            paircode = v_paircode,
            status = 'connecting',
            updated_at = NOW()
        WHERE temp_instance_id = v_temp_instance_id;
        
        -- =====================================================
        -- RETORNAR QR CODE PARA EXIBIR NO MODAL
        -- =====================================================
        
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'temp_instance_id', v_temp_instance_id,
                'uazapi_instance_id', v_uazapi_instance_id,
                'uazapi_token', v_instance_token,
                'uazapi_name', v_uazapi_name,
                'qrcode', v_qrcode,
                'paircode', v_paircode,
                'status', 'connecting',
                'message', CASE 
                    WHEN v_qrcode IS NOT NULL THEN 'Escaneie o QR Code com seu WhatsApp'
                    WHEN v_paircode IS NOT NULL THEN 'Use o código de pareamento no seu WhatsApp'
                    ELSE 'Conecte seu WhatsApp'
                END,
                'connection_method', CASE 
                    WHEN v_qrcode IS NOT NULL THEN 'qrcode'
                    WHEN v_paircode IS NOT NULL THEN 'paircode'
                    ELSE 'unknown'
                END,
                'expires_at', (NOW() + INTERVAL '2 minutes')::text,
                'instance_name', p_instance_name,
                'company_id', p_company_id,
                'approach', '180s_timeout_success'
            ),
            'debug_info', v_debug_info || jsonb_build_object(
                'total_duration_seconds', extract(seconds from (clock_timestamp() - v_total_start))::numeric(10,2),
                'timeout_180s', true,
                'qrcode_extracted', v_qrcode IS NOT NULL,
                'paircode_extracted', v_paircode IS NOT NULL
            )
        );
        
    EXCEPTION WHEN OTHERS THEN
        UPDATE whatsapp_temp_instances 
        SET status = 'error', 
            error_message = SQLERRM,
            updated_at = NOW()
        WHERE temp_instance_id = v_temp_instance_id;
        
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Erro interno na geração do QR Code',
            'debug_info', v_debug_info || jsonb_build_object(
                'total_duration_seconds', extract(seconds from (clock_timestamp() - v_total_start))::numeric(10,2),
                'error_state', SQLSTATE,
                'timeout_180s', true
            )
        );
    END;
END;
$$;

-- Comentário explicativo
COMMENT ON FUNCTION generate_whatsapp_qr_code_180s_timeout IS 
'Gera QR Code para conexão de instância WhatsApp com timeout de 180s. 
MODIFICADO: Ignora instâncias com deleted_at na validação de nome duplicado, 
permitindo reconexão de instâncias com soft delete.';
