-- ============================================================
-- BLOCO 4C: Adição de is_active = true nas policies restantes
-- Problema: subqueries em company_users sem is_active permitem acesso de usuários inativos
-- Solução: substituir subqueries inline pelo helper auth_user_is_company_member(company_id)
--          que já filtra is_active internamente (definido no Bloco 2)
-- Tabelas: catalog_categories, catalog_item_media, catalog_item_relations,
--          opportunity_items, opportunity_stage_history, opportunity_status_history,
--          custom_activity_types, distribution_state, company_media_library,
--          products, services, internal_notes, chat_scheduled_messages (remanescentes)
-- Padrão: ALL e policies individuais são separadas em 4 ops (SELECT/INSERT/UPDATE/DELETE)
--         para garantir WITH CHECK em INSERT/UPDATE
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- ============================================================

-- ============================================================
-- SEÇÃO 1: catalog_categories
-- ============================================================

DROP POLICY IF EXISTS "catalog_categories_select" ON catalog_categories;
DROP POLICY IF EXISTS "catalog_categories_insert" ON catalog_categories;
DROP POLICY IF EXISTS "catalog_categories_update" ON catalog_categories;
DROP POLICY IF EXISTS "catalog_categories_delete" ON catalog_categories;

CREATE POLICY "cc_select_member_or_parent_admin"
ON catalog_categories FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cc_insert_member_or_parent_admin"
ON catalog_categories FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cc_update_member_or_parent_admin"
ON catalog_categories FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cc_delete_member_or_parent_admin"
ON catalog_categories FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 2: catalog_item_media
-- ============================================================

DROP POLICY IF EXISTS "catalog_item_media_select" ON catalog_item_media;
DROP POLICY IF EXISTS "catalog_item_media_insert" ON catalog_item_media;
DROP POLICY IF EXISTS "catalog_item_media_update" ON catalog_item_media;
DROP POLICY IF EXISTS "catalog_item_media_delete" ON catalog_item_media;

CREATE POLICY "cim_select_member_or_parent_admin"
ON catalog_item_media FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cim_insert_member_or_parent_admin"
ON catalog_item_media FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cim_update_member_or_parent_admin"
ON catalog_item_media FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cim_delete_member_or_parent_admin"
ON catalog_item_media FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 3: catalog_item_relations
-- ============================================================

DROP POLICY IF EXISTS "catalog_item_relations_select" ON catalog_item_relations;
DROP POLICY IF EXISTS "catalog_item_relations_insert" ON catalog_item_relations;
DROP POLICY IF EXISTS "catalog_item_relations_update" ON catalog_item_relations;
DROP POLICY IF EXISTS "catalog_item_relations_delete" ON catalog_item_relations;

CREATE POLICY "cir_select_member_or_parent_admin"
ON catalog_item_relations FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cir_insert_member_or_parent_admin"
ON catalog_item_relations FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cir_update_member_or_parent_admin"
ON catalog_item_relations FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cir_delete_member_or_parent_admin"
ON catalog_item_relations FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 4: opportunity_items
-- ============================================================

DROP POLICY IF EXISTS "opportunity_items_select" ON opportunity_items;
DROP POLICY IF EXISTS "opportunity_items_insert" ON opportunity_items;
DROP POLICY IF EXISTS "opportunity_items_update" ON opportunity_items;
DROP POLICY IF EXISTS "opportunity_items_delete" ON opportunity_items;

CREATE POLICY "oi_select_member_or_parent_admin"
ON opportunity_items FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "oi_insert_member_or_parent_admin"
ON opportunity_items FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "oi_update_member_or_parent_admin"
ON opportunity_items FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "oi_delete_member_or_parent_admin"
ON opportunity_items FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 5: opportunity_stage_history
-- Era ALL — separado em 4 ops com WITH CHECK em INSERT/UPDATE
-- ============================================================

DROP POLICY IF EXISTS "ostagehist_tenant_isolation" ON opportunity_stage_history;

CREATE POLICY "osh_select_member_or_parent_admin"
ON opportunity_stage_history FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "osh_insert_member_or_parent_admin"
ON opportunity_stage_history FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "osh_update_member_or_parent_admin"
ON opportunity_stage_history FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "osh_delete_member_or_parent_admin"
ON opportunity_stage_history FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 6: opportunity_status_history
-- Era ALL — separado em 4 ops
-- ============================================================

DROP POLICY IF EXISTS "osh_tenant_isolation" ON opportunity_status_history;

