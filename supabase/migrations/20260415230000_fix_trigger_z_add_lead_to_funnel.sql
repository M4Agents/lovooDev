-- MIGRATION: Renomear trigger auto_add_lead_to_funnel → z_add_lead_to_funnel
-- e ajustar a função para não criar opportunity para leads duplicados.
--
-- POR QUE O PREFIXO 'z_'?
-- Triggers AFTER ROW na mesma tabela executam em ordem ALFABÉTICA do nome.
-- O trigger 'lead_duplicate_check' (prefixo 'l') executa UPDATE leads SET is_duplicate=true.
-- O trigger 'z_add_lead_to_funnel' (prefixo 'z') executa DEPOIS (z > l).
-- Dentro da mesma transação, SELECT enxerga o UPDATE anterior — sem race condition.
-- ATENÇÃO: Não renomear este trigger para algo com prefixo anterior a 'l'.
--
-- GARANTIA TÉCNICA (PostgreSQL):
-- - Triggers AFTER ROW são executados sequencialmente na mesma transação
-- - ANSI SQL garante: dentro de uma transação, um SELECT vê mudanças de UPDATEs anteriores
-- - Não há paralelismo entre triggers do mesmo evento

-- 1. Ajustar a função para verificar is_duplicate ANTES de criar opportunity
CREATE OR REPLACE FUNCTION add_lead_to_default_funnel()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_is_duplicate       BOOLEAN;
  v_funnel_id          UUID;
  v_stage_id           UUID;
  v_opportunity_id     UUID;
  v_existing_opp_id    UUID;
  v_existing_pos_id    UUID;
BEGIN
  -- VERIFICAÇÃO CRÍTICA: abortar se o lead for duplicata.
  -- lead_duplicate_check (trigger 'l') já executou UPDATE is_duplicate=true nesta transação.
  -- O SELECT abaixo enxerga esse UPDATE por estar na mesma transação.
  SELECT is_duplicate INTO v_is_duplicate FROM leads WHERE id = NEW.id;
  IF v_is_duplicate IS TRUE THEN
    -- Lead duplicado: não criar opportunity. handleLeadReentry (backend) cuida desta situação.
    RETURN NEW;
  END IF;

  -- Lead não duplicado: fluxo normal de criação de opportunity
  SELECT id INTO v_funnel_id
  FROM sales_funnels
  WHERE company_id = NEW.company_id
    AND is_default = true
    AND is_active = true
  LIMIT 1;

  IF v_funnel_id IS NOT NULL THEN
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id
    ORDER BY position ASC
    LIMIT 1;

    IF v_stage_id IS NOT NULL THEN
      SELECT id INTO v_existing_opp_id
      FROM opportunities
      WHERE lead_id = NEW.id
      LIMIT 1;

      IF v_existing_opp_id IS NULL THEN
        INSERT INTO opportunities (
          lead_id, company_id, title, status, source, created_at, updated_at
        ) VALUES (
          NEW.id, NEW.company_id, 'Nova Oportunidade', 'open',
          COALESCE(NEW.origin, 'manual'), NOW(), NOW()
        ) RETURNING id INTO v_opportunity_id;
      ELSE
        v_opportunity_id := v_existing_opp_id;
      END IF;

      SELECT id INTO v_existing_pos_id
      FROM opportunity_funnel_positions
      WHERE lead_id = NEW.id AND funnel_id = v_funnel_id
      LIMIT 1;

      IF v_existing_pos_id IS NULL AND v_opportunity_id IS NOT NULL THEN
        INSERT INTO opportunity_funnel_positions (
          lead_id, opportunity_id, funnel_id, stage_id,
          position_in_stage, entered_stage_at, updated_at
        ) VALUES (
          NEW.id, v_opportunity_id, v_funnel_id, v_stage_id, 0, NOW(), NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Criar novo trigger com prefixo 'z_' (executa DEPOIS de 'l' = lead_duplicate_check)
CREATE TRIGGER z_add_lead_to_funnel
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION add_lead_to_default_funnel();

-- 3. Dropar o trigger antigo APÓS criar o novo (sem janela de gap)
DROP TRIGGER IF EXISTS auto_add_lead_to_funnel ON leads;
