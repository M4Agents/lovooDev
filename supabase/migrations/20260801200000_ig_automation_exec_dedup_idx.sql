-- =====================================================================
-- Migration D — Idempotência da execution por flow Instagram
--
-- ATENÇÃO: Este arquivo NÃO usa BEGIN/COMMIT explícito.
--   CREATE INDEX CONCURRENTLY não pode executar dentro de bloco
--   transacional. Mesmo motivo da Migration C.
--
-- Contexto:
--   dispatchMessageReceivedTrigger cria uma automation_execution por
--   flow correspondente ao evento. Em caso de retry do schedule
--   (ex.: schedule reprocessado após falha parcial), a execution do
--   flow A já criada não pode ser duplicada.
--
-- Problema sem este índice:
--   Schedule processa flow A (execution criada) → flow B falha →
--   schedule vai para pending novamente → retry processa flow A +
--   flow B → execution duplicada para flow A + ig_message_id.
--
-- Solução:
--   Chave única: (company_id, flow_id, ig_message_id) para executions
--   do canal instagram. O dispatcher trata erro 23505 como
--   "já existe" e continua para o próximo flow sem erro operacional.
--
-- Sem nova coluna:
--   Usa índice funcional extraindo trigger_data->>'ig_message_id'.
--   Menor footprint: sem ALTER TABLE, sem migration de schema.
--
-- Query preventiva complementar no dispatcher (não substitui o índice):
--   SELECT id FROM automation_executions
--   WHERE company_id = $1 AND flow_id = $2
--     AND trigger_data->>'ig_message_id' = $3
--     AND trigger_data->>'channel' = 'instagram'
--   LIMIT 1
--
-- Volume: 61.038 rows → CONCURRENTLY preferível.
-- =====================================================================

CREATE UNIQUE INDEX CONCURRENTLY idx_ae_ig_execution_dedup
  ON automation_executions (
    company_id,
    flow_id,
    (trigger_data->>'ig_message_id')
  )
  WHERE trigger_data->>'channel' = 'instagram'
    AND trigger_data->>'ig_message_id' IS NOT NULL;

COMMENT ON INDEX idx_ae_ig_execution_dedup IS
  'Garante que cada (empresa, flow, ig_message_id) gere no máximo uma
   execution do canal Instagram. Protege contra duplicate executions em
   retries do schedule. O dispatcher trata 23505 deste índice como
   execução já existente (sucesso idempotente), não como erro.';
