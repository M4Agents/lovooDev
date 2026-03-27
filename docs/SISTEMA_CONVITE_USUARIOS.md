# Sistema de Convite de Usuários - Documentação Técnica

**Data:** 26/03/2026  
**Versão:** 2.0  
**Status:** ✅ Implementado e Funcional

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Fluxo Principal](#fluxo-principal)
4. [Fluxos de Fallback](#fluxos-de-fallback)
5. [Hierarquia de Empresas](#hierarquia-de-empresas)
6. [API Routes](#api-routes)
7. [Frontend](#frontend)
8. [Templates de Email](#templates-de-email)
9. [Segurança](#segurança)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

### Objetivo
Sistema completo de convite e ativação de usuários usando **tokens oficiais do Supabase**, com suporte a **hierarquia de empresas** (parent/client) e **fallbacks seguros** quando email não chega.

### Principais Mudanças (v2.0)
- ❌ **Removido:** Tokens customizados (base64)
- ❌ **Removido:** Convites simulados
- ✅ **Adicionado:** Tokens oficiais Supabase
- ✅ **Adicionado:** API routes server-side
- ✅ **Adicionado:** Fallbacks seguros (magic link, confirmação manual)
- ✅ **Adicionado:** Suporte a hierarquia de empresas

---

## 🏗️ Arquitetura

### Componentes

```
Frontend (React)
├── UserModal.tsx              # Criação de usuários
├── AcceptInvite.tsx           # Ativação de conta (simplificado)
└── AuthContext.tsx            # Carrega empresa do convite

Backend (API Routes - Vercel)
├── /api/auth/invite-user.ts           # Convite oficial
├── /api/auth/generate-magic-link.ts   # Fallback 1
└── /api/auth/confirm-user.ts          # Fallback 2

Services
├── authAdmin.ts               # Lógica de convite
└── userApi.ts                 # Criação de company_user

Database (Supabase)
├── auth.users                 # Usuários Supabase
├── company_users              # Vínculo empresa-usuário
└── companies                  # Empresas (parent/client)

Email (Supabase SMTP)
├── Invite user template       # Email de convite
├── Reset password template    # Email de reset
└── Magic link template        # Email de magic link
```

---

## 🔄 Fluxo Principal

### 1. Admin Cria Usuário

**Arquivo:** `src/components/UserManagement/UserModal.tsx`

```typescript
// Admin preenche formulário
const formData = {
  email: 'usuario@exemplo.com',
  role: 'admin',
  company_id: 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'
};

// Chama API
await createCompanyUser(formData);
```

### 2. Sistema Cria Usuário e Envia Convite

**Arquivo:** `src/services/userApi.ts`

```typescript
// Cria vínculo em company_users
const { data: companyUser } = await supabase.rpc('create_company_user_safe', {
  p_company_id: company_id,
  p_user_id: userId,
  p_role: role,
  p_permissions: permissions,
  p_created_by: currentUser.id
});

// Envia convite via authAdmin
const inviteResult = await inviteUser({
  email: email,
  redirectTo: 'https://app.lovoocrm.com/accept-invite',
  data: {
    role: role,
    company_id: company_id,
    company_name: company.name
  }
});
```

### 3. API Route Envia Email

**Arquivo:** `api/auth/invite-user.ts`

```typescript
// Usa Service Role Key (segura, server-side)
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

// Convida usuário via Admin API
const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
  email,
  {
    redirectTo: 'https://app.lovoocrm.com/accept-invite',
    data: {
      role: role,
      company_id: company_id,
      company_name: company_name
    }
  }
);
```

### 4. Supabase Envia Email

**Template:** Authentication → Email Templates → Invite user

```html
<a href="{{ .ConfirmationURL }}">Ativar minha conta</a>
```

**URL gerada:**
```
https://app.lovoocrm.com/accept-invite#access_token=eyJhbGc...&type=invite
```

### 5. Usuário Clica no Link

**Supabase autentica automaticamente e redireciona para `/accept-invite`**

### 6. AcceptInvite Processa

**Arquivo:** `src/pages/AcceptInvite.tsx`

```typescript
// Verifica se usuário já está autenticado (veio do link do email)
const { data: { session } } = await supabase.auth.getSession();

if (session?.user) {
  // Usuário autenticado - atualizar senha
  await supabase.auth.updateUser({ password: formData.password });
  
  // Salvar company_id do convite
  if (session.user.user_metadata?.company_id) {
    localStorage.setItem('invited_company_id', session.user.user_metadata.company_id);
  }
  
  // Redirecionar para dashboard
  navigate('/dashboard');
}
```

### 7. AuthContext Carrega Empresa Correta

**Arquivo:** `src/contexts/AuthContext.tsx`

```typescript
// Verificar se há company_id do convite (primeira vez)
const invitedCompanyId = localStorage.getItem('invited_company_id');

if (invitedCompanyId && !company) {
  const { data: invitedCompany } = await supabase
    .from('companies')
    .select('*')
    .eq('id', invitedCompanyId)
    .single();
    
  if (invitedCompany) {
    setCompany(invitedCompany);
    localStorage.removeItem('invited_company_id'); // Limpar após usar
  }
}
```

---

## 🔀 Fluxos de Fallback

### Fallback 1: Magic Link Manual

**Quando usar:** Email de convite não chegou

**Arquivo:** `api/auth/generate-magic-link.ts`

```typescript
// Admin clica "Gerar Link Manual"
const { data } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: email,
  options: {
    redirectTo: 'https://app.lovoocrm.com/accept-invite'
  }
});

// Retorna link oficial do Supabase
return { magicLink: data.properties.action_link };
```

**Fluxo:**
1. Admin gera link manual
2. Copia link gerado
3. Envia para usuário via WhatsApp/Telegram
4. Usuário clica e ativa conta

**Validade:** 1 hora

---

### Fallback 2: Confirmação Manual

**Quando usar:** Email não chega e não é possível enviar link manual

**Arquivo:** `api/auth/confirm-user.ts`

```typescript
// Admin clica "Confirmar Manualmente"
const { error } = await supabaseAdmin.auth.admin.updateUserById(
  user.id,
  { email_confirm: true }
);

// Usuário confirmado - pode usar "Esqueci minha senha"
```

**Fluxo:**
1. Admin confirma usuário manualmente
2. Usuário acessa tela de login
3. Clica em "Esqueci minha senha"
4. Define senha e faz login

---

## 🏢 Hierarquia de Empresas

### Tipos de Empresa

| Tipo | Descrição | Roles Permitidos |
|------|-----------|------------------|
| **parent** | M4 Digital (empresa mãe) | super_admin, admin, partner |
| **client** | Empresas clientes | admin, manager, seller |

### Constraint SQL

```sql
CONSTRAINT valid_role_for_company_type CHECK (
  (role IN ('super_admin', 'admin', 'partner') AND 
   company_id IN (SELECT id FROM companies WHERE company_type = 'parent')) OR
  (role IN ('admin', 'manager', 'seller') AND 
   company_id IN (SELECT id FROM companies WHERE company_type = 'client'))
)
```

### Fluxo com Hierarquia

```typescript
// 1. Convite inclui company_id
data: {
  role: 'admin',
  company_id: 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413', // M4 Digital
  company_name: 'M4 Digital'
}

// 2. AcceptInvite salva company_id
localStorage.setItem('invited_company_id', company_id);

// 3. AuthContext carrega empresa específica
const invitedCompany = await supabase
  .from('companies')
  .select('*')
  .eq('id', invitedCompanyId)
  .single();

// 4. Usuário vê dashboard da empresa correta
```

### Parceiros

**Tabela:** `partner_company_links`

```sql
CREATE TABLE partner_company_links (
  partner_user_id uuid,  -- Usuário com role 'partner' na M4 Digital
  company_id uuid        -- Empresa cliente vinculada
);
```

**Fluxo:**
1. Parceiro criado na M4 Digital (parent) com role 'partner'
2. Vinculado a empresas clientes via `partner_company_links`
3. Pode acessar múltiplas empresas clientes

---

## 🔌 API Routes

### 1. Invite User

**Arquivo:** `api/auth/invite-user.ts`

**Método:** POST

**Body:**
```json
{
  "email": "usuario@exemplo.com",
  "redirectTo": "https://app.lovoocrm.com/accept-invite",
  "data": {
    "role": "admin",
    "company_id": "uuid",
    "company_name": "Nome da Empresa"
  }
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "usuario@exemplo.com"
  }
}
```

**Segurança:**
- Usa `SUPABASE_SERVICE_ROLE_KEY` (server-side)
- Nunca exposta ao frontend
- Configurada no Vercel

---

### 2. Generate Magic Link

**Arquivo:** `api/auth/generate-magic-link.ts`

**Método:** POST

**Body:**
```json
{
  "email": "usuario@exemplo.com"
}
```

**Response:**
```json
{
  "success": true,
  "magicLink": "https://app.lovoocrm.com/accept-invite#access_token=...",
  "expiresIn": 3600
}
```

**Uso:**
```typescript
const result = await generateMagicLink('usuario@exemplo.com');
// Admin copia result.magicLink e envia via WhatsApp
```

---

### 3. Confirm User

**Arquivo:** `api/auth/confirm-user.ts`

**Método:** POST

**Body:**
```json
{
  "email": "usuario@exemplo.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Usuário confirmado. Pode usar 'Esqueci minha senha'."
}
```

---

## 💻 Frontend

### AcceptInvite (Simplificado)

**Antes (v1.0):** 4 estratégias complexas  
**Depois (v2.0):** 1 fluxo simples

```typescript
// FLUXO ÚNICO
const handleAcceptInvite = async () => {
  // 1. Verificar se já está autenticado
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session?.user) {
    // Autenticado - atualizar senha
    await supabase.auth.updateUser({ password: formData.password });
    
    // Salvar company_id
    if (session.user.user_metadata?.company_id) {
      localStorage.setItem('invited_company_id', session.user.user_metadata.company_id);
    }
    
    navigate('/dashboard');
    return;
  }
  
  // 2. Tentar login com senha
  const { data } = await supabase.auth.signInWithPassword({
    email: email,
    password: formData.password
  });
  
  if (data.user) {
    // Salvar company_id
    if (data.user.user_metadata?.company_id) {
      localStorage.setItem('invited_company_id', data.user.user_metadata.company_id);
    }
    
    navigate('/dashboard');
  }
};
```

### AuthContext

**Prioridade de carregamento:**

1. ✅ `invited_company_id` (primeira vez após convite)
2. ✅ `impersonated_company_id` (impersonação)
3. ✅ `company_users` (empresas do usuário)
4. ✅ `companies.user_id` (sistema legado)

---

## 📧 Templates de Email

### Localização

**Supabase Dashboard:**
```
Authentication → Email Templates
```

### 1. Invite User

**Quando:** Usuário convidado via `inviteUserByEmail()`

**Variável:** `{{ .ConfirmationURL }}`

**Template:**
```html
<a href="{{ .ConfirmationURL }}">Ativar minha conta</a>
```

**Imagem:**
```html
<img src="https://app.lovoocrm.com/images/emails/logo_fundo_branco-300x128.png" />
```

---

### 2. Reset Password

**Quando:** Usuário usa "Esqueci minha senha"

**Variável:** `{{ .ConfirmationURL }}`

**Template:**
```html
<a href="{{ .ConfirmationURL }}">Redefinir minha senha</a>
```

---

### 3. Magic Link

**Quando:** Admin gera magic link manual

**Variável:** `{{ .ConfirmationURL }}`

**Template:**
```html
<a href="{{ .ConfirmationURL }}">Acessar minha conta</a>
```

---

## 🔒 Segurança

### Service Role Key

**Configuração:**
- Variável: `SUPABASE_SERVICE_ROLE_KEY`
- Onde: Vercel Environment Variables
- Uso: Apenas server-side (API routes)
- **NUNCA** exposta ao frontend

**Validação:**
```typescript
if (!serviceRoleKey) {
  return res.status(500).json({ 
    error: 'Service Role Key não configurada'
  });
}
```

### Tokens

**Antes (v1.0):**
```typescript
// ❌ Token customizado (inseguro)
const token = btoa(`${email}:${inviteId}:${Date.now()}`);
```

**Depois (v2.0):**
```typescript
// ✅ Token oficial Supabase (seguro)
// Gerado automaticamente pelo Supabase
// Hash único, criptografado, com expiração
```

### RLS Policies

**company_users:**
```sql
-- Usuário só vê próprios dados
CREATE POLICY "Users can view own data"
  ON company_users FOR SELECT
  USING (user_id = auth.uid());

-- Admin vê usuários da empresa
CREATE POLICY "Admin can view company users"
  ON company_users FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM company_users 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'super_admin')
    )
  );
```

---

## 🐛 Troubleshooting

### Email não chega

**Causas:**
1. SMTP não configurado
2. Email caiu em spam
3. Rate limit atingido
4. Servidor SMTP offline

**Soluções:**
1. Verificar SMTP: Authentication → Settings → SMTP Settings
2. Pedir usuário verificar spam
3. Usar fallback: Gerar magic link manual
4. Usar fallback: Confirmar manualmente

---

### Erro 403 ao criar usuário

**Causa:** Service Role Key não configurada

**Solução:**
```bash
# Vercel
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

---

### Usuário ativa mas entra em empresa errada

**Causa:** `company_id` não foi salvo/carregado

**Verificar:**
1. `user_metadata` contém `company_id`?
2. `localStorage.invited_company_id` foi salvo?
3. `AuthContext` verifica `invited_company_id`?

**Solução:**
```typescript
// AcceptInvite.tsx
if (session.user.user_metadata?.company_id) {
  localStorage.setItem('invited_company_id', session.user.user_metadata.company_id);
}

// AuthContext.tsx
const invitedCompanyId = localStorage.getItem('invited_company_id');
if (invitedCompanyId && !company) {
  // Carregar empresa
}
```

---

### Constraint violation ao criar usuário

**Erro:**
```
ERROR: new row violates check constraint "valid_role_for_company_type"
```

**Causa:** Role incompatível com tipo de empresa

**Exemplos:**
- ❌ `super_admin` em empresa `client`
- ❌ `seller` em empresa `parent`

**Solução:**
```typescript
// Validar antes de criar
const validateRole = (role: string, companyType: string) => {
  const parentRoles = ['super_admin', 'admin', 'partner'];
  const clientRoles = ['admin', 'manager', 'seller'];
  
  if (companyType === 'parent') {
    return parentRoles.includes(role);
  }
  return clientRoles.includes(role);
};
```

---

## 📊 Estatísticas

**Implementação:**
- Data: 26/03/2026
- Commits: 3 (lovooDev), 1 (loovocrm)
- Arquivos modificados: 74
- Linhas adicionadas: 5,832
- Linhas removidas: 415

**Arquivos principais:**
- `src/services/authAdmin.ts` (removido convite simulado)
- `src/pages/AcceptInvite.tsx` (simplificado)
- `src/contexts/AuthContext.tsx` (hierarquia)
- `api/auth/invite-user.ts` (novo)
- `api/auth/generate-magic-link.ts` (novo)
- `api/auth/confirm-user.ts` (novo)

---

## 🚀 Próximos Passos

### Melhorias Futuras

1. **UI para Fallbacks**
   - Botão "Gerar Link Manual" no UserModal
   - Botão "Confirmar Manualmente" no UserModal
   - Modal para mostrar magic link gerado

2. **Logs e Auditoria**
   - Registrar tentativas de convite
   - Registrar uso de fallbacks
   - Dashboard de convites pendentes

3. **Notificações**
   - Notificar admin quando email falha
   - Notificar usuário quando conta é confirmada
   - Lembrete para usuários que não ativaram

---

## 📚 Referências

**Migrations:**
- `20251129072600_create_company_users_system.sql` - Sistema de usuários

**Documentação:**
- `SISTEMA_GESTAO_USUARIOS.md` - Fotos de perfil
- `DOCUMENTACAO_IMPLEMENTACAO_RLS_CHAT.md` - RLS com company_users

**Supabase:**
- [Admin API](https://supabase.com/docs/reference/javascript/auth-admin-inviteUserByEmail)
- [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)

---

**Versão:** 2.0  
**Status:** ✅ Produção  
**Última atualização:** 26/03/2026
