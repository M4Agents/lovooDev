-- =====================================================
-- MIGRATION: Sistema de Migração de Conversas
-- =====================================================
-- Criado em: 26/03/2026
-- Objetivo: Migrar conversas automaticamente quando nova instância
--           é criada com mesmo número de WhatsApp
-- Segurança: Não perde conversas, não quebra nada

-- =====================================================
-- FUNÇÃO 1: Migração Manual em Lote
-- =====================================================
-- Migra todas as conversas de uma instância antiga para uma nova
-- Uso: Quando usuário cria nova instância com mesmo número manualmente

CREATE OR REPLACE FUNCTION migrate_all_conversations_by_phone(
    p_old_instance_id UUID,
    p_new_instance_id UUID,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_phone TEXT;
    v_new_phone TEXT;
    v_old_instance_name TEXT;
    v_new_instance_name TEXT;
    v_conversations_count INTEGER;
    v_migrated_count INTEGER := 0;
BEGIN
    -- Verificar se instâncias existem e pertencem à mesma empresa
    SELECT phone_number, instance_name INTO v_old_phone, v_old_instance_name
    FROM whatsapp_life_instances
    WHERE id = p_old_instance_id
    AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância antiga não encontrada ou não pertence a esta empresa'
        );
    END IF;
    
    SELECT phone_number, instance_name INTO v_new_phone, v_new_instance_name
    FROM whatsapp_life_instances
    WHERE id = p_new_instance_id
    AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância nova não encontrada ou não pertence a esta empresa'
        );
    END IF;
    
    -- Verificar se números são iguais
    IF v_old_phone IS NULL OR v_new_phone IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Uma ou ambas as instâncias não possuem número de telefone'
        );
    END IF;
    
    IF v_old_phone != v_new_phone THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instâncias possuem números diferentes',
            'old_phone', v_old_phone,
            'new_phone', v_new_phone
        );
    END IF;
    
    -- Contar conversas a serem migradas
    SELECT COUNT(*) INTO v_conversations_count
    FROM chat_conversations
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    IF v_conversations_count = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Nenhuma conversa para migrar',
            'migrated_count', 0
        );
    END IF;
    
    -- Migrar conversas
    UPDATE chat_conversations
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    GET DIAGNOSTICS v_migrated_count = ROW_COUNT;
    
    -- Log da migração
    RAISE LOG 'Migração manual: % conversas migradas de "%" (%) para "%" (%)',
        v_migrated_count, v_old_instance_name, p_old_instance_id, 
        v_new_instance_name, p_new_instance_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Conversas migradas com sucesso',
        'migrated_count', v_migrated_count,
        'old_instance', jsonb_build_object(
            'id', p_old_instance_id,
            'name', v_old_instance_name,
            'phone', v_old_phone
        ),
        'new_instance', jsonb_build_object(
            'id', p_new_instance_id,
            'name', v_new_instance_name,
            'phone', v_new_phone
        )
    );
END;
$$;

COMMENT ON FUNCTION migrate_all_conversations_by_phone IS 
'Migra todas as conversas de uma instância antiga para uma nova instância com mesmo número de telefone. 
Uso manual quando usuário cria nova instância. Seguro: verifica empresa, números iguais, não perde dados.';

-- =====================================================
-- FUNÇÃO 2: Migração Automática ao Conectar
-- =====================================================
-- Chamada automaticamente quando instância conecta via webhook
-- Busca instâncias antigas com mesmo número e migra conversas

CREATE OR REPLACE FUNCTION auto_migrate_conversations_on_connect(
    p_new_instance_id UUID,
    p_phone_number TEXT,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_instance RECORD;
    v_new_instance_name TEXT;
    v_total_migrated INTEGER := 0;
    v_instances_processed INTEGER := 0;
    v_migration_details JSONB := '[]'::jsonb;
BEGIN
    -- Verificar se nova instância existe
    SELECT instance_name INTO v_new_instance_name
    FROM whatsapp_life_instances
    WHERE id = p_new_instance_id
    AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Nova instância não encontrada'
        );
    END IF;
    
    -- Buscar todas as instâncias antigas com mesmo número
    -- (deletadas ou desconectadas)
    FOR v_old_instance IN
        SELECT 
            id,
            instance_name,
            phone_number,
            status,
            deleted_at IS NOT NULL as is_deleted
        FROM whatsapp_life_instances
        WHERE phone_number = p_phone_number
        AND company_id = p_company_id
        AND id != p_new_instance_id
        AND (deleted_at IS NOT NULL OR status = 'disconnected')
        ORDER BY created_at DESC
    LOOP
        DECLARE
            v_conversations_count INTEGER;
            v_migrated_count INTEGER := 0;
        BEGIN
            -- Contar conversas da instância antiga
            SELECT COUNT(*) INTO v_conversations_count
            FROM chat_conversations
            WHERE instance_id = v_old_instance.id
            AND company_id = p_company_id;
            
            IF v_conversations_count > 0 THEN
                -- Migrar conversas
                UPDATE chat_conversations
                SET 
                    instance_id = p_new_instance_id,
                    updated_at = NOW()
                WHERE instance_id = v_old_instance.id
                AND company_id = p_company_id;
                
                GET DIAGNOSTICS v_migrated_count = ROW_COUNT;
                v_total_migrated := v_total_migrated + v_migrated_count;
                v_instances_processed := v_instances_processed + 1;
                
                -- Adicionar detalhes da migração
                v_migration_details := v_migration_details || jsonb_build_object(
                    'old_instance_id', v_old_instance.id,
                    'old_instance_name', v_old_instance.instance_name,
                    'was_deleted', v_old_instance.is_deleted,
                    'conversations_migrated', v_migrated_count
                );
                
                -- Log da migração
                RAISE LOG 'Migração automática: % conversas migradas de "%" (%) para "%" (%)',
                    v_migrated_count, v_old_instance.instance_name, v_old_instance.id,
                    v_new_instance_name, p_new_instance_id;
            END IF;
        END;
    END LOOP;
    
    -- Retornar resultado
    IF v_total_migrated = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Nenhuma conversa antiga encontrada para migrar',
            'migrated_count', 0,
            'instances_processed', 0
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', format('%s conversas migradas de %s instâncias antigas', 
            v_total_migrated, v_instances_processed),
        'migrated_count', v_total_migrated,
        'instances_processed', v_instances_processed,
        'new_instance', jsonb_build_object(
            'id', p_new_instance_id,
            'name', v_new_instance_name,
            'phone', p_phone_number
        ),
        'migration_details', v_migration_details
    );
