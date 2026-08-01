-- =====================================================
-- MIGRATION: Adicionar last_inbound_at em chat_conversations
-- Data: 2026-08-01
--
-- Propósito:
--   Registrar o timestamp da última mensagem INBOUND do lead.
--   Distinto de last_message_at (que inclui mensagens do agente/outbound).
--   Usado pelo cron check-lead-absence para detectar ausência real do lead.
--
-- Backfill:
--   67.468 mensagens inbound no banco (verificado via readonly query).
--   Executado em único UPDATE — seguro para esse volume.
--
-- Trigger:
--   SECURITY DEFINER: garante execução mesmo quando o INSERT em
--   chat_messages é feito por authenticated com visibilidade restrita,
--   que não poderia fazer UPDATE em chat_conversations via INVOKER.
--   Função estritamente escoped: apenas atualiza last_inbound_at,
--   filtra por conversation_id + company_id, sem SQL dinâmico.
--
-- Índice:
--   Criado com CREATE INDEX IF NOT EXISTS (não CONCURRENTLY —
--   não suportado dentro de transação de migration).
--   Cobre a query do cron: ai_state='ai_active' + ai_assignment_id IS NOT NULL.
-- =====================================================

-- 1. Adicionar coluna
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.chat_conversations.last_inbound_at IS
  'Timestamp da última mensagem inbound (do lead) nesta conversa. '
  'Atualizado pelo trigger trg_update_last_inbound_at em chat_messages. '
  'Distinto de last_message_at (que inclui outbound/agente). '
  'Usado pelo cron check-lead-absence para detectar ausência real do lead.';

-- 2. Trigger function
--    SECURITY DEFINER: garante execução com privilégios do owner da função,
--    independente de quem disparou o INSERT em chat_messages.
--    SET search_path protege contra search_path injection.
CREATE OR REPLACE FUNCTION public.trg_update_last_inbound_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.chat_conversations
    SET last_inbound_at = NEW.created_at
    WHERE id         = NEW.conversation_id
      AND company_id = NEW.company_id
      AND (
        last_inbound_at IS NULL
        OR NEW.created_at > last_inbound_at
      );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger (idempotente via DROP IF EXISTS)
DROP TRIGGER IF EXISTS trg_update_last_inbound_at ON public.chat_messages;

CREATE TRIGGER trg_update_last_inbound_at
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_last_inbound_at();

-- 4. Backfill das conversas existentes
--    Usa índice existente: idx_chat_messages_conv_inbound
--    ON public.chat_messages (company_id, conversation_id, created_at)
--    WHERE direction = 'inbound'
UPDATE public.chat_conversations cc
SET last_inbound_at = subq.last_inbound
FROM (
  SELECT
    conversation_id,
    MAX(created_at) AS last_inbound
  FROM public.chat_messages
  WHERE direction = 'inbound'
  GROUP BY conversation_id
) subq
WHERE cc.id = subq.conversation_id
  AND (
    cc.last_inbound_at IS NULL
    OR cc.last_inbound_at < subq.last_inbound
  );

-- 5. Índice para o cron check-lead-absence
--    Cobre: company_id + ai_assignment_id + last_inbound_at
--    Filtrado para conversas com IA ativa (WHERE reduz footprint)
--    NÃO usar CONCURRENTLY dentro de migration transacional
CREATE INDEX IF NOT EXISTS idx_chat_conv_ai_active_inbound_at
  ON public.chat_conversations (company_id, ai_assignment_id, last_inbound_at)
  WHERE ai_state       = 'ai_active'
    AND ai_assignment_id IS NOT NULL;
