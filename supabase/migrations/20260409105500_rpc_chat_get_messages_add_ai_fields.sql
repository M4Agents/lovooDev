-- =====================================================
-- MIGRATION: Atualizar chat_get_messages para incluir campos de IA no output
-- Data: 2026-04-09
-- Etapa: 12/13
--
-- Propósito:
--   Adicionar os 4 campos de IA (is_ai_generated, ai_run_id, ai_block_index,
--   ai_block_type) ao jsonb_build_object retornado pelos dois overloads.
--
-- Estratégia:
--   CREATE OR REPLACE com a MESMA assinatura dos overloads existentes.
--   PostgreSQL substitui apenas o corpo da função — sem criar novos overloads.
--   A única mudança funcional é a adição de 4 campos no jsonb de cada mensagem.
--
--   Overload 1 (4 params): compatibilidade retroativa
--   Overload 2 (5 params): overload ativo usado pelo chatApi.ts
--
-- Compatibilidade retroativa:
--   O frontend ignora campos desconhecidos no JSON → sem breaking change.
--   Clientes antigos sem tipos atualizados continuam funcionando.
--   O campo is_ai_generated será false para mensagens existentes (DEFAULT do ALTER).
--
-- Dependências:
--   Migration 2 (campos de IA em chat_messages) deve estar aplicada antes.
--
-- Rollback:
--   Executar o arquivo .snapshots/pre-mvp-agents-20260409/db-functions/chat_get_messages.sql
-- =====================================================


-- =====================================================
-- OVERLOAD 1: 4 parâmetros (compatibilidade retroativa)
-- Assinatura idêntica ao original — apenas adiciona campos de IA no output
-- =====================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_messages JSONB;
  v_count    INTEGER;
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

  -- Buscar mensagens com paginação (corrigido)
  WITH ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')       AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')        AS status,
      COALESCE(m.is_scheduled, false)        AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      COALESCE(m.timestamp, m.created_at)   AS timestamp,
      m.created_at,
      m.updated_at,
      -- Campos de IA adicionados nesta migration
      COALESCE(m.is_ai_generated, false)    AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY COALESCE(m.timestamp, m.created_at) ASC
    LIMIT  p_limit
    OFFSET p_offset
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               om.id,
        'conversation_id',  om.conversation_id,
        'company_id',       om.company_id,
        'instance_id',      om.instance_id,
        'message_type',     om.message_type,
        'content',          om.content,
        'media_url',        om.media_url,
        'direction',        om.direction,
        'status',           om.status,
        'is_scheduled',     om.is_scheduled,
        'scheduled_for',    om.scheduled_for,
        'sent_by',          om.sent_by,
        'uazapi_message_id',om.uazapi_message_id,
        'timestamp',        om.timestamp,
        'created_at',       om.created_at,
        'updated_at',       om.updated_at,
        -- Campos de IA
        'is_ai_generated',  om.is_ai_generated,
        'ai_run_id',        om.ai_run_id,
        'ai_block_index',   om.ai_block_index,
        'ai_block_type',    om.ai_block_type
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  -- Contar total de mensagens para informação
  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id;

  RETURN jsonb_build_object(
    'success',     true,
    'data',        v_messages,
    'total_count', v_count,
    'limit',       p_limit,
    'offset',      p_offset
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;


-- =====================================================
-- OVERLOAD 2: 5 parâmetros (com p_reverse_order)
-- Overload ativo principal — usado por chatApi.ts getMessages() e getRecentMessages()
-- Assinatura idêntica ao original — apenas adiciona campos de IA no output
-- =====================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0,
  p_reverse_order   BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_messages JSONB;
  v_count    INTEGER;
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

  -- Buscar mensagens com paginação e ordenação configurável
  WITH ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')       AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')        AS status,
      COALESCE(m.is_scheduled, false)        AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      COALESCE(m.timestamp, m.created_at)   AS timestamp,
      m.created_at,
      m.updated_at,
      -- Campos de IA adicionados nesta migration
      COALESCE(m.is_ai_generated, false)    AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY
      CASE WHEN     p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END DESC,
      CASE WHEN NOT p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END ASC
    LIMIT  p_limit
    OFFSET p_offset
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               om.id,
        'conversation_id',  om.conversation_id,
        'company_id',       om.company_id,
        'instance_id',      om.instance_id,
        'message_type',     om.message_type,
        'content',          om.content,
        'media_url',        om.media_url,
        'direction',        om.direction,
        'status',           om.status,
        'is_scheduled',     om.is_scheduled,
        'scheduled_for',    om.scheduled_for,
        'sent_by',          om.sent_by,
        'uazapi_message_id',om.uazapi_message_id,
        'timestamp',        om.timestamp,
        'created_at',       om.created_at,
        'updated_at',       om.updated_at,
        -- Campos de IA
        'is_ai_generated',  om.is_ai_generated,
        'ai_run_id',        om.ai_run_id,
        'ai_block_index',   om.ai_block_index,
        'ai_block_type',    om.ai_block_type
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  -- Contar total de mensagens para informação
  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id;

  RETURN jsonb_build_object(
    'success',       true,
    'data',          v_messages,
    'total_count',   v_count,
    'limit',         p_limit,
    'offset',        p_offset,
    'reverse_order', p_reverse_order
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;
