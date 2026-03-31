# Sistema de Convite de Usuários - Documentação Técnica

**Data:** 31/03/2026  
**Versão:** 3.0  
**Status:** ✅ Implementado e Funcional

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Fluxo Principal](#fluxo-principal)
4. [Fluxo de Ativação de Conta](#fluxo-de-ativação-de-conta)
5. [Reenvio de Convite](#reenvio-de-convite)
6. [Hierarquia de Empresas](#hierarquia-de-empresas)
7. [API Routes](#api-routes)
8. [Frontend](#frontend)
9. [Segurança e RLS](#segurança-e-rls)
10. [RPC Chat](#rpc-chat)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

### Objetivo
Sistema completo de convite e ativação de usuários usando **magic links oficiais do Supabase**, totalmente **independente de SMTP**, com suporte a **hierarquia de empresas** (parent/client) e **isolamento multi-tenant via RLS**.

### Mudanças por Versão

#### v3.0 (31/03/2026)
- ❌ **Removido:** Dependência de SMTP para criação de usuários
- ❌ **Removido:** Redirecionamento para dashboard após ativação
- ❌ **Removido:** Tokens fake no reenvio de convite (`btoa`)
- ❌ **Removido:** `localStorage.invited_company_id` (desnecessário)
- ❌ **Removido:** `/accept-invite` dentro de `PublicRoute`
- ✅ **Adicionado:** `createUser` + `generateLink(magiclink)` — sem SMTP
- ✅ **Adicionado:** Magic link retornado ao frontend para envio manual
- ✅ **Adicionado:** Rota `/accept-invite` aberta (sem guard de autenticação)
- ✅ **Adicionado:** `onAuthStateChange` para capturar sessão do magic link
- ✅ **Adicionado:** `signOut()` após ativação → redireciona para login
- ✅ **Adicionado:** `InviteLink.tsx` chama API real para gerar magic link
- ✅ **Adicionado:** Policies RLS com funções `SECURITY DEFINER` para membros
- ✅ **Adicionado:** Acesso de membros a funil, chat, instâncias WhatsApp

#### v2.0 (26/03/2026)
- Tokens oficiais Supabase substituindo tokens customizados (base64)
- API routes server-side para criação de usuários
- Suporte a hierarquia de empresas (parent/client)

---

## 🏗️ Arquitetura

### Componentes

```
Frontend (React)
├── UserModal.tsx              # Criação de usuários + exibe magic link
├── InviteLink.tsx             # Reenvio de convite (chama API real)
├── AcceptInvite.tsx           # Ativação de conta (rota aberta)
└── App.tsx                    # Roteamento (/accept-invite sem PublicRoute)

Backend (API Routes - Vercel)
├── /api/auth/invite-user.ts           # Cria usuário + gera magic link
├── /api/auth/generate-magic-link.ts   # Gera magic link para usuário existente
└── /api/auth/confirm-user.ts          # Confirmação manual (fallback)

Services
├── authAdmin.ts               # Chamadas à API de convite
└── userApi.ts                 # Criação de company_user

Database (Supabase)
├── auth.users                 # Usuários Supabase
├── company_users              # Vínculo empresa-usuário (com RLS para membros)
├── companies                  # Empresas (com RLS para membros)
├── sales_funnels              # Funis (com RLS para membros)
├── funnel_stages              # Etapas (com RLS para membros)
├── whatsapp_life_instances    # Instâncias WhatsApp (com RLS para membros)
└── opportunity_funnel_positions # Posições no funil (com RLS para membros)
```

---

## 🔄 Fluxo Principal

### 1. Admin Cria Usuário

**Arquivo:** `src/components/UserManagement/UserModal.tsx`

Admin preenche o formulário (email, role, empresa) e confirma.

---

### 2. Backend Cria Usuário e Gera Magic Link

**Arquivo:** `api/auth/invite-user.ts`

```typescript
// Usa Service Role Key — nunca exposta ao frontend
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

// Passo 1: Criar usuário (email já confirmado, independente de SMTP)
const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
  email,
  email_confirm: true,  // ← confirma sem precisar de email
  user_metadata: {
    role,
    company_id,
    company_name,
    email_verified: true
  }
});

// Passo 2: Gerar magic link para ativação
const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: {
    redirectTo: 'https://app.lovoocrm.com/accept-invite'
  }
});

// Retorna o link para o frontend exibir ao admin
return res.status(200).json({
  success: true,
  user: resolvedUser,
  inviteLink: linkData.properties.action_link,
  isExistingUser: userAlreadyExists
});
```

> **Usuário já existe:** Se o email já está cadastrado, o sistema confirma o email (`updateUserById`) e gera um novo magic link para o usuário existente, sem criar duplicata.

---

### 3. Admin Recebe e Compartilha o Link

O frontend exibe o magic link gerado. O admin **copia e envia manualmente** para o usuário (WhatsApp, Telegram, email, etc.).

**Validade do link:** 1 hora.

---

### 4. Usuário Clica no Link

URL gerada pelo Supabase:
```
https://etzdsywunlpbgxkphuil.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=https://app.lovoocrm.com/accept-invite
```

O Supabase autentica o usuário e redireciona para `/accept-invite#access_token=...`.

---

## 🔐 Fluxo de Ativação de Conta

**Arquivo:** `src/pages/AcceptInvite.tsx`  
**Rota:** `/accept-invite` — **aberta, sem guard de autenticação**

### Por que a rota é aberta?

O magic link autentica o usuário **antes** do React renderizar a rota. Se `/accept-invite` estivesse dentro de `PublicRoute`, o guard detectaria o usuário autenticado e redirecionaria para `/dashboard` — sem nunca mostrar a página de ativação.

**Configuração em `App.tsx`:**
```tsx
// ✅ Correto — rota aberta (sem PublicRoute)
<Route path="/accept-invite" element={<AcceptInvite />} />

// ❌ Errado — redirecionaria para /dashboard antes de ativar
<Route path="/accept-invite" element={<PublicRoute><AcceptInvite /></PublicRoute>} />
```

---

### Processamento do Magic Link

```typescript
// 1. Listener detecta SIGNED_IN gerado pelo SDK ao processar o hash da URL
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    // Preenche email, role e empresa no formulário
    setInviteInfo({
      email: user.email,
      role: user.user_metadata?.role,
      company_name: user.user_metadata?.company_name
    });
  }
});

// 2. Detecta hash do Supabase para não redirecionar prematuramente
const hasSupabaseHash = window.location.hash.includes('access_token=');
if (hasSupabaseHash) {
  // Aguarda onAuthStateChange — não redireciona para login
  return;
}

// 3. Se não há hash nem token: verifica se há sessão ativa antes de redirecionar
supabase.auth.getSession().then(({ data: { session } }) => {
  if (!session) {
    navigate('/'); // Sem sessão → tela de login
  }
  // Com sessão (magic link já processado) → permanece na página
});
```

---

### Definição de Senha e Ativação

```typescript
const handleAcceptInvite = async () => {
  // Obtém sessão ativa (criada pelo magic link)
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    // Define a senha do usuário
    await supabase.auth.updateUser({ password: formData.password });

    // Encerra a sessão do magic link (temporária)
    await supabase.auth.signOut();

    // Redireciona para login — usuário faz login com email + senha
    setSuccess(true);
    setTimeout(() => navigate('/'), 2000);
  }
};
```

### Fluxo completo de ativação

```
1. Admin gera magic link → copia e envia para o usuário
2. Usuário clica no link → Supabase autentica
3. Página AcceptInvite renderiza → formulário de senha aparece
4. Usuário define senha → updateUser({ password })
5. signOut() → encerra sessão do magic link
6. Redireciona para tela de login (/)'
7. Usuário faz login com email + senha cadastrada
8. Acessa o sistema normalmente
```

---

## 🔁 Reenvio de Convite

**Arquivo:** `src/components/UserManagement/InviteLink.tsx`

Quando o admin precisa reenviar o link para um usuário que ainda não ativou a conta, o componente chama a API para gerar um **novo magic link real** (não mais um token fake).

```typescript
const generateMagicLink = async (email: string) => {
  setLoadingLink(true);

  const response = await fetch('/api/auth/generate-magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    setLinkError('Não foi possível gerar o link. Tente novamente.');
    return;
  }

  setMagicLink(result.magicLink); // Link real do Supabase
};
```

O modal exibe o link gerado e um botão **"Gerar novo"** para renovar quando o link expirar (1 hora).

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

### Parceiros

**Tabela:** `partner_company_links`

```sql
CREATE TABLE partner_company_links (
  partner_user_id uuid,  -- Usuário com role 'partner' na M4 Digital
  company_id uuid        -- Empresa cliente vinculada
);
```

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
  "user": { "id": "uuid", "email": "usuario@exemplo.com" },
  "inviteLink": "https://etzdsywunlpbgxkphuil.supabase.co/auth/v1/verify?token=...",
  "isExistingUser": false
}
```

> O `inviteLink` é exibido no frontend para o admin copiar e enviar ao usuário.

---

### 2. Generate Magic Link

**Arquivo:** `api/auth/generate-magic-link.ts`  
**Método:** POST

**Body:**
```json
{ "email": "usuario@exemplo.com" }
```

**Response:**
```json
{
  "success": true,
  "magicLink": "https://etzdsywunlpbgxkphuil.supabase.co/auth/v1/verify?token=...",
  "expiresIn": 3600
}
```

**Uso:** Reenvio de convite (componente `InviteLink.tsx`).

---

### 3. Confirm User

**Arquivo:** `api/auth/confirm-user.ts`  
**Método:** POST

**Body:**
```json
{ "email": "usuario@exemplo.com" }
```

**Response:**
```json
{
  "success": true,
  "message": "Usuário confirmado. Pode usar 'Esqueci minha senha'."
}
```

**Uso:** Fallback quando não é possível gerar magic link.

---

## 💻 Frontend

### AcceptInvite

**Arquivo:** `src/pages/AcceptInvite.tsx`

- Header: fundo branco com logo oficial (`/images/emails/logo_fundo_branco-300x128.png`)
- Formulário: nova senha + confirmação (mínimo 8 caracteres, maiúscula, minúscula, número)
- Exibe email, role e empresa do convite (via `user_metadata`)
- Tela de sucesso: _"Sua senha foi definida. Você será redirecionado para a tela de login."_

### UserModal

**Arquivo:** `src/components/UserManagement/UserModal.tsx`

Após criação bem-sucedida, exibe o magic link gerado no modal `InviteSuccess`:
- Se `_inviteLink` presente: exibe o link para cópia manual
- Se `_inviteLink` ausente: exibe mensagem de erro

### InviteLink

**Arquivo:** `src/components/UserManagement/InviteLink.tsx`

- Gera magic link real via API ao abrir o modal
- Exibe link para cópia
- Botão "Gerar novo" para renovar link expirado
- Estados: loading, erro, link disponível

---

## 🔒 Segurança e RLS

### Service Role Key

- Variável: `SUPABASE_SERVICE_ROLE_KEY`
- Onde: Vercel Environment Variables
- Uso: apenas server-side (API routes)
- **NUNCA** exposta ao frontend

---

### Funções SECURITY DEFINER

Funções auxiliares que rodam como superuser do banco, **ignorando RLS**.  
Usadas dentro de policies para evitar **recursão infinita** (policy consultando a própria tabela que está protegendo).

```sql
-- Verifica se auth.uid() é admin ou super_admin ativo na empresa
CREATE OR REPLACE FUNCTION auth_user_is_company_admin(p_company_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND role IN ('admin', 'super_admin')
    AND is_active = true
  );
$$;

-- Verifica se auth.uid() é qualquer membro ativo da empresa
CREATE OR REPLACE FUNCTION auth_user_is_company_member(p_company_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND is_active = true
  );
$$;
```

> **Por que SECURITY DEFINER?** Policies com subquery na mesma tabela causam loop infinito no RLS do PostgreSQL. A função roda como postgres (superuser) e não aciona policies ao consultar `company_users`.

---

### Políticas RLS — `companies`

| Policy | Operação | Quem acessa |
|---|---|---|
| `companies_super_admin_full_access` | ALL | Dono da empresa (`user_id = auth.uid()`) |
| `companies_support_access` | ALL | Roles super_admin e support |
| `companies_partner_linked_access` | ALL | Parceiros vinculados |
| `companies_member_select_access` | SELECT | **Membros ativos via `company_users`** ✅ |

```sql
CREATE POLICY "companies_member_select_access"
ON companies FOR SELECT
USING (
  current_setting('role') = 'service_role'
  OR id IN (
    SELECT company_id FROM company_users
    WHERE user_id = auth.uid() AND is_active = true
  )
);
```

---

### Políticas RLS — `company_users`

| Policy | Operação | Quem acessa |
|---|---|---|
| `company_users_select_own` | SELECT | Própria linha (`user_id = auth.uid()`) |
| `company_users_admin_select` | SELECT | **Admin/super_admin da empresa** ✅ |
| `company_users_update_own` | UPDATE | Própria linha |
| `company_users_admin_update` | UPDATE | **Admin/super_admin da empresa** ✅ |
| `company_users_insert_auth` | INSERT | Qualquer autenticado |
| `company_users_delete_service` | DELETE | Apenas service_role |

```sql
-- SELECT para admins (usa função SECURITY DEFINER — sem recursão)
CREATE POLICY "company_users_admin_select"
ON company_users FOR SELECT
USING (
  current_setting('role') = 'service_role'
  OR user_id = auth.uid()
  OR auth_user_is_company_admin(company_id)
);

-- UPDATE para admins
CREATE POLICY "company_users_admin_update"
ON company_users FOR UPDATE
USING (
  current_setting('role') = 'service_role'
  OR user_id = auth.uid()
  OR auth_user_is_company_admin(company_id)
)
WITH CHECK (
  current_setting('role') = 'service_role'
  OR user_id = auth.uid()
  OR auth_user_is_company_admin(company_id)
);
```

---

### Políticas RLS — Funil de Vendas

| Tabela | Policy adicionada | Efeito |
|---|---|---|
| `sales_funnels` | `sales_funnels_member_select` | Membros veem funis da empresa |
| `funnel_stages` | `funnel_stages_member_select` | Membros veem etapas dos funis |
| `opportunity_funnel_positions` | `opportunity_funnel_positions_member_select` | Membros veem posições das oportunidades |

```sql
CREATE POLICY "sales_funnels_member_select"
ON sales_funnels FOR SELECT
USING (
  current_setting('role') = 'service_role'
  OR company_id IN (SELECT id FROM companies WHERE user_id = auth.uid())
  OR auth_user_is_company_member(company_id)
);

CREATE POLICY "funnel_stages_member_select"
ON funnel_stages FOR SELECT
USING (
  funnel_id IN (
    SELECT sf.id FROM sales_funnels sf
    WHERE sf.company_id IN (SELECT id FROM companies WHERE user_id = auth.uid())
    OR auth_user_is_company_member(sf.company_id)
  )
);

CREATE POLICY "opportunity_funnel_positions_member_select"
ON opportunity_funnel_positions FOR SELECT
USING (
  funnel_id IN (
    SELECT sf.id FROM sales_funnels sf
    WHERE sf.company_id IN (SELECT id FROM companies WHERE user_id = auth.uid())
    OR auth_user_is_company_member(sf.company_id)
  )
);
```

---

### Políticas RLS — WhatsApp / Chat

| Tabela | Policy adicionada | Efeito |
|---|---|---|
| `whatsapp_life_instances` | `whatsapp_instances_member_select` | Membros veem instâncias da empresa |

```sql
CREATE POLICY "whatsapp_instances_member_select"
ON whatsapp_life_instances FOR SELECT
USING (
  current_setting('role') = 'service_role'
  OR company_id IN (SELECT id FROM companies WHERE user_id = auth.uid())
  OR auth_user_is_company_member(company_id)
);
```

> `chat_conversations` e `chat_messages` já possuíam policies com padrão UNION que inclui membros via `company_users` — não necessitaram alteração.

---

## 💬 RPC Chat

### `chat_get_conversations`

A validação de acesso foi atualizada para aceitar **membros da empresa**, não apenas o dono:

```sql
-- Antes (apenas dono)
IF NOT EXISTS (
  SELECT 1 FROM companies WHERE id = p_company_id AND user_id = p_user_id
) THEN
  RETURN 'Acesso negado';
END IF;

-- Depois (dono OU membro ativo)
IF NOT EXISTS (
  SELECT 1 FROM companies WHERE id = p_company_id AND user_id = p_user_id
  UNION
  SELECT 1 FROM company_users
  WHERE company_id = p_company_id AND user_id = p_user_id AND is_active = true
) THEN
  RETURN 'Acesso negado';
END IF;
```

> O restante da função (busca, filtros, paginação) permanece idêntico.

---

## 🐛 Troubleshooting

### Magic link redireciona para dashboard sem mostrar ativação

**Causa:** `/accept-invite` estava dentro de `PublicRoute`. Quando o magic link autentica o usuário, o `PublicRoute` detecta sessão ativa e redireciona para `/dashboard`.

**Solução:** A rota deve ser **aberta** em `App.tsx`:
```tsx
// ✅ Correto
<Route path="/accept-invite" element={<AcceptInvite />} />
```

---

### Conversas do chat aparecem vazias para membros

**Causa:** RPC `chat_get_conversations` validava acesso apenas para o dono da empresa (`companies.user_id = p_user_id`).

**Solução:** Atualizar a RPC para aceitar membros via `company_users` (já aplicado).

---

### Funil de vendas vazio para membros

**Causa:** Policies de `sales_funnels`, `funnel_stages` e `opportunity_funnel_positions` usavam apenas `companies.user_id = auth.uid()` (owner-only).

**Solução:** Policies `_member_select` adicionadas com `auth_user_is_company_member` (já aplicadas).

---

### Erro 406 ao carregar dados da empresa para membros

**Causa:** Policy `companies` usava apenas `user_id = auth.uid()` — membros não eram donos.

**Solução:** Policy `companies_member_select_access` adicionada (já aplicada).

---

### Erro 406 ao editar perfil de usuário (admin editando outro usuário)

**Causa:** Policies de `company_users` só permitiam `user_id = auth.uid()` — admin não podia ler/editar linha de outro usuário.

**Solução:** Policies `company_users_admin_select` e `company_users_admin_update` com `SECURITY DEFINER` (já aplicadas).

---

### Loop infinito / sistema quebrado ao adicionar policies em `company_users`

**Causa:** Policy com subquery na própria tabela (`company_users` verificando `company_users`) causa recursão infinita no RLS do PostgreSQL.

**Solução:** Usar função `SECURITY DEFINER` como intermediária — ela roda como superuser e não aciona policies ao consultar a tabela.

---

### Email de convite não chega

O sistema atual **não depende de email**. O magic link é gerado no backend e exibido diretamente ao admin para envio manual (WhatsApp, Telegram, etc.).

Se necessário usar o fallback de confirmação manual:
1. Acesse o painel do admin
2. Clique em "Confirmar manualmente" no usuário
3. Usuário acessa a tela de login e usa "Esqueci minha senha"

---

### Erro 403 ao criar usuário

**Causa:** `SUPABASE_SERVICE_ROLE_KEY` não configurada no Vercel.

**Solução:**
```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

---

### Constraint violation ao criar usuário

**Erro:**
```
ERROR: new row violates check constraint "valid_role_for_company_type"
```

**Causa:** Role incompatível com tipo de empresa (ex: `seller` em empresa `parent`).

**Solução:**
```typescript
const parentRoles = ['super_admin', 'admin', 'partner'];
const clientRoles = ['admin', 'manager', 'seller'];

if (companyType === 'parent') return parentRoles.includes(role);
return clientRoles.includes(role);
```

---

## 📊 Histórico de Alterações

### v3.0 — 31/03/2026

**Arquivos modificados:**
- `api/auth/invite-user.ts` — substituído `inviteUserByEmail` por `createUser` + `generateLink`
- `src/pages/AcceptInvite.tsx` — `onAuthStateChange`, `signOut()` após ativação, logo branco
- `src/components/UserManagement/UserModal.tsx` — exibe magic link, removido fallback fake
- `src/components/UserManagement/InviteLink.tsx` — chama API real para gerar magic link
- `src/components/UserManagement/InviteSuccess.tsx` — exibe link gerado ao admin
- `src/services/authAdmin.ts` — propagação do `inviteLink` na resposta
- `src/services/userApi.ts` — repassa `_inviteLink` ao frontend
- `src/App.tsx` — `/accept-invite` removida do `PublicRoute`

**Migrations aplicadas (Supabase):**
- `companies_member_select_access`
- `company_users_admin_access_safe` (inclui funções SECURITY DEFINER)
- `member_select_access_sales_funnel_whatsapp`
- `fix_chat_rpc_and_funnel_positions_member_access`

---

## 📚 Referências

**Migrations:**
- `20251129072600_create_company_users_system.sql` — Sistema de usuários

**Documentação relacionada:**
- `legacy_docs/SISTEMA_GESTAO_USUARIOS.md` — Fotos de perfil
- `legacy_docs/DOCUMENTACAO_IMPLEMENTACAO_RLS_CHAT.md` — RLS com company_users

**Supabase:**
- [Admin API — createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Admin API — generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

---

**Versão:** 3.0  
**Status:** ✅ Produção  
**Última atualização:** 31/03/2026
