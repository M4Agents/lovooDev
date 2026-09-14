-- =============================================================================
-- Meta WhatsApp Cloud API — Fase 1A / Migration 1 de 4
-- Feature flag por empresa: companies.meta_whatsapp_enabled
--
-- Objetivo:
--   Adicionar coluna de rollout por empresa para o módulo Meta WhatsApp Cloud API.
--   DEFAULT false: nenhuma empresa é habilitada automaticamente por esta migration.
--
-- Impacto:
--   BAIXO. Backward-compatible. ADD COLUMN com DEFAULT constante.
--   PostgreSQL 15+: operação de metadata-only, sem reescrita de tabela.
--   Lock brevíssimo (AccessExclusiveLock) em companies.
--
-- Objetos alterados:
--   public.companies (ADD COLUMN)
--
-- Objetos NÃO alterados:
--   Nenhum objeto Uazapi, WhatsApp Life, chat, automação ou agente.
--
-- Ativação futura:
--   UPDATE public.companies SET meta_whatsapp_enabled = true WHERE id = '<uuid>';
--   Executar manualmente via backend ou Dashboard (service_role) por platform admin.
--   NÃO incluir company_id específico em migration versionada.
--
-- Rollback:
--   ALTER TABLE public.companies DROP COLUMN meta_whatsapp_enabled;
--   (Remove automaticamente: qualquer índice ou constraint na coluna)
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN meta_whatsapp_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.meta_whatsapp_enabled IS
  'Feature flag do módulo Meta WhatsApp Cloud API para esta empresa. '
  'DEFAULT false: nenhuma empresa é habilitada automaticamente. '
  'Ativação: UPDATE direto via backend ou Dashboard (service_role) por platform admin. '
  'Não utilizar plans.features para este controle de rollout.';
