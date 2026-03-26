-- =====================================================
-- MIGRATION: FIX - Migração de Conversas DEVE Incluir Mensagens
-- =====================================================
-- Criado em: 26/03/2026
-- CRÍTICO: Evitar perda de dados ao migrar conversas
-- Problema: Funções antigas só migravam conversas, mensagens ficavam órfãs
-- Solução: Migrar mensagens ANTES de migrar conversas

-- =====================================================
-- FUNÇÃO 1: Migração Manual em Lote (ATUALIZADA)
-- =====================================================
-- Migra CONVERSAS + MENSAGENS de uma instância antiga para uma nova

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
    v_messages_count INTEGER;
    v_migrated_conversations INTEGER := 0;
    v_migrated_messages INTEGER := 0;
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
    
    -- Contar conversas e mensagens a serem migradas
    SELECT COUNT(*) INTO v_conversations_count
    FROM chat_conversations
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    SELECT COUNT(*) INTO v_messages_count
    FROM chat_messages
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    IF v_conversations_count = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Nenhuma conversa para migrar',
            'migrated_conversations', 0,
            'migrated_messages', 0
        );
    END IF;
    
    -- ✅ PASSO 1: Migrar MENSAGENS primeiro (evita perda de dados)
    UPDATE chat_messages
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    GET DIAGNOSTICS v_migrated_messages = ROW_COUNT;
    
    -- ✅ PASSO 2: Migrar CONVERSAS depois
    UPDATE chat_conversations
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE instance_id = p_old_instance_id
    AND company_id = p_company_id;
    
    GET DIAGNOSTICS v_migrated_conversations = ROW_COUNT;
    
    -- Log da migração
    RAISE LOG 'Migração manual: % conversas e % mensagens migradas de "%" (%) para "%" (%)',
        v_migrated_conversations, v_migrated_messages,
        v_old_instance_name, p_old_instance_id, 
        v_new_instance_name, p_new_instance_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Conversas e mensagens migradas com sucesso',
        'migrated_conversations', v_migrated_conversations,
        'migrated_messages', v_migrated_messages,
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
'Migra CONVERSAS + MENSAGENS de uma instância antiga para uma nova instância com mesmo número de telefone. 
CRÍTICO: Migra mensagens ANTES de conversas para evitar perda de dados.
Atualizado em 26/03/2026 para incluir migração de mensagens.';