END;
$$;

COMMENT ON FUNCTION auto_migrate_conversations_on_connect IS 
'Migra automaticamente conversas de instâncias antigas quando nova instância conecta. 
Chamada pelo webhook ao processar connection.update. Busca instâncias deletadas ou 
desconectadas com mesmo número e migra todas as conversas. Seguro: não perde dados.';

-- =====================================================
-- FUNÇÃO 3: Migração Individual de Conversa
-- =====================================================
-- Para migração manual conversa por conversa via interface

CREATE OR REPLACE FUNCTION migrate_conversation_to_instance(
    p_conversation_id UUID,
    p_new_instance_id UUID,
    p_company_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT 'Migração manual via interface'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_instance_id UUID;
    v_old_instance_name TEXT;
    v_new_instance_name TEXT;
    v_conversation_contact TEXT;
BEGIN
    -- Verificar se conversa existe e pertence à empresa
    SELECT instance_id, contact_name INTO v_old_instance_id, v_conversation_contact
    FROM chat_conversations
    WHERE id = p_conversation_id
    AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Conversa não encontrada ou não pertence a esta empresa'
        );
    END IF;
    
    -- Verificar se nova instância existe e pertence à empresa
    SELECT instance_name INTO v_new_instance_name
    FROM whatsapp_life_instances
    WHERE id = p_new_instance_id
    AND company_id = p_company_id
    AND deleted_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância destino não encontrada, foi deletada ou não pertence a esta empresa'
        );
    END IF;
    
    -- Buscar nome da instância antiga
    SELECT instance_name INTO v_old_instance_name
    FROM whatsapp_life_instances
    WHERE id = v_old_instance_id;
    
    -- Migrar conversa
    UPDATE chat_conversations
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE id = p_conversation_id
    AND company_id = p_company_id;
    
    -- Log da migração
    RAISE LOG 'Migração individual: Conversa "%" migrada de "%" para "%" - Razão: %',
        v_conversation_contact, v_old_instance_name, v_new_instance_name, p_reason;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Conversa migrada com sucesso',
        'conversation_id', p_conversation_id,
        'contact', v_conversation_contact,
        'old_instance', jsonb_build_object(
            'id', v_old_instance_id,
            'name', v_old_instance_name
        ),
        'new_instance', jsonb_build_object(
            'id', p_new_instance_id,
            'name', v_new_instance_name
        ),
        'reason', p_reason
    );
END;
$$;

COMMENT ON FUNCTION migrate_conversation_to_instance IS 
'Migra uma conversa individual para outra instância. Usado na interface quando usuário 
clica em "Migrar para Outra Instância". Seguro: verifica empresa, instância ativa.';

-- =====================================================
-- GRANTS - Permitir execução para usuários autenticados
-- =====================================================

GRANT EXECUTE ON FUNCTION migrate_all_conversations_by_phone TO authenticated;
GRANT EXECUTE ON FUNCTION auto_migrate_conversations_on_connect TO authenticated;
GRANT EXECUTE ON FUNCTION migrate_conversation_to_instance TO authenticated;

-- =====================================================
-- LOG DA MIGRATION
-- =====================================================

DO $$
BEGIN
    RAISE LOG '✅ MIGRATION APLICADA: Sistema de Migração de Conversas';
    RAISE LOG '📦 FUNÇÕES CRIADAS:';
    RAISE LOG '   1. migrate_all_conversations_by_phone - Migração manual em lote';
    RAISE LOG '   2. auto_migrate_conversations_on_connect - Migração automática no webhook';
    RAISE LOG '   3. migrate_conversation_to_instance - Migração individual';
    RAISE LOG '🔒 SEGURANÇA: Todas as funções verificam company_id e não perdem dados';
END;
$$;
