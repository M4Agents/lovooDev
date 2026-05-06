-- =====================================================================
-- Migration: Adicionar agregação de reações ao chat_get_messages
-- Data: 2026-05-06
--
-- Objetivo:
--   Retornar campos de reação por mensagem em ambos os overloads:
--     - reactions:     [{emoji, count, reacted_by_me}]  ou NULL
--     - my_reaction:   string | NULL  (emoji do usuário, se p_user_id fornecido)
--
-- Parâmetro adicionado:
--   p_user_id uuid DEFAULT NULL — identifica o usuário para "reacted_by_me"
--
-- Performance (Ajuste Conceitual 4):
--   A agregação é feita em CTEs encadeados que PRIMEIRO paginam por IDs,
--   depois buscam reações APENAS para esses IDs via:
--     idx_chat_reactions_company_message (company_id, message_id) WHERE removed_at IS NULL
--   Nenhuma varredura global da tabela chat_message_reactions.
--
-- Assinaturas:
--   Overload A: (uuid, uuid, int, int, uuid)          — substitui 4-param
--   Overload B: (uuid, uuid, int, int, bool, uuid)    — substitui 5-param
--   DROP das antigas antes de CREATE para evitar ambiguidade de overload.
-- =====================================================================


-- =====================================================================
-- Drop overloads antigos para evitar ambiguidade de resolução
-- =====================================================================