-- =====================================================
-- FUNÇÃO 2: Migração Automática ao Conectar (ATUALIZADA)
-- =====================================================
-- Chamada automaticamente quando instância conecta via webhook
-- Migra CONVERSAS + MENSAGENS de instâncias antigas

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
    v_total_migrated_conversations INTEGER := 0;
    v_total_migrated_messages INTEGER := 0;
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
            v_messages_count INTEGER;
            v_migrated_conversations INTEGER := 0;
            v_migrated_messages INTEGER := 0;
        BEGIN
            -- Contar conversas e mensagens da instância antiga
            SELECT COUNT(*) INTO v_conversations_count
            FROM chat_conversations
            WHERE instance_id = v_old_instance.id
            AND company_id = p_company_id;
            
            SELECT COUNT(*) INTO v_messages_count
            FROM chat_messages
            WHERE instance_id = v_old_instance.id
            AND company_id = p_company_id;
            
            IF v_conversations_count > 0 OR v_messages_count > 0 THEN
                -- ✅ PASSO 1: Migrar MENSAGENS primeiro
                UPDATE chat_messages
                SET 
                    instance_id = p_new_instance_id,
                    updated_at = NOW()
                WHERE instance_id = v_old_instance.id
                AND company_id = p_company_id;
                
                GET DIAGNOSTICS v_migrated_messages = ROW_COUNT;
                
                -- ✅ PASSO 2: Migrar CONVERSAS depois
                UPDATE chat_conversations
                SET 
                    instance_id = p_new_instance_id,
                    updated_at = NOW()
                WHERE instance_id = v_old_instance.id
                AND company_id = p_company_id;
                
                GET DIAGNOSTICS v_migrated_conversations = ROW_COUNT;
                
                v_total_migrated_conversations := v_total_migrated_conversations + v_migrated_conversations;
                v_total_migrated_messages := v_total_migrated_messages + v_migrated_messages;
                v_instances_processed := v_instances_processed + 1;
                
                -- Adicionar detalhes da migração
                v_migration_details := v_migration_details || jsonb_build_object(
                    'old_instance_id', v_old_instance.id,
                    'old_instance_name', v_old_instance.instance_name,
                    'was_deleted', v_old_instance.is_deleted,
                    'conversations_migrated', v_migrated_conversations,
                    'messages_migrated', v_migrated_messages
                );
                
                -- Log da migração
                RAISE LOG 'Migração automática: % conversas e % mensagens migradas de "%" (%) para "%" (%)',
                    v_migrated_conversations, v_migrated_messages,
                    v_old_instance.instance_name, v_old_instance.id,
                    v_new_instance_name, p_new_instance_id;
            END IF;
        END;
    END LOOP;
    
    -- Retornar resultado
    IF v_total_migrated_conversations = 0 AND v_total_migrated_messages = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Nenhuma conversa ou mensagem antiga encontrada para migrar',
            'migrated_conversations', 0,
            'migrated_messages', 0,
            'instances_processed', 0
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', format('%s conversas e %s mensagens migradas de %s instâncias antigas', 
            v_total_migrated_conversations, v_total_migrated_messages, v_instances_processed),
        'migrated_conversations', v_total_migrated_conversations,
        'migrated_messages', v_total_migrated_messages,
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
'Migra automaticamente CONVERSAS + MENSAGENS de instâncias antigas quando nova instância conecta. 
CRÍTICO: Migra mensagens ANTES de conversas para evitar perda de dados.
Atualizado em 26/03/2026 para incluir migração de mensagens.';

-- =====================================================
-- FUNÇÃO 3: Migração Individual de Conversa (ATUALIZADA)
-- =====================================================
-- Para migração manual conversa por conversa via interface
-- Migra CONVERSA + TODAS AS MENSAGENS

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
    v_messages_count INTEGER;
    v_migrated_messages INTEGER := 0;
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
    
    -- Contar mensagens da conversa
    SELECT COUNT(*) INTO v_messages_count
    FROM chat_messages
    WHERE conversation_id = p_conversation_id
    AND company_id = p_company_id;
    
    -- ✅ PASSO 1: Migrar MENSAGENS primeiro
    UPDATE chat_messages
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE conversation_id = p_conversation_id
    AND company_id = p_company_id;
    
    GET DIAGNOSTICS v_migrated_messages = ROW_COUNT;
    
    -- ✅ PASSO 2: Migrar CONVERSA depois
    UPDATE chat_conversations
    SET 
        instance_id = p_new_instance_id,
        updated_at = NOW()
    WHERE id = p_conversation_id
    AND company_id = p_company_id;
    
    -- Log da migração
    RAISE LOG 'Migração individual: Conversa "%" e % mensagens migradas de "%" para "%" - Razão: %',
        v_conversation_contact, v_migrated_messages,
        v_old_instance_name, v_new_instance_name, p_reason;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Conversa e mensagens migradas com sucesso',
        'conversation_id', p_conversation_id,
        'contact', v_conversation_contact,
        'messages_migrated', v_migrated_messages,
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
'Migra uma conversa individual + TODAS AS MENSAGENS para outra instância. 
CRÍTICO: Migra mensagens ANTES da conversa para evitar perda de dados.
Atualizado em 26/03/2026 para incluir migração de mensagens.';

-- =====================================================
-- FUNÇÃO 4: Exclusão Segura de Instância (NOVA)
-- =====================================================
-- SEMPRE faz soft delete, NUNCA hard delete
-- Evita perda acidental de dados

