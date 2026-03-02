-- =====================================================
-- RPC: delete_whatsapp_instance (VERSÃO CORRIGIDA)
-- =====================================================
-- Corrige problema de exclusão na Uazapi

CREATE OR REPLACE FUNCTION delete_whatsapp_instance(
    p_instance_id UUID,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_instance RECORD;
    v_http_response http_response;
    v_uazapi_deleted BOOLEAN := false;
    v_debug_info JSONB := '{}';
    v_error_details TEXT := '';
BEGIN
    -- Buscar instância local
    SELECT * INTO v_instance
    FROM whatsapp_life_instances 
    WHERE id = p_instance_id AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância não encontrada'
        );
    END IF;
    
    -- Log da instância encontrada
    v_debug_info := v_debug_info || jsonb_build_object(
        'instance_found', jsonb_build_object(
            'id', v_instance.id,
            'name', v_instance.instance_name,
            'provider_instance_id', v_instance.provider_instance_id,
            'has_token', (v_instance.provider_token IS NOT NULL)
        )
    );
    
    -- Tentar excluir da Uazapi se tiver provider_instance_id
    IF v_instance.provider_instance_id IS NOT NULL AND v_instance.provider_token IS NOT NULL THEN
        BEGIN
            -- CORREÇÃO: Usar o token da instância, não admintoken
            SELECT * FROM http((
                'DELETE',
                'https://lovoo.uazapi.com/instance/' || v_instance.provider_instance_id,
                ARRAY[
                    http_header('Content-Type', 'application/json'),
                    http_header('token', v_instance.provider_token),  -- USAR TOKEN DA INSTÂNCIA
                    http_header('User-Agent', 'LovoCRM-Delete/1.0')
                ],
                NULL,
                NULL
            )) INTO v_http_response;
            
            v_debug_info := v_debug_info || jsonb_build_object(
                'uazapi_delete', jsonb_build_object(
                    'status', v_http_response.status,
                    'url', 'https://lovoo.uazapi.com/instance/' || v_instance.provider_instance_id,
                    'response_content', v_http_response.content,
                    'token_used', 'instance_token'
                )
            );
            
            -- Considerar sucesso se: 200, 204 (deletado) ou 404 (já não existe)
            v_uazapi_deleted := (v_http_response.status IN (200, 204, 404));
            
            IF NOT v_uazapi_deleted THEN
                v_error_details := 'Falha na exclusão Uazapi: HTTP ' || v_http_response.status || ' - ' || v_http_response.content;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- Log do erro mas continuar
            v_error_details := 'Erro na comunicação Uazapi: ' || SQLERRM;
            v_debug_info := v_debug_info || jsonb_build_object(
                'uazapi_error', SQLERRM
            );
        END;
    ELSE
        -- Sem dados para exclusão na Uazapi
        v_debug_info := v_debug_info || jsonb_build_object(
            'uazapi_skip', 'Sem provider_instance_id ou provider_token'
        );
        v_uazapi_deleted := true; -- Considerar "sucesso" se não há o que excluir
    END IF;
    
    -- SEMPRE excluir do banco local (mesmo se Uazapi falhar)
    DELETE FROM whatsapp_life_instances 
    WHERE id = p_instance_id AND company_id = p_company_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'instance_name', v_instance.instance_name,
            'uazapi_deleted', v_uazapi_deleted,
            'local_deleted', true,
            'error_details', CASE WHEN v_error_details != '' THEN v_error_details ELSE NULL END
        ),
        'debug_info', v_debug_info
    );
END;
$$;
