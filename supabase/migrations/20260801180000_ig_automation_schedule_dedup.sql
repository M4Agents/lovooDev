-- =====================================================================
-- Migration B — Idempotência permanente do schedule Instagram
--
-- Contexto:
--   Para entity_type = 'instagram_dm_received', a coluna entity_id
--   armazena o ig_message_id (identificador único da mensagem no Meta).
--   Nos schedules de delay, entity_id armazena node.id — significado
--   polimórfico por entity_type, sem conflito.
--
-- Objetivo:
--   Impedir que o mesmo ig_message_id gere mais de um schedule por
--   empresa, mesmo que a Meta reenvie o webhook ou que o sistema sofra
--   retry. A idempotência é PERMANENTE: schedules com status processed
--   ou failed também bloqueiam reinserção do mesmo evento.
--
-- Decisão de design:
--   entity_type consta apenas no predicado WHERE (não nas colunas).
--   O predicado parcial já garante que apenas rows instagram_dm_received
--   são cobertas pelo índice. Incluir entity_type nas colunas seria
--   redundante e aumentaria o tamanho do índice sem ganho.
--
-- Unicidade:
--   (company_id, entity_id) WHERE entity_type = 'instagram_dm_received'
--   AND entity_id IS NOT NULL
--
--   Sem filtro de status: a unicidade é independente de pending/
--   processing/processed/failed.
--
-- Uso no código (api/instagram/webhook.js):
--   INSERT INTO automation_schedules (...) VALUES (...)
--   → em caso de erro código '23505', tratar como sucesso idempotente.
--   Não usar upsert do PostgREST com onConflict — índice parcial não é
--   reconhecido de forma confiável pelo PostgREST.
--
-- Volume: 843 rows → CREATE INDEX normal (sem CONCURRENTLY necessário).
-- =====================================================================

CREATE UNIQUE INDEX idx_ig_dm_dedup
  ON automation_schedules (company_id, entity_id)
  WHERE entity_type = 'instagram_dm_received'
    AND entity_id IS NOT NULL;

COMMENT ON INDEX idx_ig_dm_dedup IS
  'Idempotência permanente de schedules instagram_dm_received por empresa.
   entity_id = ig_message_id para este entity_type.
   Cobre todos os status (pending/processing/processed/failed).
   Schedules de delay não são afetados (predicado parcial).
   Uso: INSERT + captura de código 23505 no webhook.';