DROP FUNCTION IF EXISTS public.chat_get_messages(uuid, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.chat_get_messages(uuid, uuid, integer, integer, boolean);


-- =====================================================================
-- OVERLOAD A: substituição do antigo 4-parâmetros
-- Assinatura: (conversation_id, company_id, limit, offset, user_id?)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0,
  p_user_id         UUID    DEFAULT NULL
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

  WITH paginated_ids AS (
    -- Passo 1: obter IDs da página (usa índice em conversation_id + company_id)
    SELECT m.id,
           COALESCE(m.timestamp, m.created_at) AS sort_ts
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY COALESCE(m.timestamp, m.created_at) ASC
    LIMIT  p_limit
    OFFSET p_offset
  ),
  emoji_counts AS (
    -- Passo 2: agregar reações SOMENTE para os IDs paginados
    -- Usa idx_chat_reactions_company_message (company_id, message_id) WHERE removed_at IS NULL
    SELECT
      r.message_id,
      r.emoji,
      COUNT(*)                                                           AS cnt,
      bool_or(p_user_id IS NOT NULL AND r.user_id = p_user_id)          AS reacted_by_me
    FROM chat_message_reactions r
    WHERE r.message_id  IN (SELECT id FROM paginated_ids)
      AND r.company_id   = p_company_id
      AND r.removed_at   IS NULL
    GROUP BY r.message_id, r.emoji
  ),
  reaction_aggs AS (
    -- Passo 3: montar JSONB por mensagem
    SELECT
      ec.message_id,
      jsonb_agg(
        jsonb_build_object(
          'emoji',         ec.emoji,
          'count',         ec.cnt,
          'reacted_by_me', ec.reacted_by_me
        )
        ORDER BY ec.cnt DESC
      ) AS reactions,
      MAX(CASE WHEN ec.reacted_by_me THEN ec.emoji END) AS my_reaction
    FROM emoji_counts ec
    GROUP BY ec.message_id
  ),
  ordered_messages AS (
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
      pi.sort_ts                           AS timestamp,
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
      rm.message_type                      AS reply_to_message_type,
      -- Campos de reação
      ra.reactions                         AS reactions,
      ra.my_reaction                       AS my_reaction
    FROM paginated_ids pi
    JOIN chat_messages m ON m.id = pi.id
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
    LEFT JOIN reaction_aggs ra ON ra.message_id = m.id
    ORDER BY pi.sort_ts ASC
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    om.id,
        'conversation_id',       om.conversation_id,
        'company_id',            om.company_id,
        'instance_id',           om.instance_id,
        'message_type',          om.message_type,
        'content',               om.content,
        'media_url',             om.media_url,
        'direction',             om.direction,
        'status',                om.status,
        'is_scheduled',          om.is_scheduled,
        'scheduled_for',         om.scheduled_for,
        'sent_by',               om.sent_by,
        'uazapi_message_id',     om.uazapi_message_id,
        'timestamp',             om.timestamp,
        'created_at',            om.created_at,
        'updated_at',            om.updated_at,
        'is_ai_generated',       om.is_ai_generated,
        'ai_run_id',             om.ai_run_id,
        'ai_block_index',        om.ai_block_index,
        'ai_block_type',         om.ai_block_type,
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type,
        'reactions',             om.reactions,
        'my_reaction',           om.my_reaction
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


-- =====================================================================
-- OVERLOAD B: substituição do antigo 5-parâmetros (com p_reverse_order)
-- Assinatura: (conversation_id, company_id, limit, offset, reverse_order, user_id?)
-- Este é o overload principal chamado por chatApi.ts
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0,
  p_reverse_order   BOOLEAN DEFAULT false,
  p_user_id         UUID    DEFAULT NULL
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

  WITH paginated_ids AS (
    -- Passo 1: obter IDs da página com ordenação configurável
    SELECT m.id,
           COALESCE(m.timestamp, m.created_at) AS sort_ts
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY
      CASE WHEN     p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END DESC,
      CASE WHEN NOT p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END ASC
    LIMIT  p_limit
    OFFSET p_offset
  ),
  emoji_counts AS (
    -- Passo 2: reações SOMENTE para os IDs paginados (sem varredura global)
    SELECT
      r.message_id,
      r.emoji,
      COUNT(*)                                                           AS cnt,
      bool_or(p_user_id IS NOT NULL AND r.user_id = p_user_id)          AS reacted_by_me
    FROM chat_message_reactions r
    WHERE r.message_id  IN (SELECT id FROM paginated_ids)
      AND r.company_id   = p_company_id
      AND r.removed_at   IS NULL
    GROUP BY r.message_id, r.emoji
  ),
  reaction_aggs AS (
    SELECT
      ec.message_id,
      jsonb_agg(
        jsonb_build_object(
          'emoji',         ec.emoji,
          'count',         ec.cnt,
          'reacted_by_me', ec.reacted_by_me
        )
        ORDER BY ec.cnt DESC
      ) AS reactions,
      MAX(CASE WHEN ec.reacted_by_me THEN ec.emoji END) AS my_reaction
    FROM emoji_counts ec
    GROUP BY ec.message_id
  ),
  ordered_messages AS (
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
      pi.sort_ts                           AS timestamp,
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
      rm.message_type                      AS reply_to_message_type,
      -- Campos de reação
      ra.reactions                         AS reactions,
      ra.my_reaction                       AS my_reaction
    FROM paginated_ids pi
    JOIN chat_messages m ON m.id = pi.id
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
    LEFT JOIN reaction_aggs ra ON ra.message_id = m.id
    ORDER BY
      CASE WHEN     p_reverse_order THEN pi.sort_ts END DESC,
      CASE WHEN NOT p_reverse_order THEN pi.sort_ts END ASC
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    om.id,
        'conversation_id',       om.conversation_id,
        'company_id',            om.company_id,
        'instance_id',           om.instance_id,
        'message_type',          om.message_type,
        'content',               om.content,
        'media_url',             om.media_url,
        'direction',             om.direction,
        'status',                om.status,
        'is_scheduled',          om.is_scheduled,
        'scheduled_for',         om.scheduled_for,
        'sent_by',               om.sent_by,
        'uazapi_message_id',     om.uazapi_message_id,
        'timestamp',             om.timestamp,
        'created_at',            om.created_at,
        'updated_at',            om.updated_at,
        'is_ai_generated',       om.is_ai_generated,
        'ai_run_id',             om.ai_run_id,
        'ai_block_index',        om.ai_block_index,
        'ai_block_type',         om.ai_block_type,
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type,
        'reactions',             om.reactions,
        'my_reaction',           om.my_reaction
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
