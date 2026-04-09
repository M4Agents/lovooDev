-- =====================================================
-- MIGRATION: Atualizar chat_get_messages_before_timestamp com campos de IA
-- Data: 2026-04-09
-- Etapa: 13/13
--
-- Propósito:
--   Adicionar os 4 campos de IA (is_ai_generated, ai_run_id, ai_block_index,
--   ai_block_type) ao jsonb_build_object retornado por esta função.
--
-- Estratégia:
--   CREATE OR REPLACE com a MESMA assinatura da função existente.
--   PostgreSQL substitui apenas o corpo — sem criar novo overload.
--   A única mudança funcional é a adição de 4 campos no jsonb de cada mensagem.
--
-- Compatibilidade retroativa:
--   O frontend ignora campos desconhecidos no JSON → sem breaking change.
--   is_ai_generated será false para mensagens existentes (DEFAULT do ALTER).
--   Assinatura, comportamento e retorno de paginação permanecem idênticos.
--
-- Dependências:
--   Migration 2 (campos de IA em chat_messages) deve estar aplicada antes.
--
-- Rollback:
--   Executar .snapshots/pre-mvp-agents-20260409/db-functions/chat_get_messages_before_timestamp.sql
-- =====================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages_before_timestamp(
  p_conversation_id   UUID,
  p_company_id        UUID,
  p_before_timestamp  TIMESTAMP WITH TIME ZONE,
  p_limit             INTEGER DEFAULT 20
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
      AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp
    ORDER BY COALESCE(m.timestamp, m.created_at) DESC
    LIMIT p_limit
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
      ORDER BY om.timestamp ASC  -- Retornar em ordem cronológica (igual ao original)
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  -- Contar quantas mensagens ainda existem antes do timestamp
  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id
    AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp;

  RETURN jsonb_build_object(
    'success',          true,
    'data',             v_messages,
    'remaining_count',  v_count,
    'limit',            p_limit,
    'before_timestamp', p_before_timestamp
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;
