/*
  # Sistema de Múltiplos Usuários por Empresa
  
  ## Objetivo
  Implementar sistema de N:N entre empresas e usuários mantendo 100% compatibilidade
  
  ## Estratégia
  - Criar estrutura paralela sem afetar sistema atual
  - Migrar dados existentes automaticamente
  - Manter compatibilidade total durante transição
  
  ## Segurança
  - RLS rigoroso por empresa e hierarquia
  - Validações de integridade
  - Logs de auditoria
*/

-- =====================================================
-- 1. TABELA PRINCIPAL: company_users
-- =====================================================

CREATE TABLE IF NOT EXISTS company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN (
    'super_admin',     -- Super usuário (M4 Digital)
    'admin',           -- Admin (M4 Digital ou Cliente)
    'partner',         -- Partner (M4 Digital)
    'manager',         -- Gerente (Cliente)
    'seller'           -- Vendedor (Cliente)
  )),
  permissions jsonb DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints de integridade
  UNIQUE(company_id, user_id),
  
  -- Validação: roles específicos para tipos de empresa
  CONSTRAINT valid_role_for_company_type CHECK (
    (role IN ('super_admin', 'admin', 'partner') AND 
     company_id IN (SELECT id FROM companies WHERE company_type = 'parent')) OR
    (role IN ('admin', 'manager', 'seller') AND 
     company_id IN (SELECT id FROM companies WHERE company_type = 'client'))
  )
);

-- =====================================================
-- 2. ÍNDICES PARA PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_user_id ON company_users(user_id);
CREATE INDEX IF NOT EXISTS idx_company_users_role ON company_users(role);
CREATE INDEX IF NOT EXISTS idx_company_users_active ON company_users(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_company_users_company_user ON company_users(company_id, user_id);

-- GIN index para permissões JSONB
CREATE INDEX IF NOT EXISTS idx_company_users_permissions ON company_users USING GIN(permissions);

-- =====================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;

-- Super Admin pode ver todos os usuários
CREATE POLICY "Super admin can view all users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      JOIN companies c ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role = 'super_admin'
      AND c.company_type = 'parent'
      AND cu.is_active = true
    )
  );

-- Admin pode ver usuários das empresas que gerencia
CREATE POLICY "Admin can view managed company users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN company_users cu ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role IN ('admin', 'super_admin')
      AND cu.is_active = true
      AND (
        c.company_type = 'parent' OR 
        c.parent_company_id IN (
          SELECT parent_c.id FROM companies parent_c
          JOIN company_users parent_cu ON parent_cu.company_id = parent_c.id
          WHERE parent_cu.user_id = auth.uid()
          AND parent_cu.is_active = true
        )
      )
    )
  );

-- Partners podem ver usuários das suas empresas
CREATE POLICY "Partner can view own company users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.id IN (
        SELECT cu.company_id FROM company_users cu
        WHERE cu.user_id = auth.uid() 
        AND cu.role = 'partner'
        AND cu.is_active = true
      )
      OR c.parent_company_id IN (
        SELECT cu.company_id FROM company_users cu
        WHERE cu.user_id = auth.uid() 
        AND cu.role = 'partner'
        AND cu.is_active = true
      )
    )
  );

-- Usuários podem ver próprios registros
CREATE POLICY "Users can view own records"
  ON company_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- 4. POLÍTICAS DE INSERÇÃO
-- =====================================================

-- Super Admin pode criar qualquer usuário
CREATE POLICY "Super admin can create users"
  ON company_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      JOIN companies c ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role = 'super_admin'
      AND c.company_type = 'parent'
      AND cu.is_active = true
    )
  );

-- Admin pode criar usuários nas empresas que gerencia
CREATE POLICY "Admin can create managed company users"
  ON company_users FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN company_users cu ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role IN ('admin', 'super_admin')
      AND cu.is_active = true
    )
  );

-- =====================================================
-- 5. POLÍTICAS DE ATUALIZAÇÃO
-- =====================================================

-- Super Admin pode atualizar qualquer usuário
CREATE POLICY "Super admin can update users"
  ON company_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      JOIN companies c ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role = 'super_admin'
      AND c.company_type = 'parent'
      AND cu.is_active = true
    )
  );

-- Admin pode atualizar usuários das empresas que gerencia
CREATE POLICY "Admin can update managed company users"
  ON company_users FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN company_users cu ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role IN ('admin', 'super_admin')
      AND cu.is_active = true
    )
  );

-- =====================================================
-- 6. FUNÇÕES AUXILIARES
-- =====================================================

-- Função para obter permissões de um usuário
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_permissions jsonb := '{}';
  v_role text;
