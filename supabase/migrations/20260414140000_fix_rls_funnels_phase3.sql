-- ============================================================
-- FASE 3: Correção de RLS multi-tenant — Funnels
-- Tabelas: sales_funnels, funnel_stages, lead_stage_history,
--          opportunity_funnel_positions
-- Modelo: Trilha 1 (membership direto) + Trilha 2 (parent escalada)
-- Regras especiais:
--   - seller/manager podem mover cards (opportunity_funnel_positions DML)
--   - seller/manager NÃO criam/editam/deletam funnels ou stages
--   - lead_stage_history é imutável (sem UPDATE/DELETE por design)
--   - funnel_stages com is_system_stage = true não podem ser deletados
-- ============================================================

-- ============================================================
-- SEÇÃO A: sales_funnels (company_id direto)
-- ============================================================

DROP POLICY IF EXISTS "sales_funnels_select"        ON sales_funnels;
DROP POLICY IF EXISTS "sales_funnels_member_select"  ON sales_funnels;
DROP POLICY IF EXISTS "sales_funnels_insert"         ON sales_funnels;
DROP POLICY IF EXISTS "sales_funnels_update"         ON sales_funnels;
DROP POLICY IF EXISTS "sales_funnels_delete"         ON sales_funnels;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "sf_select_member_or_parent_admin"
ON sales_funnels FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- INSERT: admin-level (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "sf_insert_admin_or_parent_admin"
ON sales_funnels FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = sales_funnels.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- UPDATE: USING + WITH CHECK (impede mudança de company_id para empresa não autorizada)
CREATE POLICY "sf_update_admin_or_parent_admin"
ON sales_funnels FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = sales_funnels.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
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
      AND company_id = sales_funnels.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- DELETE
CREATE POLICY "sf_delete_admin_or_parent_admin"
ON sales_funnels FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id    = auth.uid()
      AND company_id = sales_funnels.company_id
      AND is_active  = true
      AND role       IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);

-- ============================================================
-- SEÇÃO B1: funnel_stages (funnel_id → sales_funnels.company_id)
-- ============================================================

DROP POLICY IF EXISTS "funnel_stages_select"        ON funnel_stages;
DROP POLICY IF EXISTS "funnel_stages_member_select"  ON funnel_stages;
DROP POLICY IF EXISTS "funnel_stages_insert"         ON funnel_stages;
DROP POLICY IF EXISTS "funnel_stages_update"         ON funnel_stages;
DROP POLICY IF EXISTS "funnel_stages_delete"         ON funnel_stages;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "fs_select_member_or_parent_admin"
ON funnel_stages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = funnel_stages.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- INSERT: admin-level (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "fs_insert_admin_or_parent_admin"
ON funnel_stages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN company_users cu ON cu.company_id = sf.company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- UPDATE: USING + WITH CHECK
CREATE POLICY "fs_update_admin_or_parent_admin"
ON funnel_stages FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN company_users cu ON cu.company_id = sf.company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN company_users cu ON cu.company_id = sf.company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('admin', 'super_admin', 'system_admin')
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = funnel_stages.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- DELETE: preserva guard is_system_stage = false (etapas de sistema não podem ser deletadas)
CREATE POLICY "fs_delete_admin_or_parent_admin"
ON funnel_stages FOR DELETE TO authenticated
USING (
  funnel_stages.is_system_stage = false
  AND (
    EXISTS (
      SELECT 1 FROM sales_funnels sf
      JOIN company_users cu ON cu.company_id = sf.company_id
      WHERE sf.id        = funnel_stages.funnel_id
        AND cu.user_id   = auth.uid()
        AND cu.is_active = true
        AND cu.role      IN ('admin', 'super_admin', 'system_admin')
    )
    OR EXISTS (
      SELECT 1 FROM sales_funnels sf
      JOIN companies child   ON child.id = sf.company_id
      JOIN company_users cu  ON cu.company_id = child.parent_company_id
      WHERE sf.id        = funnel_stages.funnel_id
        AND cu.user_id   = auth.uid()
        AND cu.is_active = true
        AND cu.role      IN ('super_admin', 'system_admin')
    )
  )
);

-- ============================================================
-- SEÇÃO B2: lead_stage_history (funnel_id → sales_funnels.company_id)
-- Append-only: UPDATE e DELETE ausentes por design (log imutável)
-- ============================================================

DROP POLICY IF EXISTS "lead_stage_history_select" ON lead_stage_history;
DROP POLICY IF EXISTS "lead_stage_history_insert"  ON lead_stage_history;

-- SELECT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lsh_select_member_or_parent_admin"
ON lead_stage_history FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = lead_stage_history.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = lead_stage_history.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- INSERT: qualquer membro ativo (Trilha 1) OU super_admin/system_admin da parent (Trilha 2)
CREATE POLICY "lsh_insert_member_or_parent_admin"
ON lead_stage_history FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = lead_stage_history.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = lead_stage_history.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- ============================================================
-- SEÇÃO B3: opportunity_funnel_positions (funnel_id → sales_funnels.company_id)
-- Qualquer membro ativo pode mover cards (INSERT/UPDATE/DELETE liberado)
-- ============================================================

DROP POLICY IF EXISTS "opportunity_funnel_positions_select"        ON opportunity_funnel_positions;
DROP POLICY IF EXISTS "opportunity_funnel_positions_member_select"  ON opportunity_funnel_positions;
DROP POLICY IF EXISTS "opportunity_funnel_positions_insert"         ON opportunity_funnel_positions;
DROP POLICY IF EXISTS "opportunity_funnel_positions_update"         ON opportunity_funnel_positions;
DROP POLICY IF EXISTS "opportunity_funnel_positions_delete"         ON opportunity_funnel_positions;

-- SELECT
CREATE POLICY "ofp_select_member_or_parent_admin"
ON opportunity_funnel_positions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = opportunity_funnel_positions.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = opportunity_funnel_positions.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- INSERT
CREATE POLICY "ofp_insert_member_or_parent_admin"
ON opportunity_funnel_positions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = opportunity_funnel_positions.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = opportunity_funnel_positions.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- UPDATE: com WITH CHECK (impede mover posição para funil de outra empresa)
CREATE POLICY "ofp_update_member_or_parent_admin"
ON opportunity_funnel_positions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = opportunity_funnel_positions.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = opportunity_funnel_positions.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = opportunity_funnel_positions.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = opportunity_funnel_positions.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);

-- DELETE
CREATE POLICY "ofp_delete_member_or_parent_admin"
ON opportunity_funnel_positions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sales_funnels sf
    WHERE sf.id = opportunity_funnel_positions.funnel_id
      AND auth_user_is_company_member(sf.company_id)
  )
  OR EXISTS (
    SELECT 1 FROM sales_funnels sf
    JOIN companies child   ON child.id = sf.company_id
    JOIN company_users cu  ON cu.company_id = child.parent_company_id
    WHERE sf.id        = opportunity_funnel_positions.funnel_id
      AND cu.user_id   = auth.uid()
      AND cu.is_active = true
      AND cu.role      IN ('super_admin', 'system_admin')
  )
);
