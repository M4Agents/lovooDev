-- =====================================================
-- MIGRAÇÃO: Criar função chat_get_messages
-- =====================================================
-- Data: 06/12/2025 15:15
-- Objetivo: Resolver problema de previews de mídia no chat
-- Problema: Frontend chamava função chat_get_messages que não existia
-- Solução: Criar função SQL para buscar mensagens com paginação

-- =====================================================
-- FUNÇÃO: chat_get_messages
-- =====================================================

CREATE OR REPLACE FUNCTION chat_get_messages(
    p_conversation_id UUID,
    p_company_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_messages JSONB;
    v_count INTEGER;
BEGIN
    -- Validar parâmetros obrigatórios
    IF p_conversation_id IS NULL OR p_company_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'conversation_id e company_id são obrigatórios'
        );
    END IF;

    -- Verificar se a conversa pertence à empresa
    IF NOT EXISTS (
        SELECT 1 FROM chat_conversations 
        WHERE id = p_conversation_id AND company_id = p_company_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Conversa não encontrada ou não pertence à empresa'
        );
    END IF;

    -- Buscar mensagens com paginação
    WITH ordered_messages AS (
        SELECT 
            m.id,
            m.conversation_id,
            m.company_id,
            m.instance_id,
            COALESCE(m.message_type, 'text') as message_type,
            m.content,
            m.media_url,
            m.direction,
            COALESCE(m.status, 'delivered') as status,
            COALESCE(m.is_scheduled, false) as is_scheduled,
            m.scheduled_for,
            m.sent_by,
            m.uazapi_message_id,
            COALESCE(m.timestamp, m.created_at) as timestamp,
            m.created_at,
            m.updated_at
        FROM chat_messages m
        WHERE m.conversation_id = p_conversation_id
          AND m.company_id = p_company_id
        ORDER BY COALESCE(m.timestamp, m.created_at) ASC
        LIMIT p_limit
        OFFSET p_offset
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', om.id,
                'conversation_id', om.conversation_id,
                'company_id', om.company_id,
                'instance_id', om.instance_id,
                'message_type', om.message_type,
                'content', om.content,
                'media_url', om.media_url,
                'direction', om.direction,
                'status', om.status,
                'is_scheduled', om.is_scheduled,
                'scheduled_for', om.scheduled_for,
                'sent_by', om.sent_by,
                'uazapi_message_id', om.uazapi_message_id,
                'timestamp', om.timestamp,
                'created_at', om.created_at,
                'updated_at', om.updated_at
            )
        ), '[]'::jsonb)
    INTO v_messages
    FROM ordered_messages om;

    -- Contar total de mensagens para informação
    SELECT COUNT(*)
    INTO v_count
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id = p_company_id;

    -- Retornar resultado
    RETURN jsonb_build_object(
        'success', true,
        'data', v_messages,
        'total_count', v_count,
        'limit', p_limit,
        'offset', p_offset
    );

EXCEPTION WHEN OTHERS THEN
    -- Log do erro e retorno seguro
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Erro interno: ' || SQLERRM
    );
END;
$$;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION chat_get_messages(UUID, UUID, INTEGER, INTEGER) IS 
'Busca mensagens de uma conversa específica com paginação. 
Inclui campo media_url essencial para exibição de previews de mídia no frontend.
Criada para resolver problema onde frontend não conseguia carregar mensagens.';

-- =====================================================
-- TESTE DA FUNÇÃO
-- =====================================================

-- Para testar a função (substituir UUIDs por valores reais):
-- SELECT chat_get_messages(
--     'conversation-uuid'::uuid,
--     'company-uuid'::uuid,
--     10,
--     0
-- );
