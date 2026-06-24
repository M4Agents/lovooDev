-- =====================================================
-- MIGRATION: Tabelas user_funnel_settings + user_allowed_funnels
-- Data: 23/06/2026
--
-- Objetivo:
--   Criar a estrutura de dados para controle de acesso por funil por usuário.
--
-- Tabelas criadas:
--   1. user_funnel_settings: flag is_enabled + funil padrão por usuário
--   2. user_allowed_funnels: lista explícita de funis permitidos (junction table)
--
-- Decisões de modelagem:
--   - Junction table em vez de JSONB: melhor integridade referencial,
--     FK composta impossibilita inserir funil de empresa A na lista de empresa B,
--     e RLS mais granular.
--   - FK composta (funnel_id, company_id) → sales_funnels(id, company_id):
--     exige UNIQUE(id, company_id) em sales_funnels como pré-requisito.
--   - ON DELETE CASCADE em funnel_id: funil deletado remove automaticamente
--     as permissões associadas.
--   - ON DELETE SET NULL em default_funnel_id: funil padrão deletado apenas
--     anula o campo, sem remover o registro do usuário.
--
-- RLS:
--   SELECT: próprio usuário OU admin da empresa
--   INSERT/DELETE: apenas admin da empresa
--   UPDATE: USING + WITH CHECK — impede mudança de company_id/user_id
--     (WITH CHECK valida estado APÓS a atualização; USING valida ANTES)
--
-- Impacto:
--   ZERO impacto em comportamento existente — tabelas vazias.
--   Nenhum usuário terá is_enabled = true até configuração explícita.
--
-- Pré-requisito:
--   UNIQUE(id, company_id) em sales_funnels para FK composta.
--   Verificar se já existe antes de aplicar (ADD CONSTRAINT IF NOT EXISTS).
-- =====================================================

SET search_path = public;

-- ── Pré-requisito: UNIQUE(id, company_id) em sales_funnels ──────────────────
-- Necessário para que a FK composta em user_allowed_funnels seja possível.
-- IF NOT EXISTS garante idempotência caso a constraint já exista.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sales_funnels'::regclass
      AND conname   = 'sales_funnels_id_company_id_uniq'
  ) THEN
    ALTER TABLE sales_funnels
      ADD CONSTRAINT sales_funnels_id_company_id_uniq UNIQUE (id, company_id);
  END IF;
END;
$$;

-- ── Tabela: user_funnel_settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_funnel_settings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  is_enabled        BOOLEAN     NOT NULL DEFAULT false,
  -- Funil padrão para este usuário (anulado automaticamente se o funil for deletado)
  default_funnel_id UUID        REFERENCES sales_funnels(id)          ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ufs_user_company
  ON user_funnel_settings(user_id, company_id);

-- ── Tabela: user_allowed_funnels ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_allowed_funnels (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID        NOT NULL REFERENCES companies(id)    ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  funnel_id  UUID        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- FK simples para ON DELETE CASCADE quando o funil é deletado
  CONSTRAINT fk_uaf_funnel
    FOREIGN KEY (funnel_id)
    REFERENCES sales_funnels(id)
    ON DELETE CASCADE,

  -- FK composta: garante que funnel_id e company_id pertencem à mesma empresa.
  -- Impede inserir funnel_id = funil da empresa B na lista de empresa A.
  CONSTRAINT fk_uaf_funnel_company
    FOREIGN KEY (funnel_id, company_id)
    REFERENCES sales_funnels(id, company_id),

  UNIQUE(company_id, user_id, funnel_id)
);

CREATE INDEX IF NOT EXISTS idx_uaf_user_company
  ON user_allowed_funnels(user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_uaf_user_company_funnel
  ON user_allowed_funnels(user_id, company_id, funnel_id);

-- ── Trigger: updated_at automático ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at_user_funnel_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ufs_updated_at ON user_funnel_settings;
CREATE TRIGGER trg_ufs_updated_at
  BEFORE UPDATE ON user_funnel_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_user_funnel_settings();

-- ── RLS: user_funnel_settings ────────────────────────────────────────────────
ALTER TABLE user_funnel_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: próprio usuário OU admin da empresa
CREATE POLICY "ufs_select"
  ON user_funnel_settings FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR auth_user_is_company_admin(company_id)
  );

-- INSERT: apenas admin da empresa
CREATE POLICY "ufs_insert"
  ON user_funnel_settings FOR INSERT TO authenticated
  WITH CHECK (
    auth_user_is_company_admin(company_id)
  );

-- UPDATE: USING (antes) + WITH CHECK (depois) — previne mudança de company_id/user_id
-- Com WITH CHECK, mesmo que o chamador seja admin, não pode alterar para
-- outro company_id ou user_id, garantindo consistência dos dados.
CREATE POLICY "ufs_update"
  ON user_funnel_settings FOR UPDATE TO authenticated
  USING  (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- DELETE: apenas admin da empresa
CREATE POLICY "ufs_delete"
  ON user_funnel_settings FOR DELETE TO authenticated
  USING (auth_user_is_company_admin(company_id));

-- ── RLS: user_allowed_funnels ────────────────────────────────────────────────
ALTER TABLE user_allowed_funnels ENABLE ROW LEVEL SECURITY;

-- SELECT: próprio usuário OU admin da empresa
CREATE POLICY "uaf_select"
  ON user_allowed_funnels FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR auth_user_is_company_admin(company_id)
  );

-- INSERT: apenas admin da empresa
CREATE POLICY "uaf_insert"
  ON user_allowed_funnels FOR INSERT TO authenticated
  WITH CHECK (auth_user_is_company_admin(company_id));

-- UPDATE: USING + WITH CHECK — previne mudança de company_id/user_id
CREATE POLICY "uaf_update"
  ON user_allowed_funnels FOR UPDATE TO authenticated
  USING  (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- DELETE: apenas admin da empresa
CREATE POLICY "uaf_delete"
  ON user_allowed_funnels FOR DELETE TO authenticated
  USING (auth_user_is_company_admin(company_id));

COMMENT ON TABLE user_funnel_settings IS
  'Configuração de controle de funis por usuário. '
  'is_enabled = false (padrão): usuário vê todos os funis da empresa. '
  'is_enabled = true: comportamento determinado por user_allowed_funnels.';

COMMENT ON TABLE user_allowed_funnels IS
  'Lista de funis permitidos para usuários com is_enabled = true em user_funnel_settings. '
  'FK composta (funnel_id, company_id) garante integridade cross-company. '
  'Tabela vazia (com is_enabled = true) = usuário vê todos os funis.';
