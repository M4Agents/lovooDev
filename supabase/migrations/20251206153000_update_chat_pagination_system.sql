-- =====================================================
-- MIGRAÇÃO: Sistema de Paginação Inversa para Chat
-- =====================================================
-- Data: 06/12/2025 15:30
-- Objetivo: Implementar carregamento eficiente de mensagens
-- Benefícios: Performance, UX moderna, previews de mídia funcionando

-- =====================================================
-- FUNÇÃO: chat_get_messages_before_timestamp
-- =====================================================
-- Função auxiliar para carregar mensagens antigas (scroll infinito)

CREATE OR REPLACE FUNCTION chat_get_messages_before_timestamp(
    p_conversation_id UUID,
    p_company_id UUID,
    p_before_timestamp TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 20
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
    IF p_conversation_id IS NULL OR p_company_id IS NULL OR p_before_timestamp IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'conversation_id, company_id e before_timestamp são obrigatórios'
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

    -- Buscar mensagens anteriores ao timestamp fornecido
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
          AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp
        ORDER BY COALESCE(m.timestamp, m.created_at) DESC
        LIMIT p_limit
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
            ORDER BY om.timestamp ASC  -- Retornar em ordem cronológica
        ), '[]'::jsonb)
    INTO v_messages
    FROM ordered_messages om;

    -- Contar quantas mensagens ainda existem antes do timestamp
    SELECT COUNT(*)
    INTO v_count
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id = p_company_id
      AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp;

    -- Retornar resultado
    RETURN jsonb_build_object(
        'success', true,
        'data', v_messages,
        'remaining_count', v_count,
        'limit', p_limit,
        'before_timestamp', p_before_timestamp
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

COMMENT ON FUNCTION chat_get_messages_before_timestamp(UUID, UUID, TIMESTAMPTZ, INTEGER) IS 
'Busca mensagens anteriores a um timestamp específico para implementar scroll infinito.
Usado para carregar mensagens antigas quando usuário rola para cima no chat.
Retorna mensagens em ordem cronológica (mais antigas primeiro).';

-- =====================================================
-- TESTE DAS FUNÇÕES
-- =====================================================

-- Para testar as funções (substituir UUIDs por valores reais):
-- 
-- 1. Buscar mensagens recentes:
-- SELECT chat_get_messages(
--     'conversation-uuid'::uuid,
--     'company-uuid'::uuid,
--     30,
--     0,
--     true  -- ordenação reversa (mais recentes primeiro)
-- );
--
-- 2. Buscar mensagens antigas:
-- SELECT chat_get_messages_before_timestamp(
--     'conversation-uuid'::uuid,
--     'company-uuid'::uuid,
--     '2025-12-06T12:00:00Z'::timestamptz,
--     20
-- );
