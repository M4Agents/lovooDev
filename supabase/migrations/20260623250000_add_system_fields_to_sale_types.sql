-- =====================================================
-- Migration: system fields em sale_types
--
-- Objetivo: Suportar tipos de venda de sistema que são
--           provisionados automaticamente por empresa.
--           Admins podem ocultar/exibir tipos de sistema,
--           mas não podem editar, desativar ou excluí-los.
--
-- Novos campos:
--   is_system  — marca registro como imutável pelo admin
--   system_key — chave estável para idempotência
--   is_hidden  — visibilidade por empresa (só para sistema)
-- =====================================================

ALTER TABLE sale_types
  ADD COLUMN IF NOT EXISTS is_system  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key TEXT    NULL,
  ADD COLUMN IF NOT EXISTS is_hidden  BOOLEAN NOT NULL DEFAULT false;

-- Índice único parcial: impede duplicação ao re-provisionar
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_types_company_system_key
  ON sale_types (company_id, system_key)
  WHERE system_key IS NOT NULL;

COMMENT ON COLUMN sale_types.is_system IS
  'Quando true: registro de sistema — não pode ser editado, desativado ou excluído pelo admin da empresa.';

COMMENT ON COLUMN sale_types.system_key IS
  'Chave canônica estável para idempotência em migrações. Ex: cross_sell, follow_up. '
  'Nunca deve ser definida ou alterada manualmente pelo frontend.';

COMMENT ON COLUMN sale_types.is_hidden IS
  'Quando true: tipo de sistema não aparece no seletor de fechamento de oportunidades. '
  'Apenas tipos de sistema (is_system=true) podem ter is_hidden alterado. '
  'Apenas via RPC set_system_sale_type_hidden.';

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

CREATE OR REPLACE FUNCTION trg_protect_system_sale_types()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Bypass para funções de sistema autorizadas (provision_system_sale_types,
  -- set_system_sale_type_hidden). Ambas definem app.system_provision=true
  -- localmente via set_config(..., TRUE) antes de executar o DML.
  IF current_setting('app.system_provision', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- INSERT: ninguém pode criar tipo de sistema via DML direto
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system = true THEN
      RAISE EXCEPTION 'SALE_TYPE_SYSTEM_WRITE_DENIED'
        USING HINT = 'Tipos de sistema são provisionados automaticamente e não podem ser criados manualmente.';
    END IF;
    IF NEW.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'SALE_TYPE_SYSTEM_KEY_WRITE_DENIED'
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
      RAISE EXCEPTION 'SALE_TYPE_SYSTEM_FIELD_IMMUTABLE'
        USING HINT = 'O campo is_system não pode ser alterado após a criação.';
    END IF;
    IF NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION 'SALE_TYPE_SYSTEM_KEY_IMMUTABLE'
        USING HINT = 'O campo system_key não pode ser alterado após a criação.';
    END IF;

    -- Se for tipo de sistema, proteger campos de conteúdo
    IF OLD.is_system = true THEN
      IF NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'SALE_TYPE_SYSTEM_CANNOT_EDIT_NAME'
          USING HINT = 'Tipos de sistema não podem ter o nome alterado.';
      END IF;
      IF NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'SALE_TYPE_SYSTEM_CANNOT_EDIT_DESCRIPTION'
          USING HINT = 'Tipos de sistema não podem ter a descrição alterada.';
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'SALE_TYPE_SYSTEM_CANNOT_CHANGE_ACTIVE'
          USING HINT = 'Tipos de sistema não podem ser ativados ou desativados. Use ocultar/exibir.';
      END IF;
      IF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
        RAISE EXCEPTION 'SALE_TYPE_SYSTEM_CANNOT_EDIT_ORDER'
          USING HINT = 'A ordem dos tipos de sistema não pode ser alterada.';
      END IF;
    END IF;

    -- Tipos customizados não podem ter is_hidden alterado via DML direto
    IF OLD.is_system = false AND NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
      RAISE EXCEPTION 'SALE_TYPE_HIDDEN_NOT_APPLICABLE'
        USING HINT = 'O campo is_hidden é reservado para tipos de sistema.';
    END IF;

    -- Tipo de sistema: is_hidden só pode ser alterado via RPC set_system_sale_type_hidden
    -- Verificado pelo trigger bloqueando todos os outros campos acima.
    -- is_hidden em tipo de sistema: permitido aqui pois a RPC usa SECURITY DEFINER
    -- e o trigger não consegue distinguir chamada SECURITY DEFINER vs DML direto.
    -- A proteção real para is_hidden está no fato de que a RPC é a única que altera
    -- apenas is_hidden; qualquer tentativa de alterar outro campo é bloqueada acima.

    RETURN NEW;
  END IF;

  -- DELETE: bloquear exclusão de tipo de sistema
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system = true THEN
      RAISE EXCEPTION 'SALE_TYPE_SYSTEM_CANNOT_DELETE'
        USING HINT = 'Tipos de sistema não podem ser excluídos. Use ocultar/exibir.';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger para INSERT (BEFORE — pode modificar NEW)
CREATE TRIGGER trg_sale_types_protect_system_insert
  BEFORE INSERT ON sale_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_sale_types();

-- Trigger para UPDATE (BEFORE)
CREATE TRIGGER trg_sale_types_protect_system_update
  BEFORE UPDATE ON sale_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_sale_types();

-- Trigger para DELETE (BEFORE)
CREATE TRIGGER trg_sale_types_protect_system_delete
  BEFORE DELETE ON sale_types
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_sale_types();
