-- =====================================================================
-- Migration H — Metadados de automação em instagram_messages
--
-- Objetivo:
--   Permitir rastrear mensagens outbound geradas por automação,
--   vinculando-as à execution, ao nó e ao flow de origem.
--   Habilita idempotência de envio por (automation_execution_id, automation_node_id):
--   antes de reenviar, o instagramSender verifica se já existe mensagem
--   outbound para essa combinação, evitando duplicidade em retries.
--
-- Campos adicionados:
--   automation_execution_id — FK para automation_executions, nullable
--   automation_node_id      — ID do nó message no flow builder
--   origin                  — 'manual' | 'automation' | 'webhook'
--
-- Sem CHECK em origin: valores podem evoluir sem nova migration.
-- FK SET NULL: se a execution for deletada, a mensagem permanece visível.
-- =====================================================================

ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS automation_execution_id UUID
    REFERENCES public.automation_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_node_id TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT;

-- Índice para idempotência por execution + node (query de dedup no sender)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_igmsg_automation_dedup
  ON public.instagram_messages (automation_execution_id, automation_node_id)
  WHERE automation_execution_id IS NOT NULL
    AND direction = 'outbound';

COMMENT ON COLUMN public.instagram_messages.automation_execution_id IS
  'UUID da automation_execution que gerou esta mensagem outbound.
   NULL para mensagens manuais ou do webhook inbound.
   Usado pelo instagramSender para dedup: impede reenvio em retries.';

COMMENT ON COLUMN public.instagram_messages.automation_node_id IS
  'ID do nó message no flow builder que gerou este envio.
   Combinado com automation_execution_id forma a chave de idempotência.';

COMMENT ON COLUMN public.instagram_messages.origin IS
  'Origem da mensagem: manual | automation | webhook.
   NULL = legado (mensagens anteriores a esta migration).';
