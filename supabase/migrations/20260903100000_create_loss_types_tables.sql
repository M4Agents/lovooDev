-- =====================================================
-- Migration: loss_types + opportunity_loss_types
-- Objetivo: Gerenciar tipos de perda por empresa e
--           vinculá-los a oportunidades fechadas como lost.
-- Multi-tenant: isolamento por company_id em todas as tabelas.
-- Padrão: espelho de sale_types + opportunity_sale_types.
-- =====================================================

-- ─── Tabela loss_types ───────────────────────────────
CREATE TABLE IF NOT EXISTS loss_types (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT        NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Campos de sistema (adicionados já nesta migration — sem ALTER posterior)
  is_system   BOOLEAN     NOT NULL DEFAULT false,
  system_key  TEXT        NULL,
  is_hidden   BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_loss_types_company_active
  ON loss_types (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_loss_types_company_sort
  ON loss_types (company_id, sort_order);

-- Índice único parcial: impede duplicação ao re-provisionar
CREATE UNIQUE INDEX IF NOT EXISTS idx_loss_types_company_system_key
  ON loss_types (company_id, system_key)
  WHERE system_key IS NOT NULL;

COMMENT ON TABLE loss_types IS
  'Tipos de perda configurados por empresa. Vinculáveis a oportunidades no fechamento como lost.';

COMMENT ON COLUMN loss_types.is_system IS
  'Quando true: registro de sistema — não pode ser editado, desativado ou excluído pelo admin da empresa.';

COMMENT ON COLUMN loss_types.system_key IS
  'Chave canônica estável para idempotência em migrações. Ex: preco, timing. '
  'Nunca deve ser definida ou alterada manualmente pelo frontend.';

COMMENT ON COLUMN loss_types.is_hidden IS
  'Quando true: tipo de sistema não aparece no seletor de fechamento de oportunidades. '
  'Apenas tipos de sistema (is_system=true) podem ter is_hidden alterado. '
  'Apenas via RPC set_system_loss_type_hidden.';

-- Trigger updated_at
CREATE TRIGGER trg_loss_types_updated_at
  BEFORE UPDATE ON loss_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE loss_types ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa
CREATE POLICY loss_types_select ON loss_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
  );

-- INSERT: admin, super_admin, system_admin
--   + proíbe criação de tipos de sistema e system_key via PostgREST
CREATE POLICY loss_types_insert ON loss_types
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    AND is_system  = false
    AND system_key IS NULL
    AND is_hidden  = false
  );

-- UPDATE: admin, super_admin, system_admin
--   USING: bloqueia UPDATE em tipos de sistema via PostgREST
--   WITH CHECK: garante que o resultado ainda é tipo customizado
CREATE POLICY loss_types_update ON loss_types
  FOR UPDATE
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    AND is_system = false
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    AND is_system  = false
    AND system_key IS NULL
    AND is_hidden  = false
  );

-- DELETE: admin, super_admin, system_admin
--   + proíbe exclusão de tipos de sistema
CREATE POLICY loss_types_delete ON loss_types
  FOR DELETE
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    AND is_system = false
  );

