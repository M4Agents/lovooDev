-- =====================================================================
-- Fix: race condition em get_pending_scheduled_messages
-- =====================================================================
-- Problema: duas invocações simultâneas do cron Vercel liam a mesma
-- mensagem como 'pending' antes de qualquer uma marcar como 'sent',
-- causando envio duplicado.
--
-- Solução: padrão de "atomic claim" via UPDATE ... FOR UPDATE SKIP LOCKED.
-- A função agora reclama as mensagens atomicamente setando status='processing',
-- impedindo que invocações concorrentes processem a mesma mensagem.
-- Mensagens presas em 'processing' por mais de 5 min voltam para 'pending'.
-- =====================================================================

-- 1. Adicionar 'processing' ao CHECK constraint de status
ALTER TABLE chat_scheduled_messages
  DROP CONSTRAINT chat_scheduled_messages_status_check;

ALTER TABLE chat_scheduled_messages
  ADD CONSTRAINT chat_scheduled_messages_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'));

-- 2. Atualizar índice parcial para cobrir pending + processing
DROP INDEX IF EXISTS idx_chat_scheduled_messages_scheduled_for;

CREATE INDEX idx_chat_scheduled_messages_scheduled_for
  ON chat_scheduled_messages(scheduled_for)
  WHERE status IN ('pending', 'processing');

-- 3. Reescrever get_pending_scheduled_messages com atomic claim
-- Nota: aliases de tabela são obrigatórios para evitar ambiguidade entre
-- os nomes das colunas de RETURNS TABLE (que viram variáveis PL/pgSQL)
-- e as colunas da tabela chat_scheduled_messages dentro do corpo da função.
CREATE OR REPLACE FUNCTION get_pending_scheduled_messages()
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  company_id UUID,
  instance_id UUID,
  created_by UUID,
  content TEXT,
  message_type TEXT,
  media_url TEXT,
  scheduled_for TIMESTAMPTZ,
  recurring_type TEXT,
  recurring_config JSONB,
  contact_phone TEXT,
  contact_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Limpar mensagens presas em 'processing' há mais de 5 minutos
  UPDATE chat_scheduled_messages AS stale
  SET status = 'pending', updated_at = NOW()
  WHERE stale.status = 'processing'
    AND stale.updated_at < NOW() - INTERVAL '5 minutes';

  -- Reclamar atomicamente as mensagens pendentes.
  -- FOR UPDATE SKIP LOCKED garante que invocações concorrentes do cron
  -- não processam a mesma mensagem simultaneamente.
  RETURN QUERY
  WITH claimed AS (
    UPDATE chat_scheduled_messages AS t
    SET status = 'processing', updated_at = NOW()
    WHERE t.id IN (
      SELECT s.id FROM chat_scheduled_messages s
      WHERE s.status = 'pending'
        AND s.scheduled_for <= NOW()
      ORDER BY s.scheduled_for ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    RETURNING t.id, t.conversation_id, t.company_id, t.instance_id, t.created_by,
              t.content, t.message_type, t.media_url, t.scheduled_for,
              t.recurring_type, t.recurring_config
  )
  SELECT
    c.id, c.conversation_id, c.company_id, c.instance_id, c.created_by,
    c.content, c.message_type, c.media_url, c.scheduled_for,
    c.recurring_type, c.recurring_config,
    cc.contact_phone, cc.contact_name
  FROM claimed c
  LEFT JOIN chat_conversations cc ON c.conversation_id = cc.id;
END;
$$;

COMMENT ON FUNCTION get_pending_scheduled_messages IS
  'Retorna e reclama atomicamente mensagens pendentes (scheduled_for <= NOW()). '
  'Usa FOR UPDATE SKIP LOCKED para evitar processamento duplicado em invocações concorrentes. '
  'Mensagens presas em processing por mais de 5 minutos são automaticamente resetadas para pending.';
