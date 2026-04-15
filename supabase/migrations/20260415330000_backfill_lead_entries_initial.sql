-- MIGRATION: Backfill de lead_entries para leads já existentes no sistema
--
-- Contexto:
--   O trigger zz_create_initial_lead_entry (migration anterior) cobre apenas
--   novos leads inseridos a partir de agora. Esta migration cria a entrada
--   inicial para todos os leads válidos já existentes no banco.
--
-- Critério de inclusão:
--   - is_duplicate = false  → exclui registros órfãos pré-fix de deduplicação;
--                             não representam identidades reais
--   - deleted_at IS NULL    → exclui leads soft-deleted; não devem inflar relatórios
--
-- Idempotência:
--   ON CONFLICT (company_id, idempotency_key) DO NOTHING
--   Re-executar esta migration (ou rodar após o trigger já ter criado entradas
--   para leads novos) é seguro — conflitos são silenciados.
--
-- metadata.backfilled = true permite identificar entradas retroativas em
-- consultas e relatórios futuros.

INSERT INTO lead_entries (
  company_id,
  lead_id,
  source,
  origin_channel,
  external_event_id,
  idempotency_key,
  metadata,
  created_at
)
SELECT
  l.company_id,
  l.id,
  CASE l.origin
    WHEN 'webhook_ultra_simples' THEN 'webhook'
    WHEN 'whatsapp'              THEN 'whatsapp'
    WHEN 'api'                   THEN 'webhook'
    ELSE                              'manual'
  END,
  NULL,                             -- origin_channel: sem dado de canal retroativo
  NULL,                             -- external_event_id: sem event_id na primeira entrada
  'init_' || l.id::text,           -- chave idempotente, mesma lógica do trigger
  '{"backfilled": true}'::jsonb,   -- marcação para rastreabilidade
  l.created_at                      -- data real da primeira entrada original
FROM leads l
WHERE l.is_duplicate = false
  AND l.deleted_at IS NULL
ON CONFLICT (company_id, idempotency_key) DO NOTHING;
