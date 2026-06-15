-- =============================================================================
-- Fase 0b: Documentação de gap de versionamento — deleted_at em whatsapp_life_instances
-- Data: 2026-06-15
--
-- Contexto:
--   A tabela whatsapp_life_instances foi criada em 20241117 sem a coluna
--   deleted_at. A coluna foi adicionada diretamente no banco sem migration
--   correspondente, provavelmente entre nov/2024 e mar/2026 (a primeira
--   migration que a usa é 20260326152800).
--
--   Schema confirmado em 2026-06-15 via information_schema:
--     column_name: deleted_at
--     data_type:   timestamp with time zone
--     is_nullable: YES
--     column_default: null
--
-- Impacto em produção:
--   ADD COLUMN IF NOT EXISTS é idempotente — não altera a coluna se já existir.
--   Sem risco de lock ou downtime.
--
-- RPCs que dependem desta coluna (exemplos):
--   - get_instance_for_webhook         (deleted_at IS NULL)
--   - safe_delete_instance             (SET deleted_at = NOW())
--   - check_whatsapp_life_plan_limit   (deleted_at IS NULL)
--   - chat_create_or_get_conversation  (deleted_at IS NULL)
--   - create_lead_from_whatsapp_safe   (indireto via instância)
-- =============================================================================

ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.whatsapp_life_instances.deleted_at IS
'Soft delete: preenchido via safe_delete_instance RPC. '
'NULL = instância ativa. '
'Coluna documentada em 2026-06-15: existia em produção sem migration correspondente no repositório.';
