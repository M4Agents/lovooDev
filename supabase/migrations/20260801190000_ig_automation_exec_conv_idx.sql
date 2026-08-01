-- =====================================================================
-- Migration C — Índice de serialização por conversa Instagram
--
-- ATENÇÃO: Este arquivo NÃO usa BEGIN/COMMIT explícito.
--   CREATE INDEX CONCURRENTLY não pode executar dentro de bloco
--   transacional. O Supabase CLI aplica esta migration em autocommit.
--   Precedente no projeto: perf_phase1b_indexes.sql, perf_phase1_indexes.sql.
--
-- Contexto:
--   O cron api/automation/process-instagram-triggers.ts, antes de
--   processar um schedule, verifica se já existe uma execution com
--   status = 'running' para a mesma empresa e conversa.
--   Apenas status 'running' bloqueia serialização — 'paused' não
--   bloqueia, pois pode representar delay de horas.
--
-- Query suportada pelo índice:
--   SELECT id FROM automation_executions
--   WHERE company_id        = $1
--     AND status            = 'running'
--     AND trigger_data->>'channel'          = 'instagram'
--     AND trigger_data->>'conversation_id'  = $2
--   LIMIT 1
--
-- Design:
--   Colunas: (company_id, (trigger_data->>'conversation_id'))
--   Predicado: channel = 'instagram' AND status = 'running'
--   company_id incluído: toda query é multi-tenant.
--
-- Volume: 61.038 rows → CONCURRENTLY preferível para minimizar lock.
-- =====================================================================

CREATE INDEX CONCURRENTLY idx_ae_ig_running_conversation
  ON automation_executions (
    company_id,
    (trigger_data->>'conversation_id')
  )
  WHERE trigger_data->>'channel' = 'instagram'
    AND status = 'running';

COMMENT ON INDEX idx_ae_ig_running_conversation IS
  'Suporta a query de serialização do cron Instagram.
   Localiza executions running por empresa e conversation_id.
   Apenas status running bloqueia; paused não bloqueia novas DMs.
   Garante que company_id está sempre no predicado da busca.';
