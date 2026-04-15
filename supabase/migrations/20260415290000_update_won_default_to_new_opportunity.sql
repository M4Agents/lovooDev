-- MIGRATION: Atualiza default de 'won' para NEW_OPPORTUNITY em company_lead_config
-- Impacto: todas as empresas existentes com valor padrão EVENT_ONLY serão atualizadas.
-- Empresas que já personalizaram manualmente NÃO são afetadas (jsonb won != 'EVENT_ONLY' é preservado).

-- 1. Atualizar default da coluna para novas empresas
ALTER TABLE company_lead_config
  ALTER COLUMN duplicate_lead_config
  SET DEFAULT '{"won": "NEW_OPPORTUNITY", "lost": "REOPEN", "open": "EVENT_ONLY"}';

-- 2. Atualizar empresas existentes que ainda têm o valor padrão antigo (EVENT_ONLY)
UPDATE company_lead_config
SET
  duplicate_lead_config = jsonb_set(duplicate_lead_config, '{won}', '"NEW_OPPORTUNITY"'),
  updated_at = NOW()
WHERE duplicate_lead_config->>'won' = 'EVENT_ONLY';
