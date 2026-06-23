-- =====================================================
-- Migration: reforço de RLS em sale_types para campos
--            de sistema (segunda camada de defesa)
--
-- O trigger defensivo (trg_protect_system_sale_types)
-- já bloqueia estas operações. A RLS adiciona uma segunda
-- camada que atua ANTES do trigger, no nível de
-- autorização do PostgREST.
--
-- Funções SECURITY DEFINER (provision_system_sale_types,
-- set_system_sale_type_hidden) bypassam RLS por design.
-- =====================================================

-- ── INSERT ────────────────────────────────────────────
-- Regra atual: membro ativo admin/super_admin/system_admin
-- Adição: WITH CHECK proíbe is_system=true e system_key definida

DROP POLICY IF EXISTS sale_types_insert ON sale_types;

CREATE POLICY sale_types_insert ON sale_types
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    -- Apenas admins da empresa podem criar
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    -- Nunca permitir criação de tipo de sistema via PostgREST
    AND is_system  = false
    AND system_key IS NULL
    -- is_hidden sempre false em tipos customizados
    AND is_hidden  = false
  );

-- ── UPDATE ────────────────────────────────────────────
-- Regra atual: USING verifica admin, sem WITH CHECK
-- Adição:
--   USING: bloqueia tentativa de UPDATE em tipos de sistema
--   WITH CHECK: garante que o resultado ainda é tipo customizado
--               (impede "promoção" para sistema via patch)

DROP POLICY IF EXISTS sale_types_update ON sale_types;

CREATE POLICY sale_types_update ON sale_types
  FOR UPDATE
  TO PUBLIC
  USING (
    -- Apenas admins
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    -- Não permitir UPDATE direto em tipos de sistema.
    -- set_system_sale_type_hidden usa SECURITY DEFINER → bypassa RLS.
    AND is_system = false
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    -- Resultado da atualização não pode virar tipo de sistema
    AND is_system  = false
    -- system_key não pode ser definida no resultado
    AND system_key IS NULL
    -- is_hidden não pode ser alterado via DML direto em tipos customizados
    AND is_hidden  = false
  );

-- ── DELETE ────────────────────────────────────────────
-- Regra atual: USING verifica admin, sem restrição a is_system
-- Adição: bloqueia DELETE de tipos de sistema

DROP POLICY IF EXISTS sale_types_delete ON sale_types;

CREATE POLICY sale_types_delete ON sale_types
  FOR DELETE
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = sale_types.company_id
        AND cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role IN ('admin', 'super_admin', 'system_admin')
    )
    -- Nunca permitir exclusão de tipos de sistema via PostgREST
    AND is_system = false
  );

-- ── SELECT (não alterada) ─────────────────────────────
-- A policy sale_types_select existente já é adequada:
-- permite leitura a qualquer membro ativo da empresa.
-- Tipos de sistema ocultos são visíveis na listagem admin;
-- o filtro de visibilidade é aplicado no frontend/RPC.
