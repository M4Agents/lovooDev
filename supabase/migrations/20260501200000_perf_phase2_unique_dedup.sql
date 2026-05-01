-- Fase 2: limpeza de duplicatas e índice UNIQUE em chat_messages(company_id, uazapi_message_id)
-- Diagnóstico prévio confirmou 6 grupos / 10 linhas duplicadas (race condition corrigida em 20260501130000).
-- Backup criado em public.chat_messages_dedup_backup_20260501 antes da limpeza.

-- 1. Backup das linhas removidas (executado antes do DELETE via execute_sql)
-- CREATE TABLE IF NOT EXISTS public.chat_messages_dedup_backup_20260501 AS
-- SELECT cm.* FROM public.chat_messages cm
-- WHERE cm.id IN (
--   SELECT id FROM (
--     SELECT id,
--       ROW_NUMBER() OVER (PARTITION BY company_id, uazapi_message_id ORDER BY created_at ASC, id ASC) AS rn
--     FROM public.chat_messages WHERE uazapi_message_id IS NOT NULL
--   ) ranked WHERE rn > 1
-- );

-- 2. DELETE das 10 linhas duplicadas (executado via execute_sql — confirmado DELETE 10)
-- DELETE FROM public.chat_messages
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT id,
--       ROW_NUMBER() OVER (PARTITION BY company_id, uazapi_message_id ORDER BY created_at ASC, id ASC) AS rn
--     FROM public.chat_messages WHERE uazapi_message_id IS NOT NULL
--   ) ranked WHERE rn > 1
-- );

-- 3. UNIQUE INDEX para deduplicação futura de mensagens Uazapi
-- Garante que o mesmo uazapi_message_id não seja inserido mais de uma vez por empresa.
-- Protege contra reprocessamento de webhooks duplicados.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_uazapi_dedup
  ON public.chat_messages (company_id, uazapi_message_id)
  WHERE uazapi_message_id IS NOT NULL;

-- Rollback do índice:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_chat_messages_uazapi_dedup;
-- Rollback das linhas:
-- INSERT INTO public.chat_messages SELECT * FROM public.chat_messages_dedup_backup_20260501;
