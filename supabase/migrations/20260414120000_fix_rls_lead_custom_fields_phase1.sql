-- ============================================================
-- FASE 1: Correção de RLS multi-tenant
-- Tabelas: lead_custom_fields, lead_custom_values
-- Modelo: Trilha 1 (membership direto) + Trilha 2 (parent escalada)
-- Decisão: DELETE em lead_custom_values restrito a admin/super_admin/system_admin
-- ============================================================

-- ============================================================
-- SEÇÃO 1: lead_custom_fields
-- company_id disponível diretamente na tabela
-- ============================================================

DROP POLICY IF EXISTS "lead_custom_fields_company_access" ON lead_custom_fields;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcf_select_member_or_parent_admin"
ON lead_custom_fields
FOR SELECT
TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_custom_fields.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- INSERT: admin-level da empresa (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcf_insert_admin_or_parent_admin"
ON lead_custom_fields
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = lead_custom_fields.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_custom_fields.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- UPDATE: mesmo critério do INSERT — USING filtra linha existente, WITH CHECK valida nova
CREATE POLICY "lcf_update_admin_or_parent_admin"
ON lead_custom_fields
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = lead_custom_fields.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_custom_fields.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = lead_custom_fields.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_custom_fields.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- DELETE: mesmo critério do UPDATE
CREATE POLICY "lcf_delete_admin_or_parent_admin"
ON lead_custom_fields
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = lead_custom_fields.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM company_users cu
    JOIN companies child ON child.id = lead_custom_fields.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- ============================================================
-- SEÇÃO 2: lead_custom_values
-- SEM company_id direto — caminho oficial: lead_id → leads.company_id
-- ============================================================

DROP POLICY IF EXISTS "lead_custom_values_access" ON lead_custom_values;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcv_select_member_or_parent_admin"
ON lead_custom_values
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_custom_values.lead_id
      AND auth_user_is_company_member(l.company_id)
  )
  OR EXISTS (
    SELECT 1
    FROM leads l
    JOIN companies child   ON child.id = l.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- INSERT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcv_insert_member_or_parent_admin"
ON lead_custom_values
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_custom_values.lead_id
      AND auth_user_is_company_member(l.company_id)
  )
  OR EXISTS (
    SELECT 1
    FROM leads l
    JOIN companies child   ON child.id = l.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- UPDATE: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lcv_update_member_or_parent_admin"
ON lead_custom_values
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_custom_values.lead_id
      AND auth_user_is_company_member(l.company_id)
  )
  OR EXISTS (
    SELECT 1
    FROM leads l
    JOIN companies child   ON child.id = l.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_custom_values.lead_id
      AND auth_user_is_company_member(l.company_id)
  )
  OR EXISTS (
    SELECT 1
    FROM leads l
    JOIN companies child   ON child.id = l.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- DELETE: restrito a admin/super_admin/system_admin (decisão aprovada)
-- seller e manager NÃO podem deletar valores de campos customizados
CREATE POLICY "lcv_delete_admin_or_parent_admin"
ON lead_custom_values
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM leads l
    JOIN company_users cu ON cu.company_id = l.company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM leads l
    JOIN companies child   ON child.id = l.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE l.id         = lead_custom_values.lead_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);