BEGIN
  -- Buscar role do usuário na empresa
  SELECT role INTO v_role
  FROM company_users
  WHERE user_id = p_user_id 
  AND company_id = p_company_id
  AND is_active = true;
  
  -- Definir permissões baseadas no role
  CASE v_role
    WHEN 'super_admin' THEN
      v_permissions := '{
        "dashboard": true,
        "leads": true,
        "chat": true,
        "analytics": true,
        "settings": true,
        "companies": true,
        "users": true,
        "financial": true,
        "create_users": true,
        "edit_users": true,
        "delete_users": true,
        "impersonate": true,
        "view_all_leads": true,
        "edit_all_leads": true
      }';
    WHEN 'admin' THEN
      v_permissions := '{
        "dashboard": true,
        "leads": true,
        "chat": true,
        "analytics": true,
        "settings": true,
        "companies": false,
        "users": true,
        "financial": false,
        "create_users": true,
        "edit_users": true,
        "delete_users": false,
        "impersonate": false,
        "view_all_leads": true,
        "edit_all_leads": true
      }';
    WHEN 'partner' THEN
      v_permissions := '{
        "dashboard": true,
        "leads": true,
        "chat": true,
        "analytics": true,
        "settings": false,
        "companies": false,
        "users": false,
        "financial": false,
        "create_users": false,
        "edit_users": false,
        "delete_users": false,
        "impersonate": false,
        "view_all_leads": true,
        "edit_all_leads": true
      }';
    WHEN 'manager' THEN
      v_permissions := '{
        "dashboard": true,
        "leads": true,
        "chat": true,
        "analytics": true,
        "settings": false,
        "companies": false,
        "users": false,
        "financial": false,
        "create_users": false,
        "edit_users": false,
        "delete_users": false,
        "impersonate": false,
        "view_all_leads": true,
        "edit_all_leads": false
      }';
    WHEN 'seller' THEN
      v_permissions := '{
        "dashboard": true,
        "leads": true,
        "chat": true,
        "analytics": false,
        "settings": false,
        "companies": false,
        "users": false,
        "financial": false,
        "create_users": false,
        "edit_users": false,
        "delete_users": false,
        "impersonate": false,
        "view_all_leads": false,
        "edit_all_leads": false
      }';
    ELSE
      v_permissions := '{}';
  END CASE;
  
  RETURN v_permissions;
END;
$$;

-- Função para verificar se usuário pode impersonar
CREATE OR REPLACE FUNCTION can_impersonate_company(p_user_id uuid, p_target_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_can_impersonate boolean := false;
BEGIN
  -- Super admin pode impersonar qualquer empresa
  IF EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies c ON cu.company_id = c.id
    WHERE cu.user_id = p_user_id 
    AND cu.role = 'super_admin'
    AND c.company_type = 'parent'
    AND cu.is_active = true
  ) THEN
    v_can_impersonate := true;
  END IF;
  
  -- Admin pode impersonar empresas filhas
  IF NOT v_can_impersonate AND EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies c1 ON cu.company_id = c1.id
    JOIN companies c2 ON c1.id = c2.parent_company_id
    WHERE cu.user_id = p_user_id 
    AND cu.role = 'admin'
    AND c2.id = p_target_company_id
    AND cu.is_active = true
  ) THEN
    v_can_impersonate := true;
  END IF;
  
  RETURN v_can_impersonate;
END;
$$;

-- =====================================================
-- 7. MIGRAÇÃO AUTOMÁTICA DOS DADOS EXISTENTES
-- =====================================================

-- Migrar usuários existentes para nova estrutura
INSERT INTO company_users (company_id, user_id, role, created_by, permissions)
SELECT 
  c.id as company_id,
  c.user_id,
  CASE 
    WHEN c.is_super_admin = true THEN 'super_admin'
    WHEN c.company_type = 'parent' THEN 'admin'
    ELSE 'admin'
  END as role,
  c.user_id as created_by,
  get_user_permissions(c.user_id, c.id) as permissions
FROM companies c
WHERE c.user_id IS NOT NULL
ON CONFLICT (company_id, user_id) DO NOTHING;

-- =====================================================
-- 8. TRIGGERS PARA MANTER SINCRONIZAÇÃO
-- =====================================================

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_company_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_company_users_updated_at
  BEFORE UPDATE ON company_users
  FOR EACH ROW
  EXECUTE FUNCTION update_company_users_updated_at();

-- =====================================================
-- 9. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE company_users IS 'Sistema de múltiplos usuários por empresa com roles e permissões granulares';
COMMENT ON COLUMN company_users.role IS 'Role do usuário: super_admin, admin, partner, manager, seller';
COMMENT ON COLUMN company_users.permissions IS 'Permissões específicas em formato JSON';
COMMENT ON COLUMN company_users.created_by IS 'Usuário que criou este registro';
COMMENT ON COLUMN company_users.is_active IS 'Flag para soft delete';

-- =====================================================
-- 10. LOG DE IMPLEMENTAÇÃO
-- =====================================================

-- Inserir log da migração
INSERT INTO webhook_logs (company_id, webhook_url, payload, response_status, sent_at)
SELECT 
  c.id,
  'SYSTEM_MIGRATION',
  jsonb_build_object(
    'migration', 'company_users_system',
    'timestamp', now(),
    'migrated_users', (SELECT COUNT(*) FROM company_users),
    'status', 'completed'
  ),
  200,
  now()
FROM companies c
WHERE c.is_super_admin = true
LIMIT 1;
