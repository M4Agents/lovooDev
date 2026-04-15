-- MIGRATION: Criar tabela company_lead_config
-- Propósito: configuração por empresa do comportamento de leads duplicados e reentradas
-- Ativado por padrão (enabled=true) para todas as empresas — sistema em implantação

CREATE TABLE IF NOT EXISTS company_lead_config (
  company_id            UUID    PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  -- enabled: feature flag por empresa. false = handleLeadReentry é no-op para esta empresa
  duplicate_lead_config JSONB   NOT NULL DEFAULT '{
    "won": "NEW_OPPORTUNITY",
    "lost": "REOPEN",
    "open": "EVENT_ONLY"
  }',
  -- duplicate_lead_config.won:  EVENT_ONLY | NEW_OPPORTUNITY
  -- duplicate_lead_config.lost: REOPEN | NEW_OPPORTUNITY | EVENT_ONLY
  -- duplicate_lead_config.open: EVENT_ONLY | RESET_PIPELINE | NEW_OPPORTUNITY | IGNORE
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE company_lead_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_lead_config_select" ON company_lead_config
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

CREATE POLICY "company_lead_config_update" ON company_lead_config
  FOR UPDATE
  USING (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_company_lead_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_lead_config_updated_at
  BEFORE UPDATE ON company_lead_config
  FOR EACH ROW EXECUTE FUNCTION update_company_lead_config_updated_at();

-- Popular todas as empresas existentes com config padrão
-- ON CONFLICT DO NOTHING: seguro para re-executar
INSERT INTO company_lead_config (company_id)
SELECT id FROM companies
ON CONFLICT DO NOTHING;
