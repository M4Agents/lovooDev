-- Promove a temporária para uma permanente nova quando o nome pertence
-- somente a uma instância excluída. A excluída recebe um nome técnico na
-- mesma subtransação. Uma falha faz RAISE e o EXCEPTION desfaz a
-- renomeação e o INSERT. Não altera constraints, gatilhos nem mensagens.
-- Preparada. Não aplicar até a publicação aprovada.

CREATE OR REPLACE FUNCTION public.check_instance_connection_status(p_temp_instance_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_instance_data RECORD;
    v_http_response public.http_response;
    v_status_response JSONB;
    v_connected BOOLEAN := false;
    v_logged_in BOOLEAN := false;
    v_profile_name TEXT;
    v_phone_number TEXT;
    v_owner_raw TEXT;
    v_assigned_seller UUID;
    v_allowed BOOLEAN := false;
    v_direct_count INTEGER := 0;
    v_direct_role TEXT;
    v_parent_id UUID;
    v_parent_count INTEGER := 0;
    v_parent_role TEXT;
    v_existing public.whatsapp_life_instances%ROWTYPE;
    v_archived_name text;
    v_promote boolean := false;
    v_renamed integer := 0;
    v_confirmed_count integer := 0;
    v_archive_ok boolean := true;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Não autenticado'
        );
    END IF;

    SELECT
        uazapi_instance_id,
        uazapi_token,
        uazapi_name,
        instance_name,
        company_id,
        status
    INTO v_instance_data
    FROM public.whatsapp_temp_instances
    WHERE temp_instance_id = p_temp_instance_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância temporária não encontrada'
        );
    END IF;

    SELECT count(*)::integer, min(cu.role::text)
      INTO v_direct_count, v_direct_role
    FROM public.company_users cu
    WHERE cu.user_id = auth.uid()
      AND cu.company_id = v_instance_data.company_id
      AND cu.is_active = true;

    IF v_direct_count > 1 THEN
        v_allowed := false;
    ELSIF v_direct_count = 1 AND v_direct_role IN ('admin', 'manager', 'seller') THEN
        v_allowed := true;
    ELSIF v_direct_count = 1 AND public.auth_user_is_company_admin(v_instance_data.company_id) THEN
        v_allowed := true;
    ELSIF v_direct_count = 1 THEN
        v_allowed := false;
    ELSE
        SELECT c.parent_company_id
          INTO v_parent_id
        FROM public.companies c
        WHERE c.id = v_instance_data.company_id;

        IF v_parent_id IS NOT NULL THEN
            SELECT count(*)::integer, min(cu.role::text)
              INTO v_parent_count, v_parent_role
            FROM public.company_users cu
            WHERE cu.user_id = auth.uid()
              AND cu.company_id = v_parent_id
              AND cu.is_active = true;

            IF v_parent_count = 1
               AND v_parent_role IN ('super_admin', 'system_admin')
               AND public.auth_user_is_parent_admin(v_instance_data.company_id) THEN
                v_allowed := true;
            ELSIF v_parent_count = 1
               AND v_parent_role = 'partner'
               AND public.auth_user_is_partner_for_company(v_instance_data.company_id) THEN
                v_allowed := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_allowed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Permissão insuficiente para esta operação'
        );
    END IF;

    IF v_instance_data.uazapi_token IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Token da instância não disponível'
        );
    END IF;

    BEGIN
        SELECT * FROM public.http((
            'GET',
            'https://lovoo.uazapi.com/instance/status',
            ARRAY[
                public.http_header('Content-Type', 'application/json'),
                public.http_header('token', v_instance_data.uazapi_token),
                public.http_header('User-Agent', 'LovoCRM-StatusCheck/1.0')
            ],
            NULL,
            NULL
        )) INTO v_http_response;

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
            END;
        END IF;

        IF v_connected AND v_logged_in THEN
            IF v_instance_data.company_id IS NULL
               OR v_instance_data.instance_name IS NULL
               OR length(v_instance_data.instance_name) > 100 THEN
                RAISE EXCEPTION 'promocao_argumentos_invalidos';
            END IF;

            PERFORM pg_advisory_xact_lock(
                hashtextextended(v_instance_data.company_id::text || E'\x1f' || v_instance_data.instance_name, 0)
            );

            v_existing := NULL;
            SELECT *
              INTO v_existing
            FROM public.whatsapp_life_instances
            WHERE company_id = v_instance_data.company_id
              AND instance_name = v_instance_data.instance_name
            FOR UPDATE;

            IF v_existing.id IS NOT NULL AND v_existing.deleted_at IS NULL THEN
                IF v_existing.provider_instance_id IS NOT DISTINCT FROM v_instance_data.uazapi_name
                   AND v_existing.provider_token IS NOT DISTINCT FROM v_instance_data.uazapi_token
                   AND v_existing.status = 'connected' THEN
                    v_promote := true;
                ELSE
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'Já existe uma instância ativa com este nome'
                    );
                END IF;
            ELSE
                IF v_existing.id IS NOT NULL THEN
                    v_archived_name := 'd:' || v_existing.id::text || ':' || left(v_instance_data.instance_name, 61);
                    IF char_length(v_archived_name) > 100 THEN
                        RAISE EXCEPTION 'promocao_nome_arquivado_invalido';
                    END IF;

                    -- renomeacao-da-excluida
                    UPDATE public.whatsapp_life_instances
                    SET instance_name = v_archived_name
                    WHERE id = v_existing.id
                      AND company_id = v_instance_data.company_id
                      AND instance_name = v_instance_data.instance_name
                      AND deleted_at IS NOT NULL;
                    GET DIAGNOSTICS v_renamed = ROW_COUNT;
                    IF v_renamed <> 1 THEN
                        RAISE EXCEPTION 'promocao_renomeacao_invalida';
                    END IF;
                END IF;

                v_assigned_seller := NULL;
                SELECT cu.user_id
                INTO v_assigned_seller
                FROM public.company_users cu
                WHERE cu.user_id = auth.uid()
                  AND cu.company_id = v_instance_data.company_id
                  AND cu.is_active = true
                  AND cu.role::text = 'seller';

                INSERT INTO public.whatsapp_life_instances (
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
                );

                -- confirmacao-da-permanente
                SELECT count(*)
                  INTO v_confirmed_count
                FROM public.whatsapp_life_instances promoted
                WHERE promoted.company_id = v_instance_data.company_id
                  AND promoted.instance_name = v_instance_data.instance_name
                  AND promoted.deleted_at IS NULL
                  AND promoted.status = 'connected'
                  AND promoted.provider_instance_id = v_instance_data.uazapi_name
                  AND promoted.provider_token = v_instance_data.uazapi_token;

                v_archive_ok := true;
                IF v_existing.id IS NOT NULL THEN
                    SELECT count(*) = 1
                      INTO v_archive_ok
                    FROM public.whatsapp_life_instances archived
                    WHERE archived.id = v_existing.id
                      AND archived.company_id = v_instance_data.company_id
                      AND archived.deleted_at IS NOT DISTINCT FROM v_existing.deleted_at
                      AND archived.instance_name = v_archived_name
                      AND archived.provider_instance_id IS NOT DISTINCT FROM v_existing.provider_instance_id
                      AND archived.provider_token IS NOT DISTINCT FROM v_existing.provider_token;
                END IF;

                IF v_confirmed_count <> 1 OR v_archive_ok IS NOT TRUE THEN
                    RAISE EXCEPTION 'promocao_nao_confirmada';
                END IF;

                v_promote := true;
            END IF;

            IF v_promote THEN
                -- temporaria-conectada
                UPDATE public.whatsapp_temp_instances
                SET status = 'connected',
                    updated_at = NOW()
                WHERE temp_instance_id = p_temp_instance_id
                  AND company_id = v_instance_data.company_id;
            END IF;
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
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Erro ao verificar status'
        );
    END;
END;
$function$;

COMMENT ON FUNCTION public.check_instance_connection_status(text) IS
'Confirma a conexão para admin, manager ou seller com papel único na própria empresa, ou para o administrador da pai e o partner atribuído. Uma excluída com o mesmo nome é arquivada e a permanente nova só é confirmada quando está ativa, com o identificador remoto da temporária. Não devolve token.';

REVOKE ALL ON FUNCTION public.check_instance_connection_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_instance_connection_status(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_instance_connection_status(text) TO authenticated;