CREATE POLICY "ostathist_select_member_or_parent_admin"
ON opportunity_status_history FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ostathist_insert_member_or_parent_admin"
ON opportunity_status_history FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ostathist_update_member_or_parent_admin"
ON opportunity_status_history FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ostathist_delete_member_or_parent_admin"
ON opportunity_status_history FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 7: custom_activity_types
-- Tinha ALL + SELECT duplicado — removendo ambos, criando 4 ops
-- ============================================================

DROP POLICY IF EXISTS "Users can manage their company activity types" ON custom_activity_types;
DROP POLICY IF EXISTS "Users can view their company activity types"   ON custom_activity_types;

CREATE POLICY "cat_select_member_or_parent_admin"
ON custom_activity_types FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cat_insert_member_or_parent_admin"
ON custom_activity_types FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cat_update_member_or_parent_admin"
ON custom_activity_types FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cat_delete_member_or_parent_admin"
ON custom_activity_types FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 8: distribution_state
-- Era ALL — separado em 4 ops
-- ============================================================

DROP POLICY IF EXISTS "Users can manage distribution state of their company" ON distribution_state;

CREATE POLICY "ds_select_member_or_parent_admin"
ON distribution_state FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ds_insert_member_or_parent_admin"
ON distribution_state FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ds_update_member_or_parent_admin"
ON distribution_state FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ds_delete_member_or_parent_admin"
ON distribution_state FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 9: company_media_library
-- Era ALL — separado em 4 ops
-- ============================================================

DROP POLICY IF EXISTS "company_media_isolation" ON company_media_library;

CREATE POLICY "cml_select_member_or_parent_admin"
ON company_media_library FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cml_insert_member_or_parent_admin"
ON company_media_library FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cml_update_member_or_parent_admin"
ON company_media_library FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "cml_delete_member_or_parent_admin"
ON company_media_library FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 10: products
-- ============================================================

DROP POLICY IF EXISTS "products_select" ON products;
DROP POLICY IF EXISTS "products_insert" ON products;
DROP POLICY IF EXISTS "products_update" ON products;
DROP POLICY IF EXISTS "products_delete" ON products;

CREATE POLICY "prod_select_member_or_parent_admin"
ON products FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_insert_member_or_parent_admin"
ON products FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_update_member_or_parent_admin"
ON products FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_delete_member_or_parent_admin"
ON products FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 11: services
-- ============================================================

DROP POLICY IF EXISTS "services_select" ON services;
DROP POLICY IF EXISTS "services_insert" ON services;
DROP POLICY IF EXISTS "services_update" ON services;
DROP POLICY IF EXISTS "services_delete" ON services;

CREATE POLICY "svc_select_member_or_parent_admin"
ON services FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_insert_member_or_parent_admin"
ON services FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_update_member_or_parent_admin"
ON services FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_delete_member_or_parent_admin"
ON services FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 12: internal_notes
-- SELECT e INSERT já têm lógica adicional (deleted_at, created_by, admin update)
-- Preservar a lógica extra — apenas substituir o acesso a company_users sem is_active
-- pelo helper (que inclui is_active internamente)
-- ============================================================

DROP POLICY IF EXISTS "intnotes_select" ON internal_notes;
DROP POLICY IF EXISTS "intnotes_insert" ON internal_notes;
DROP POLICY IF EXISTS "intnotes_update" ON internal_notes;

-- SELECT: membro ativo + soft-delete
CREATE POLICY "intnotes_select_member_or_parent_admin"
ON internal_notes FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
);

-- INSERT: membro ativo + created_by deve ser o próprio usuário
CREATE POLICY "intnotes_insert_member_or_parent_admin"
ON internal_notes FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
);

-- UPDATE: membro ativo + não deletado + (criador ou admin-level)
CREATE POLICY "intnotes_update_member_or_admin"
ON internal_notes FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
  AND (
    created_by = auth.uid()
    OR auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 13: chat_scheduled_messages — corrigir is_active nas 4 policies remanescentes
-- (as 2 legadas já foram removidas no Bloco 4B)
-- ============================================================

DROP POLICY IF EXISTS "chat_scheduled_messages_select_policy" ON chat_scheduled_messages;
DROP POLICY IF EXISTS "chat_scheduled_messages_insert_policy" ON chat_scheduled_messages;
DROP POLICY IF EXISTS "chat_scheduled_messages_update_policy" ON chat_scheduled_messages;
DROP POLICY IF EXISTS "chat_scheduled_messages_delete_policy" ON chat_scheduled_messages;

CREATE POLICY "csm_select_member_or_parent_admin"
ON chat_scheduled_messages FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "csm_insert_member_or_parent_admin"
ON chat_scheduled_messages FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "csm_update_member_or_parent_admin"
ON chat_scheduled_messages FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "csm_delete_member_or_parent_admin"
ON chat_scheduled_messages FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);
