-- Quando um seller ativo da empresa conecta o WhatsApp, a instância
-- já nasce com ele como responsável. Admin, manager e demais perfis
-- continuam sem atribuição automática: o seletor manual permanece.
-- Reconexão não troca um responsável que já existe.

CREATE OR REPLACE FUNCTION public.check_instance_connection_status(p_temp_instance_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_instance_data RECORD;
    v_http_response http_response;
    v_status_response JSONB;
    v_connected BOOLEAN := false;
    v_logged_in BOOLEAN := false;
    v_profile_name TEXT;
    v_phone_number TEXT;
    v_owner_raw TEXT;
    v_assigned_seller UUID;
    v_debug_info JSONB := '{}';
BEGIN
    SELECT
        uazapi_instance_id,
        uazapi_token,
        uazapi_name,
        instance_name,
        company_id,
        status
    INTO v_instance_data
    FROM whatsapp_temp_instances
    WHERE temp_instance_id = p_temp_instance_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância temporária não encontrada'
        );
    END IF;

    IF v_instance_data.uazapi_token IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Token da instância não disponível'
        );
    END IF;

    BEGIN
        SELECT * FROM http((
            'GET',
            'https://lovoo.uazapi.com/instance/status',
            ARRAY[
                http_header('Content-Type', 'application/json'),
                http_header('token', v_instance_data.uazapi_token),
                http_header('User-Agent', 'LovoCRM-StatusCheck/1.0')
            ],
            NULL,
            NULL
        )) INTO v_http_response;

        v_debug_info := v_debug_info || jsonb_build_object(
            'status_check', jsonb_build_object(
                'status', v_http_response.status,
                'url', 'https://lovoo.uazapi.com/instance/status',
                'response_preview', LEFT(v_http_response.content, 200)
            )
        );

        IF v_http_response.status = 200 THEN
            BEGIN
                v_status_response := v_http_response.content::jsonb;

                v_connected := COALESCE(
                    (v_status_response ->> 'connected')::boolean,
                    (v_status_response -> 'status' ->> 'connected')::boolean,
                    (v_status_response -> 'instance' ->> 'connected')::boolean,
                    false
                );

                v_logged_in := COALESCE(
                    (v_status_response ->> 'loggedIn')::boolean,
                    (v_status_response -> 'status' ->> 'loggedIn')::boolean,
                    (v_status_response -> 'instance' ->> 'loggedIn')::boolean,
                    false
                );

                v_profile_name := COALESCE(
                    v_status_response ->> 'profileName',
                    v_status_response -> 'instance' ->> 'profileName',
                    v_status_response -> 'status' ->> 'profileName',
                    v_status_response -> 'user' ->> 'name'
                );

                v_owner_raw := COALESCE(
                    v_status_response ->> 'owner',
                    v_status_response -> 'instance' ->> 'owner',
                    v_status_response -> 'status' ->> 'owner'
                );

                IF v_owner_raw IS NOT NULL THEN
                    v_phone_number := regexp_replace(v_owner_raw, '@.*$', '');
                ELSE
                    v_phone_number := COALESCE(
                        v_status_response ->> 'phone',
                        v_status_response -> 'instance' ->> 'phone',
                        v_status_response -> 'jid' ->> 'user',
                        v_status_response -> 'user' ->> 'id'
                    );
                END IF;

            EXCEPTION WHEN OTHERS THEN
                v_connected := false;
                v_logged_in := false;
                v_debug_info := v_debug_info || jsonb_build_object(
                    'parse_error', SQLERRM
                );
            END;
        END IF;

        IF v_connected AND v_logged_in THEN
            UPDATE whatsapp_temp_instances
            SET status = 'connected',
                updated_at = NOW()
            WHERE temp_instance_id = p_temp_instance_id;

            v_assigned_seller := NULL;
            SELECT cu.user_id
            INTO v_assigned_seller
            FROM company_users cu
            WHERE cu.user_id = auth.uid()
              AND cu.company_id = v_instance_data.company_id
              AND cu.is_active = true
              AND cu.role::text = 'seller';

            INSERT INTO whatsapp_life_instances (
                company_id,
                instance_name,
                provider_instance_id,
                provider_token,
                provider_type,
                status,
                profile_name,
                phone_number,
                connected_at,
                created_at,
                updated_at,
                assigned_user_id
            ) VALUES (
                v_instance_data.company_id,
                v_instance_data.instance_name,
                v_instance_data.uazapi_name,
                v_instance_data.uazapi_token,
                'uazapi',
                'connected',
                v_profile_name,
                v_phone_number,
                NOW(),
                NOW(),
                NOW(),
                v_assigned_seller
            )
            ON CONFLICT (company_id, instance_name)
            DO UPDATE SET
                status = 'connected',
                profile_name = EXCLUDED.profile_name,
                phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_life_instances.phone_number),
                assigned_user_id = COALESCE(whatsapp_life_instances.assigned_user_id, EXCLUDED.assigned_user_id),
                connected_at = NOW(),
                updated_at = NOW();
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'temp_instance_id', p_temp_instance_id,
                'connected', v_connected,
                'logged_in', v_logged_in,
                'profile_name', v_profile_name,
                'phone_number', v_phone_number,
                'instance_name', v_instance_data.instance_name,
                'status', CASE
                    WHEN v_connected AND v_logged_in THEN 'connected'
                    WHEN v_connected THEN 'connecting'
                    ELSE 'disconnected'
                END,
                'message', CASE
                    WHEN v_connected AND v_logged_in THEN 'WhatsApp conectado com sucesso!'
                    WHEN v_connected THEN 'Conectando ao WhatsApp...'
                    ELSE 'Aguardando conexão'
                END
            ),
            'debug_info', v_debug_info
        );

    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Erro ao verificar status: ' || SQLERRM,
            'debug_info', v_debug_info
        );
    END;
END;
$function$;

COMMENT ON FUNCTION public.check_instance_connection_status(text) IS
'Confirma a conexão da instância temporária. Se quem conecta é seller ativo da empresa, grava assigned_user_id com esse usuário. Não substitui responsável já definido.';