-- =====================================================
-- TRIGGER DEFENSIVO: protege campos de sistema via DML
--
-- Bloqueia via PostgREST (não SECURITY DEFINER):
--   INSERT com is_system=true
--   INSERT com system_key definida
--   UPDATE de is_system, system_key em qualquer registro
--   UPDATE de name/description/is_active em registro de sistema
--   UPDATE de is_hidden fora da RPC própria
-- =====================================================
CREATE OR REPLACE FUNCTION trg_protect_system_loss_types()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Bypass para funções de sistema autorizadas (provision_system_loss_types,
  -- set_system_loss_type_hidden). Ambas definem app.system_provision=true
  -- localmente via set_config(..., TRUE) antes de executar o DML.
  IF current_setting('app.system_provision', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- INSERT: ninguém pode criar tipo de sistema via DML direto
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system = true THEN
      RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_WRITE_DENIED'
        USING HINT = 'Tipos de sistema são provisionados automaticamente e não podem ser criados manualmente.';
    END IF;
    IF NEW.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_KEY_WRITE_DENIED'
        USING HINT = 'O campo system_key é reservado ao sistema e não pode ser definido manualmente.';
    END IF;
    -- Forçar is_hidden=false para novos registros customizados (defensivo)
    NEW.is_hidden := false;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- is_system e system_key são imutáveis após criação
    IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
      RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_FIELD_IMMUTABLE'
        USING HINT = 'O campo is_system não pode ser alterado após a criação.';
    END IF;
    IF NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_KEY_IMMUTABLE'
        USING HINT = 'O campo system_key não pode ser alterado após a criação.';
    END IF;

    -- Se for tipo de sistema, proteger campos de conteúdo
    IF OLD.is_system = true THEN
      IF NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_CANNOT_EDIT_NAME'
          USING HINT = 'Tipos de sistema não podem ter o nome alterado.';
      END IF;
      IF NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_CANNOT_EDIT_DESCRIPTION'
          USING HINT = 'Tipos de sistema não podem ter a descrição alterada.';
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_CANNOT_CHANGE_ACTIVE'
          USING HINT = 'Tipos de sistema não podem ser ativados ou desativados. Use ocultar/exibir.';
      END IF;
      IF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
        RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_CANNOT_EDIT_ORDER'
          USING HINT = 'A ordem dos tipos de sistema não pode ser alterada.';
      END IF;
    END IF;

    -- Tipos customizados não podem ter is_hidden alterado via DML direto
    IF OLD.is_system = false AND NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
      RAISE EXCEPTION 'LOSS_TYPE_HIDDEN_NOT_APPLICABLE'
        USING HINT = 'O campo is_hidden é reservado para tipos de sistema.';
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE: bloquear exclusão de tipo de sistema
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'LOSS_TYPE_SYSTEM_CANNOT_DELETE'
        USING HINT = 'Tipos de sistema não podem ser excluídos. Use ocultar/exibir.';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger para INSERT (BEFORE — pode modificar NEW)
CREATE TRIGGER trg_loss_types_protect_system_insert
  BEFORE INSERT ON loss_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_loss_types();

-- Trigger para UPDATE (BEFORE)
CREATE TRIGGER trg_loss_types_protect_system_update
  BEFORE UPDATE ON loss_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_loss_types();

-- Trigger para DELETE (BEFORE)
CREATE TRIGGER trg_loss_types_protect_system_delete
  BEFORE DELETE ON loss_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_loss_types();


-- ─── Tabela opportunity_loss_types ───────────────────
CREATE TABLE IF NOT EXISTS opportunity_loss_types (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id  UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  loss_type_id    UUID        NOT NULL REFERENCES loss_types(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT opportunity_loss_types_unique UNIQUE (opportunity_id, loss_type_id)
);

CREATE INDEX IF NOT EXISTS idx_opp_loss_types_company_opp
  ON opportunity_loss_types (company_id, opportunity_id);

CREATE INDEX IF NOT EXISTS idx_opp_loss_types_company_type
  ON opportunity_loss_types (company_id, loss_type_id);

COMMENT ON TABLE opportunity_loss_types IS
  'Vínculo N:N entre oportunidades e tipos de perda. Criado via RPC opportunity_add_loss_type.';

COMMENT ON COLUMN opportunity_loss_types.loss_type_id IS
  'ON DELETE RESTRICT: tipos usados historicamente não podem ser excluídos — apenas desativados.';

-- Trigger de validação de company_id (consistência multi-tenant)
CREATE OR REPLACE FUNCTION trg_validate_opp_loss_types_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_opp_company  UUID;
  v_type_company UUID;
BEGIN
  SELECT company_id INTO v_opp_company
    FROM opportunities WHERE id = NEW.opportunity_id;

  SELECT company_id INTO v_type_company
    FROM loss_types WHERE id = NEW.loss_type_id;

  IF v_opp_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'company_id inconsistente: oportunidade pertence a empresa diferente';
  END IF;

  IF v_type_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'company_id inconsistente: tipo de perda pertence a empresa diferente';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opp_loss_types_company_check
  BEFORE INSERT ON opportunity_loss_types
  FOR EACH ROW EXECUTE FUNCTION trg_validate_opp_loss_types_company();

-- RLS
ALTER TABLE opportunity_loss_types ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa
CREATE POLICY opp_loss_types_select ON opportunity_loss_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = opportunity_loss_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
    )
  );

-- INSERT/DELETE somente via RPC SECURITY DEFINER (service_role não é necessário)
-- Políticas restritivas impedem escrita direta pelo frontend
CREATE POLICY opp_loss_types_insert ON opportunity_loss_types
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY opp_loss_types_delete ON opportunity_loss_types
  FOR DELETE
  USING (false);