CREATE OR REPLACE FUNCTION safe_delete_instance(
    p_instance_id UUID,
    p_company_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT 'Exclusão via interface'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_instance_name TEXT;
    v_conversations_count INTEGER;
    v_messages_count INTEGER;
    v_already_deleted BOOLEAN;
BEGIN
    -- Verificar se instância existe e pertence à empresa
    SELECT 
        instance_name,
        deleted_at IS NOT NULL
    INTO v_instance_name, v_already_deleted
    FROM whatsapp_life_instances
    WHERE id = p_instance_id
    AND company_id = p_company_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância não encontrada ou não pertence a esta empresa'
        );
    END IF;
    
    IF v_already_deleted THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância já foi deletada anteriormente'
        );
    END IF;
    
    -- Contar conversas e mensagens vinculadas
    SELECT COUNT(*) INTO v_conversations_count
    FROM chat_conversations
    WHERE instance_id = p_instance_id
    AND company_id = p_company_id;
    
    SELECT COUNT(*) INTO v_messages_count
    FROM chat_messages
    WHERE instance_id = p_instance_id
    AND company_id = p_company_id;
    
    -- ⚠️ AVISO: Se há conversas/mensagens, alertar usuário
    IF v_conversations_count > 0 OR v_messages_count > 0 THEN
        RAISE WARNING 'Instância "%" tem % conversas e % mensagens. Considere migrar antes de deletar.',
            v_instance_name, v_conversations_count, v_messages_count;
    END IF;
    
    -- ✅ SOFT DELETE (NUNCA hard delete)
    UPDATE whatsapp_life_instances
    SET 
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = p_instance_id
    AND company_id = p_company_id;
    
    -- Log da exclusão
    RAISE LOG 'Exclusão segura: Instância "%" (%) soft deleted - Razão: % - Conversas: %, Mensagens: %',
        v_instance_name, p_instance_id, p_reason, v_conversations_count, v_messages_count;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Instância deletada com sucesso (soft delete)',
        'instance_id', p_instance_id,
        'instance_name', v_instance_name,
        'conversations_count', v_conversations_count,
        'messages_count', v_messages_count,
        'warning', CASE 
            WHEN v_conversations_count > 0 OR v_messages_count > 0 
            THEN format('Instância tinha %s conversas e %s mensagens. Dados preservados.', 
                v_conversations_count, v_messages_count)
            ELSE NULL
        END
    );
END;
$$;

COMMENT ON FUNCTION safe_delete_instance IS 
'Exclusão SEGURA de instância WhatsApp. SEMPRE faz soft delete (deleted_at), NUNCA hard delete.
Preserva conversas e mensagens. Avisa se há dados vinculados.
Criado em 26/03/2026 para evitar perda acidental de dados.';

-- =====================================================
-- GRANTS - Permitir execução para usuários autenticados
-- =====================================================

GRANT EXECUTE ON FUNCTION migrate_all_conversations_by_phone TO authenticated;
GRANT EXECUTE ON FUNCTION auto_migrate_conversations_on_connect TO authenticated;
GRANT EXECUTE ON FUNCTION migrate_conversation_to_instance TO authenticated;
GRANT EXECUTE ON FUNCTION safe_delete_instance TO authenticated;

-- =====================================================
-- LOG DA MIGRATION
-- =====================================================

DO $$
BEGIN
    RAISE LOG '✅ MIGRATION APLICADA: FIX - Migração de Conversas + Mensagens';
    RAISE LOG '🔧 FUNÇÕES ATUALIZADAS:';
    RAISE LOG '   1. migrate_all_conversations_by_phone - Agora migra MENSAGENS + CONVERSAS';
    RAISE LOG '   2. auto_migrate_conversations_on_connect - Agora migra MENSAGENS + CONVERSAS';
    RAISE LOG '   3. migrate_conversation_to_instance - Agora migra MENSAGENS + CONVERSA';
    RAISE LOG '🆕 FUNÇÃO NOVA:';
    RAISE LOG '   4. safe_delete_instance - Exclusão SEGURA (sempre soft delete)';
    RAISE LOG '🔒 SEGURANÇA: NUNCA mais perder mensagens ao migrar ou deletar instâncias';
    RAISE LOG '⚠️  CRÍTICO: Mensagens são migradas ANTES de conversas';
END;
$$;
