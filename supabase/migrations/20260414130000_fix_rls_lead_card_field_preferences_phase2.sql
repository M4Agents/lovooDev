-- ============================================================
-- FASE 2: Correção de RLS — lead_card_field_preferences
-- Modelo: Trilha 1 (membership direto) + Trilha 2 (parent escalada)
-- Semântica:
--   preferência global: user_id IS NULL (somente admin cria/edita/deleta)
--   preferência pessoal: user_id = auth.uid() (o próprio usuário gerencia)
--   admin pode editar preferência pessoal de qualquer usuário da empresa
-- ============================================================

DROP POLICY IF EXISTS "lead_card_prefs_select" ON lead_card_field_preferences;
DROP POLICY IF EXISTS "lead_card_prefs_insert" ON lead_card_field_preferences;
DROP POLICY IF EXISTS "lead_card_prefs_update" ON lead_card_field_preferences;
DROP POLICY IF EXISTS "lead_card_prefs_delete" ON lead_card_field_preferences;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcfp_select_member_or_parent_admin"
ON lead_card_field_preferences
FOR SELECT
TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_card_field_preferences.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- INSERT: distingue preferência pessoal vs. global
--   pessoal (user_id = auth.uid()): qualquer membro ativo
--   global (user_id IS NULL): somente admin-level
--   Trilha 2: super_admin/system_admin da parent acessa filha
CREATE POLICY "lcfp_insert_member_or_admin"
ON lead_card_field_preferences
FOR INSERT
TO authenticated
WITH CHECK (
  (
    -- Preferência pessoal: o próprio usuário cria a sua
    lead_card_field_preferences.user_id = auth.uid()
    AND auth_user_is_company_member(company_id)
  )
  OR (
    -- Preferência global: somente admin-level da empresa
    lead_card_field_preferences.user_id IS NULL
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE user_id    = auth.uid()
        AND company_id = lead_card_field_preferences.company_id
        AND is_active  = true
        AND role       IN ('admin', 'super_admin', 'system_admin')
    )
  )
  OR (
    -- Trilha 2: super_admin/system_admin da parent — acesso total à filha
    EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN companies child ON child.id = lead_card_field_preferences.company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role       IN ('super_admin', 'system_admin')
        AND cu.company_id = child.parent_company_id
    )
  )
);

-- UPDATE: USING filtra a linha existente, WITH CHECK valida a linha escrita
--   pessoal própria: o usuário edita a sua
--   admin-level: edita qualquer linha da empresa (global ou pessoal de outros)
--   Trilha 2: super_admin/system_admin da parent
CREATE POLICY "lcfp_update_owner_or_admin"
ON lead_card_field_preferences
FOR UPDATE
TO authenticated
USING (
  (
    -- O próprio usuário pode editar sua preferência pessoal
    lead_card_field_preferences.user_id = auth.uid()
    AND auth_user_is_company_member(company_id)
  )
  OR (
    -- Admin-level pode editar qualquer linha (global e pessoal de outros)
    EXISTS (
      SELECT 1 FROM company_users
      WHERE user_id    = auth.uid()
        AND company_id = lead_card_field_preferences.company_id
        AND is_active  = true
        AND role       IN ('admin', 'super_admin', 'system_admin')
    )
  )
  OR (
    -- Trilha 2
    EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN companies child ON child.id = lead_card_field_preferences.company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role       IN ('super_admin', 'system_admin')
        AND cu.company_id = child.parent_company_id
    )
  )
)
WITH CHECK (
  (
    lead_card_field_preferences.user_id = auth.uid()
    AND auth_user_is_company_member(company_id)
  )
  OR (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE user_id    = auth.uid()
        AND company_id = lead_card_field_preferences.company_id
        AND is_active  = true
        AND role       IN ('admin', 'super_admin', 'system_admin')
    )
  )
  OR (
    EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN companies child ON child.id = lead_card_field_preferences.company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role       IN ('super_admin', 'system_admin')
        AND cu.company_id = child.parent_company_id
    )
  )
);

-- DELETE: mesma lógica do UPDATE (sem WITH CHECK — correto para DELETE)
--   pessoal própria: o usuário deleta a sua
--   admin-level: deleta qualquer linha da empresa
--   Trilha 2: super_admin/system_admin da parent
CREATE POLICY "lcfp_delete_owner_or_admin"
ON lead_card_field_preferences
FOR DELETE
TO authenticated
USING (
  (
    -- O próprio usuário pode deletar sua preferência pessoal
    lead_card_field_preferences.user_id = auth.uid()
    AND auth_user_is_company_member(company_id)
  )
  OR (
    -- Admin-level pode deletar qualquer linha
    EXISTS (
      SELECT 1 FROM company_users
      WHERE user_id    = auth.uid()
        AND company_id = lead_card_field_preferences.company_id
        AND is_active  = true
        AND role       IN ('admin', 'super_admin', 'system_admin')
    )
  )
  OR (
    -- Trilha 2
    EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN companies child ON child.id = lead_card_field_preferences.company_id
      WHERE cu.user_id    = auth.uid()
        AND cu.is_active  = true
        AND cu.role       IN ('super_admin', 'system_admin')
        AND cu.company_id = child.parent_company_id
    )
  )
);
