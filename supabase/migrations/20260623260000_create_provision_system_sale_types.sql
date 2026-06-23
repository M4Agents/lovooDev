-- =====================================================
-- Migration: provision_system_sale_types
--
-- Cria função idempotente que provê os 10 tipos de venda
-- padrão do sistema para uma empresa.
-- Disparada automaticamente ao criar nova empresa.
-- =====================================================

-- =====================================================
-- FUNÇÃO: provision_system_sale_types(p_company_id UUID)
-- =====================================================
CREATE OR REPLACE FUNCTION provision_system_sale_types(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sinaliza ao trigger defensivo que esta é uma inserção autorizada pelo sistema.
  -- set_config com is_local=TRUE garante escopo da transação corrente.
  PERFORM set_config('app.system_provision', 'true', TRUE);

  INSERT INTO sale_types (
    company_id,
    name,
    description,
    is_active,
    is_system,
    system_key,
    is_hidden,
    sort_order
  )
  VALUES
    (p_company_id, 'Cross-sell',             NULL, true, true, 'cross_sell',          false,  10),
    (p_company_id, 'Decisão imediata',        NULL, true, true, 'decisao_imediata',    false,  20),
    (p_company_id, 'Follow-up',              NULL, true, true, 'follow_up',           false,  30),
    (p_company_id, 'Indicação',              NULL, true, true, 'indicacao',           false,  40),
    (p_company_id, 'Novo Cliente',           NULL, true, true, 'novo_cliente',        false,  50),
    (p_company_id, 'Parceiro',               NULL, true, true, 'parceiro',            false,  60),
    (p_company_id, 'Reativação',             NULL, true, true, 'reativacao',          false,  70),
    (p_company_id, 'Renovação',              NULL, true, true, 'renovacao',           false,  80),
    (p_company_id, 'Resgate de Lead Parado', NULL, true, true, 'resgate_lead_parado', false,  90),
    (p_company_id, 'Upsell',                 NULL, true, true, 'upsell',              false, 100)
  ON CONFLICT (company_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;

  -- Limpa o flag de sessão após o INSERT
  PERFORM set_config('app.system_provision', 'false', TRUE);
END;
$$;

COMMENT ON FUNCTION provision_system_sale_types(UUID) IS
  'Provisiona os 10 tipos de venda padrão do sistema para a empresa informada. '
  'Idempotente: usa ON CONFLICT DO NOTHING. '
  'Deve ser a única origem de registros com is_system=true.';

-- Revogar de PUBLIC para evitar chamada não autorizada
REVOKE ALL ON FUNCTION provision_system_sale_types(UUID) FROM PUBLIC;

-- =====================================================
-- TRIGGER: dispara provision_system_sale_types em INSERT
-- =====================================================
CREATE OR REPLACE FUNCTION trg_provision_system_sale_types_on_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM provision_system_sale_types(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_provision_sale_types
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION trg_provision_system_sale_types_on_company();

COMMENT ON TRIGGER trg_companies_provision_sale_types ON companies IS
  'Ao criar uma nova empresa, provisiona automaticamente os tipos de venda de sistema.';
