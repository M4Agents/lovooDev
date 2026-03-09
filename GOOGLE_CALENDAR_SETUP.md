# 🔧 Configuração Google Calendar Integration

## 📋 Pré-requisitos

- Conta Google (Gmail)
- Acesso ao Google Cloud Console
- Projeto Vercel configurado

---

## 🚀 Passo 1: Criar Projeto no Google Cloud Console

1. Acesse [Google Cloud Console](https://console.cloud.google.com)
2. Clique em **"Select a project"** > **"New Project"**
3. Nome do projeto: `Lovoo CRM Calendar`
4. Clique em **"Create"**

---

## 🔌 Passo 2: Ativar Google Calendar API

1. No menu lateral, vá em **"APIs & Services"** > **"Library"**
2. Busque por: `Google Calendar API`
3. Clique em **"Google Calendar API"**
4. Clique em **"Enable"**

---

## 🔑 Passo 3: Criar Credenciais OAuth 2.0

### 3.1 - Configurar OAuth Consent Screen

1. Vá em **"APIs & Services"** > **"OAuth consent screen"**
2. Selecione **"External"** (para permitir qualquer usuário Google)
3. Clique em **"Create"**

**Informações do App:**
- App name: `Lovoo CRM`
- User support email: `seu-email@gmail.com`
- Developer contact: `seu-email@gmail.com`

**Scopes:**
- Clique em **"Add or Remove Scopes"**
- Adicione:
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar.readonly`
  - `https://www.googleapis.com/auth/userinfo.email`
- Clique em **"Update"**

**Test Users (opcional para desenvolvimento):**
- Adicione emails de teste se necessário

Clique em **"Save and Continue"** até finalizar.

### 3.2 - Criar OAuth Client ID

1. Vá em **"APIs & Services"** > **"Credentials"**
2. Clique em **"+ Create Credentials"** > **"OAuth client ID"**
3. Application type: **"Web application"**
4. Name: `Lovoo CRM Web Client`

**Authorized JavaScript origins:**
```
https://app.lovoocrm.com
https://lovoo-dev.vercel.app
```

**Authorized redirect URIs:**
```
https://app.lovoocrm.com/api/google-calendar/auth/callback
https://lovoo-dev.vercel.app/api/google-calendar/auth/callback
```

**IMPORTANTE:** Configure AMBAS as URLs (PROD e DEV) para usar as mesmas credenciais em ambos os ambientes.

5. Clique em **"Create"**
6. **COPIE** o `Client ID` e `Client Secret` (você precisará deles!)

---

## 🔐 Passo 4: Configurar Variáveis de Ambiente no Vercel

### PROD - app.lovoocrm.com (PRINCIPAL) ⭐

1. Acesse [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecione o projeto **loovocrm** (produção)
3. Vá em **"Settings"** > **"Environment Variables"**
4. Adicione as seguintes variáveis:

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_REDIRECT_URI=https://app.lovoocrm.com/api/google-calendar/auth/callback
GOOGLE_WEBHOOK_URL=https://app.lovoocrm.com/api/google-calendar/webhook
```

5. Clique em **"Save"**
6. **Redeploy** o projeto para aplicar as variáveis

### DEV - lovoo-dev.vercel.app (Desenvolvimento)

Repita o processo acima para o projeto **lovooDev**, alterando as URLs:

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_REDIRECT_URI=https://lovoo-dev.vercel.app/api/google-calendar/auth/callback
GOOGLE_WEBHOOK_URL=https://lovoo-dev.vercel.app/api/google-calendar/webhook
```

**NOTA:** Use as MESMAS credenciais (Client ID e Secret) em ambos os ambientes.

---

## ✅ Passo 5: Testar Integração

### PROD (Recomendado) ⭐
1. Acesse o sistema: `https://app.lovoocrm.com`
2. Faça login
3. Vá para **Calendário**
4. Clique no ícone de **Configurações** (engrenagem)
5. Clique em **"Agendas Compartilhadas"**
6. Na seção **"Integrações"**, clique em **"Conectar Google Calendar"**
7. Autorize o acesso na tela do Google
8. Você será redirecionado de volta ao calendário
9. Verifique se aparece **"Conectado"** com seu email

### DEV (Opcional - para testes)
Repita os mesmos passos acima em: `https://lovoo-dev.vercel.app`

---

## 🔄 Funcionalidades Implementadas (FASE 1)

✅ **Autenticação OAuth2**
- Conectar conta Google
- Desconectar conta Google
- Armazenamento seguro de tokens

✅ **UI de Configurações**
- Status da conexão
- Email conectado
- Toggle sincronização automática
- Botão sincronizar agora
- Botão desconectar

✅ **Banco de Dados**
- Tabela `google_calendar_connections`
- Tabela `activity_google_mapping`
- Tabela `google_calendar_sync_log`
- RLS habilitado

---

## 📝 Próximas Fases

**FASE 2: Sincronização Sistema → Google**
- Criar evento no sistema → sincroniza para Google
- Editar evento no sistema → atualiza no Google
- Deletar evento no sistema → remove do Google

**FASE 3: Webhooks Google → Sistema**
- Configurar push notifications
- Receber eventos do Google em tempo real
- Criar/atualizar/deletar eventos no sistema

**FASE 4: Sincronização Completa**
- Sincronização bidirecional automática
- Resolução de conflitos
- Histórico de sincronização

---

## 🐛 Troubleshooting

### Erro: "redirect_uri_mismatch"
- Verifique se a URL de redirect está EXATAMENTE igual no Google Cloud Console e no `.env`
- Certifique-se de usar HTTPS (não HTTP)

### Erro: "access_denied"
- Usuário cancelou a autorização
- Tente conectar novamente

### Erro: "invalid_client"
- `GOOGLE_CLIENT_ID` ou `GOOGLE_CLIENT_SECRET` incorretos
- Verifique as variáveis de ambiente no Vercel

### Conexão não aparece
- Verifique se o deploy foi feito após adicionar as variáveis
- Verifique os logs do Vercel para erros
- Confirme que as tabelas foram criadas no Supabase

---

## 📞 Suporte

Em caso de dúvidas, verifique:
- Logs do Vercel: `https://vercel.com/[seu-projeto]/logs`
- Logs do Supabase: Dashboard > Logs
- Console do navegador (F12)

---

**Documentação criada em:** 09/03/2026  
**Versão:** 1.0 (FASE 1 - Autenticação OAuth2)
