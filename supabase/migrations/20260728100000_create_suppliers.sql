-- =====================================================
-- SUPPLIERS (FORNECEDORES)
-- Cadastro de fornecedores por empresa (multi-tenant).
-- RLS por company_id — Trilha 1 (membership direto).
-- =====================================================

-- -----------------------------------------------------------------
-- 1) Tabela suppliers
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Identificação
  name             VARCHAR(255)  NOT NULL,
  trade_name       VARCHAR(255)  NULL,
  document         VARCHAR(30)   NULL,
  document_type    VARCHAR(10)   NULL,

  -- Contato comercial
  email            VARCHAR(255)  NULL,
  phone            VARCHAR(30)   NULL,
  website          VARCHAR(500)  NULL,

  -- Responsável de contato
  contact_name     VARCHAR(255)  NULL,
  contact_phone    VARCHAR(30)   NULL,

  -- Endereço
  address_street   VARCHAR(300)  NULL,
  address_city     VARCHAR(150)  NULL,
  address_state    VARCHAR(50)   NULL,
  address_zip      VARCHAR(20)   NULL,
  address_country  VARCHAR(100)  NULL DEFAULT 'Brasil',

  -- Observações
  notes            TEXT          NULL,

  -- Controle
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT suppliers_document_type_check CHECK (
    document_type IS NULL OR document_type IN ('cnpj', 'cpf', 'other')
  )
);

CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE suppliers IS 'Cadastro de fornecedores por empresa. Isolamento por company_id + RLS.';
COMMENT ON COLUMN suppliers.document IS 'CNPJ ou CPF do fornecedor.';
COMMENT ON COLUMN suppliers.document_type IS 'Tipo do documento: cnpj | cpf | other.';
COMMENT ON COLUMN suppliers.trade_name IS 'Nome fantasia, quando diferente da razão social.';
COMMENT ON COLUMN suppliers.contact_name IS 'Nome do responsável de contato no fornecedor.';

-- -----------------------------------------------------------------
-- 2) Índices
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suppliers_company
  ON suppliers (company_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_company_active
  ON suppliers (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_suppliers_company_name
  ON suppliers (company_id, name);

-- -----------------------------------------------------------------
-- 3) RLS — Trilha 1: membership direto via company_users
-- -----------------------------------------------------------------
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_select ON suppliers FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY suppliers_insert ON suppliers FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY suppliers_update ON suppliers FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY suppliers_delete ON suppliers FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid() AND is_active = true)
);
