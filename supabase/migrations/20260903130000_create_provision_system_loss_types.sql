-- =====================================================
-- Migration: provision_system_loss_types
--
-- Cria função idempotente que provê os 8 tipos de perda
-- padrão do sistema para a empresa informada.
-- Disparada automaticamente ao criar nova empresa.
-- Espelho de provision_system_sale_types.
-- =====================================================

-- =====================================================
-- FUNÇÃO: provision_system_loss_types(p_company_id UUID)
-- =====================================================
CREATE OR REPLACE FUNCTION provision_system_loss_types(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sinaliza ao trigger defensivo que esta é uma inserção autorizada pelo sistema.
  -- set_config com is_local=TRUE garante escopo da transação corrente.
  PERFORM set_config('app.system_provision', 'true', TRUE);

  INSERT INTO loss_types (
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
    (p_company_id, 'Preço',              NULL, true, true, 'preco',              false, 10),
    (p_company_id, 'Concorrência',       NULL, true, true, 'concorrencia',       false, 20),
    (p_company_id, 'Timing',             NULL, true, true, 'timing',             false, 30),
    (p_company_id, 'Sem interesse',      NULL, true, true, 'sem_interesse',      false, 40),
    (p_company_id, 'Sem budget',         NULL, true, true, 'sem_budget',         false, 50),
    (p_company_id, 'Produto não atende', NULL, true, true, 'produto_nao_atende', false, 60),
    (p_company_id, 'Perdeu contato',     NULL, true, true, 'perdeu_contato',     false, 70),
    (p_company_id, 'Outro',              NULL, true, true, 'outro',              false, 80)
  ON CONFLICT (company_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;

  -- Limpa o flag de sessão após o INSERT
  PERFORM set_config('app.system_provision', 'false', TRUE);
END;
$$;

COMMENT ON FUNCTION provision_system_loss_types(UUID) IS
  'Provisiona os 8 tipos de perda padrão do sistema para a empresa informada. '
  'Idempotente: usa ON CONFLICT DO NOTHING. '
  'Deve ser a única origem de registros com is_system=true em loss_types.';

-- Revogar de PUBLIC para evitar chamada não autorizada
-- (sem GRANT authenticated — só owner/superuser/trigger/seed)
REVOKE ALL ON FUNCTION provision_system_loss_types(UUID) FROM PUBLIC;

-- =====================================================
-- TRIGGER: dispara provision_system_loss_types em INSERT
-- em companies — novas empresas recebem tipos automaticamente
-- =====================================================
CREATE OR REPLACE FUNCTION trg_provision_system_loss_types_on_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM provision_system_loss_types(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_provision_loss_types
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION trg_provision_system_loss_types_on_company();

COMMENT ON TRIGGER trg_companies_provision_loss_types ON companies IS
  'Ao criar uma nova empresa, provisiona automaticamente os tipos de perda de sistema.';
