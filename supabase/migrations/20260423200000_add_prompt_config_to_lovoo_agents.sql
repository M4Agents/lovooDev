-- =============================================================================
-- Migration: add prompt_config and prompt_version to lovoo_agents
--
-- ADITIVA: apenas ADD COLUMN — nenhuma coluna existente é alterada.
--
-- prompt_config  JSONB NULL  → NULL = modo legacy (comportamento atual intacto)
--                              não-NULL = modo structured (builder por seções)
--
-- prompt_version INTEGER     → versão para optimistic locking
--                              DEFAULT 1: todos os agentes existentes herdam 1
--                              incrementado em todo UPDATE (legacy e structured)
--                              structured UPDATE verifica WHERE prompt_version = N
-- =============================================================================

ALTER TABLE lovoo_agents
  ADD COLUMN IF NOT EXISTS prompt_config  JSONB   NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prompt_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN lovoo_agents.prompt_config IS
  'Configuração estruturada do prompt. '
  'NULL = modo legacy (prompt editado como texto livre). '
  'Quando presente: { version: 1, mode: ''structured'', sections: {...} }. '
  'O campo prompt é sempre gerado pelo backend a partir deste config.';

COMMENT ON COLUMN lovoo_agents.prompt_version IS
  'Versão para optimistic locking. '
  'Incrementada em todo UPDATE (legacy e structured). '
  'Updates structured verificam AND prompt_version = N antes de persistir — '
  'retornam 409 se rowsAffected = 0.';
