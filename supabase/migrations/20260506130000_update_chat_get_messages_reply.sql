-- =====================================================================
-- Migration: Atualizar chat_get_messages com campos de reply
-- Data: 2026-05-06
--
-- Objetivo:
--   Retornar campos de reply em ambos os overloads de chat_get_messages:
--     - reply_to_message_id    (UUID da mensagem original)
--     - reply_to_content       (texto da mensagem original — truncado)
--     - reply_to_direction     (inbound | outbound)
--     - reply_to_message_type  (text | image | document | audio | video)
--
-- Estratégia:
--   LEFT JOIN em chat_messages para buscar dados da mensagem original.
--   Sem JOIN quando reply_to_message_id é NULL (maioria dos casos).
--
-- Compatibilidade retroativa:
--   Campos novos são adicionados ao jsonb — clientes antigos ignoram.
--   Assinaturas das funções não mudam.
-- =====================================================================


-- =====================================================
-- OVERLOAD 1: 4 parâmetros (compatibilidade retroativa)
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
  IF p_conversation_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'conversation_id e company_id são obrigatórios'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence à empresa'
    );
  END IF;

  WITH ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')     AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')      AS status,
      COALESCE(m.is_scheduled, false)      AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      COALESCE(m.timestamp, m.created_at)  AS timestamp,
      m.created_at,
      m.updated_at,
      COALESCE(m.is_ai_generated, false)   AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type,
      -- Campos de reply
      m.reply_to_message_id,
      rm.content                           AS reply_to_content,
      rm.direction                         AS reply_to_direction,
      rm.message_type                      AS reply_to_message_type
    FROM chat_messages m
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY COALESCE(m.timestamp, m.created_at) ASC
    LIMIT  p_limit
    OFFSET p_offset
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                  om.id,
        'conversation_id',     om.conversation_id,
        'company_id',          om.company_id,
        'instance_id',         om.instance_id,
        'message_type',        om.message_type,
        'content',             om.content,
        'media_url',           om.media_url,
        'direction',           om.direction,
        'status',              om.status,
        'is_scheduled',        om.is_scheduled,
        'scheduled_for',       om.scheduled_for,
        'sent_by',             om.sent_by,
        'uazapi_message_id',   om.uazapi_message_id,
        'timestamp',           om.timestamp,
        'created_at',          om.created_at,
        'updated_at',          om.updated_at,
        'is_ai_generated',     om.is_ai_generated,
        'ai_run_id',           om.ai_run_id,
        'ai_block_index',      om.ai_block_index,
        'ai_block_type',       om.ai_block_type,
        -- Campos de reply
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

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
-- Overload ativo principal — usado por chatApi.ts
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
  IF p_conversation_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'conversation_id e company_id são obrigatórios'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence à empresa'
    );
  END IF;

  WITH ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')     AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')      AS status,
      COALESCE(m.is_scheduled, false)      AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      COALESCE(m.timestamp, m.created_at)  AS timestamp,
      m.created_at,
      m.updated_at,
      COALESCE(m.is_ai_generated, false)   AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type,
      -- Campos de reply
      m.reply_to_message_id,
      rm.content                           AS reply_to_content,
      rm.direction                         AS reply_to_direction,
      rm.message_type                      AS reply_to_message_type
    FROM chat_messages m
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
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
        'id',                  om.id,
        'conversation_id',     om.conversation_id,
        'company_id',          om.company_id,
        'instance_id',         om.instance_id,
        'message_type',        om.message_type,
        'content',             om.content,
        'media_url',           om.media_url,
        'direction',           om.direction,
        'status',              om.status,
        'is_scheduled',        om.is_scheduled,
        'scheduled_for',       om.scheduled_for,
        'sent_by',             om.sent_by,
        'uazapi_message_id',   om.uazapi_message_id,
        'timestamp',           om.timestamp,
        'created_at',          om.created_at,
        'updated_at',          om.updated_at,
        'is_ai_generated',     om.is_ai_generated,
        'ai_run_id',           om.ai_run_id,
        'ai_block_index',      om.ai_block_index,
        'ai_block_type',       om.ai_block_type,
        -- Campos de reply
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

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
