# 📋 DOCUMENTAÇÃO COMPLETA - SISTEMA DE USUÁRIOS

## 🎯 OBJETIVO DA IMPLEMENTAÇÃO
Implementar sistema de múltiplos usuários por empresa mantendo 100% de compatibilidade com o sistema atual.

## 📊 ESTADO ATUAL (PRÉ-IMPLEMENTAÇÃO)

### 🏗️ ARQUITETURA EXISTENTE

#### Tabela `companies`
```sql
CREATE TABLE companies (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id), -- ✅ Relação 1:1 atual
  name text NOT NULL,
  parent_company_id uuid REFERENCES companies(id), -- ✅ Hierarquia existente
  company_type text CHECK (company_type IN ('parent', 'client')), -- ✅ Tipos existentes
  is_super_admin boolean DEFAULT false, -- ✅ Role básico atual
  plan text DEFAULT 'basic',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### AuthContext Atual
- **Arquivo**: `src/contexts/AuthContext.tsx`
- **Funcionalidades**:
  - `signIn/signUp`: Autenticação básica
  - `impersonateUser`: Super admin acessa qualquer empresa
  - `fetchCompany`: Busca empresa por user_id
  - `switchCompany`: Troca entre empresas disponíveis

#### Sistema de Impersonação
- **Validação**: `company?.is_super_admin`
- **Armazenamento**: localStorage + React state
- **Interface**: Botão "Entrar" em `/companies`
- **Fluxo**: Super admin → Qualquer empresa filha

### 🔄 FLUXOS ATUAIS

#### Criação de Empresa
```typescript
// AuthContext.tsx - signUp()
if (companyName === 'M4 Digital') {
  // Associa à M4 Digital existente
  UPDATE companies SET user_id = data.user.id WHERE name = 'M4 Digital'
} else {
  // Cria nova empresa cliente
  INSERT INTO companies (user_id, name, company_type, is_super_admin)
}
```

#### Impersonação
```typescript
// AuthContext.tsx - impersonateUser()
1. Validação: !company?.is_super_admin → Error
2. Busca: SELECT * FROM companies WHERE id = companyId
3. Estado: localStorage + setCompany(targetCompany)
4. Redirect: window.location.href = '/dashboard'
```

### ⚠️ LIMITAÇÕES IDENTIFICADAS
- ❌ **1 usuário por empresa**: Não suporta equipes
- ❌ **Roles limitados**: Apenas is_super_admin
- ❌ **Sem permissões granulares**: Controle binário
- ❌ **Partners sem subcontas**: Não podem gerenciar clientes
- ❌ **Escalabilidade**: Estrutura não cresce com negócio

## 🚀 NOVA IMPLEMENTAÇÃO PROPOSTA

### 🏗️ NOVA ARQUITETURA

#### Tabela `company_users` (Nova)
```sql
CREATE TABLE company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN (
    'super_admin',  -- Super usuário M4 Digital
    'admin',        -- Admin M4 Digital ou Cliente
    'partner',      -- Partner M4 Digital
    'manager',      -- Gerente Cliente
    'seller'        -- Vendedor Cliente
  )),
  permissions jsonb DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(company_id, user_id)
);
```

#### Sistema de Permissões
```typescript
interface UserPermissions {
  // Módulos
  dashboard: boolean;
  leads: boolean;
  chat: boolean;
  analytics: boolean;
  settings: boolean;
  companies: boolean;
  users: boolean;
  financial: boolean;
  
  // Ações
  create_users: boolean;
  edit_users: boolean;
  delete_users: boolean;
  impersonate: boolean;
  view_all_leads: boolean;
  edit_all_leads: boolean;
  
  // Limitações
  max_companies?: number;
  max_users?: number;
  restricted_companies?: string[];
}
```

### 🔐 POLÍTICAS DE SEGURANÇA (RLS)
```sql
-- Super Admin vê tudo
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
    )
  );

-- Admin vê empresas que gerencia
CREATE POLICY "Admin can view managed company users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN company_users cu ON cu.company_id = c.id
      WHERE cu.user_id = auth.uid() 
      AND cu.role IN ('admin', 'super_admin')
    )
  );
```

## 🔄 ESTRATÉGIA DE MIGRAÇÃO

### FASE 1: ESTRUTURA PARALELA
1. ✅ Criar tabela `company_users`
2. ✅ Implementar RLS e políticas
3. ✅ Migrar dados existentes automaticamente
4. ✅ Manter sistema atual funcionando

### FASE 2: SISTEMA HÍBRIDO
1. ✅ Atualizar AuthContext com compatibilidade
2. ✅ Validações duplas (atual + novo)
3. ✅ Interface preservada 100%
4. ✅ Rollback disponível

### FASE 3: NOVA FUNCIONALIDADE
1. ✅ Página de gestão de usuários
2. ✅ Sistema de permissões granulares
3. ✅ Roles e hierarquias completas
4. ✅ Deprecar campos antigos gradualmente

## 🛡️ GARANTIAS DE SEGURANÇA

### ✅ COMPATIBILIDADE TOTAL
- **Impersonação**: Funcionará exatamente igual
- **Interface**: Zero mudanças visuais
- **Fluxos**: Todos preservados
- **Performance**: Sem impacto

### ✅ ROLLBACK SEGURO
- **Backup completo**: Código + banco + git
- **Sistema paralelo**: Não afeta estrutura atual
- **Validações**: Duplas durante transição
- **Monitoramento**: Logs detalhados

### ✅ TESTES OBRIGATÓRIOS
- **Impersonação**: Super admin → Empresas filhas
- **Autenticação**: Login/logout funcionando
- **Navegação**: Todas as páginas acessíveis
- **Dados**: Isolamento por empresa mantido

## 📁 ARQUIVOS PRINCIPAIS

### Modificações Necessárias
- `src/contexts/AuthContext.tsx` - Sistema híbrido
- `src/pages/Settings.tsx` - Nova aba usuários
- `supabase/migrations/` - Nova tabela e RLS

### Novos Arquivos
- `src/components/UserManagement/` - Interface usuários
- `src/services/userApi.ts` - API de usuários
- `src/types/user.ts` - Tipos TypeScript

## 🎯 RESULTADO ESPERADO

### ✅ FUNCIONALIDADES MANTIDAS
- Sistema atual 100% preservado
- Impersonação funcionando igual
- Performance mantida
- Segurança reforçada

### ✅ NOVAS FUNCIONALIDADES
- Múltiplos usuários por empresa
- Roles granulares (admin, gerente, vendedor)
- Partners com subcontas
- Sistema de permissões detalhado
- Interface de gestão de usuários

---

**Data**: 29/11/2025 - 07:25 (UTC-3)
**Responsável**: Sistema de implementação segura
**Status**: Documentação completa ✅
