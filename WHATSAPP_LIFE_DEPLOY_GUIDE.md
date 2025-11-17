# 🚀 **GUIA DE DEPLOY SEGURO - WHATSAPP LIFE**

## ⚠️ **IMPORTANTE: DEPLOY ISOLADO E SEGURO**

Este guia garante que o deploy do WhatsApp Life **NÃO AFETE** o sistema existente.

---

## 📋 **PRÉ-REQUISITOS**

### **✅ VERIFICAÇÕES DE SEGURANÇA**
- [ ] Sistema atual funcionando normalmente
- [ ] Backup do banco de dados realizado
- [ ] Acesso ao Supabase Dashboard
- [ ] Acesso ao Vercel Dashboard
- [ ] Credenciais Uazapi disponíveis

---

## 🗄️ **ETAPA 1: APLICAR MIGRATION (ISOLADA)**

### **1.1 Acessar Supabase Dashboard**
```
1. Ir para: https://supabase.com/dashboard/project/etzdsywunlpbgxkphuil
2. Navegar para: SQL Editor
3. Criar nova query
```

### **1.2 Executar Migration Isolada**
```sql
-- Copiar todo o conteúdo de:
-- supabase/migrations/20241117_create_whatsapp_life_tables.sql

-- ✅ SEGURO: Apenas cria tabelas e funções novas
-- ❌ NÃO modifica nada existente
```

### **1.3 Verificar Criação**
```sql
-- Verificar se tabela foi criada
SELECT * FROM whatsapp_life_instances LIMIT 1;

-- Verificar se RPC functions foram criadas
SELECT proname FROM pg_proc WHERE proname LIKE '%whatsapp_life%';
```

---

## 🔧 **ETAPA 2: CONFIGURAR VARIÁVEIS DE AMBIENTE**

### **2.1 No Supabase (Edge Functions)**
```
1. Ir para: Project Settings > Edge Functions
2. Adicionar variáveis:
   - UAZAPI_BASE_URL: https://lovoo.uazapi.com
   - UAZAPI_ADMIN_TOKEN: Qz8m6fc3Gcfc0jKAdZbCPaHRYa2nCGpOapTNJT5J4C2km6GdQB
```

### **2.2 No Vercel (Frontend)**
```
1. Ir para: https://vercel.com/dashboard
2. Projeto: lovooDev
3. Settings > Environment Variables
4. Adicionar (se não existir):
   - UAZAPI_BASE_URL: https://lovoo.uazapi.com
   - UAZAPI_ADMIN_TOKEN: Qz8m6fc3Gcfc0jKAdZbCPaHRYa2nCGpOapTNJT5J4C2km6GdQB
```

---

## 🚀 **ETAPA 3: DEPLOY DAS EDGE FUNCTIONS**

### **3.1 Instalar Supabase CLI (se necessário)**
```bash
npm install -g supabase
```

### **3.2 Login no Supabase**
```bash
supabase login
```

### **3.3 Deploy das Functions**
```bash
# Deploy apenas das functions WhatsApp Life
supabase functions deploy whatsapp-life-create-instance --project-ref etzdsywunlpbgxkphuil
supabase functions deploy whatsapp-life-get-qrcode --project-ref etzdsywunlpbgxkphuil
```

---

## 🌐 **ETAPA 4: DEPLOY DO FRONTEND (AUTOMÁTICO)**

### **4.1 Verificar Deploy Automático**
```
1. Push já foi feito para: https://github.com/M4Agents/lovooDev.git
2. Vercel fará deploy automático
3. Aguardar conclusão do build
```

### **4.2 Verificar Build**
```
1. Acessar: https://vercel.com/dashboard
2. Verificar se build foi bem-sucedido
3. Testar se site carrega normalmente
```

---

## 🧪 **ETAPA 5: TESTES DE SEGURANÇA**

### **5.1 Verificar Sistema Existente**
```
✅ Testar login normal
✅ Testar dashboard existente
✅ Testar funcionalidades de leads
✅ Verificar se nada foi quebrado
```

### **5.2 Testar WhatsApp Life (Isolado)**
```
✅ Acessar: /settings/whatsapp-life
✅ Verificar se página carrega
✅ Testar limites de plano
✅ Verificar se não há erros no console
```

---

## 🔍 **ETAPA 6: VALIDAÇÃO FINAL**

### **6.1 Checklist de Funcionamento**
- [ ] Sistema existente 100% funcional
- [ ] Página WhatsApp Life carrega sem erros
- [ ] RPC functions respondem corretamente
- [ ] Edge Functions deployadas com sucesso
- [ ] Variáveis de ambiente configuradas
- [ ] Sem erros no console do browser

### **6.2 Teste de Criação de Instância**
```javascript
// Testar no console do browser:
// (Apenas se todos os passos anteriores funcionaram)

// 1. Ir para /settings/whatsapp-life
// 2. Abrir console do browser
// 3. Executar:
console.log('WhatsApp Life carregado com sucesso!');
```

---

## 🚨 **ROLLBACK DE EMERGÊNCIA (SE NECESSÁRIO)**

### **Se algo der errado:**

#### **1. Rollback do Banco (SEGURO)**
```sql
-- Remover apenas tabelas WhatsApp Life (não afeta sistema)
DROP TABLE IF EXISTS whatsapp_life_instances CASCADE;
DROP FUNCTION IF EXISTS check_whatsapp_life_plan_limit(UUID);
DROP FUNCTION IF EXISTS create_whatsapp_life_instance(UUID, TEXT);
DROP FUNCTION IF EXISTS create_whatsapp_life_instance_rpc(UUID, TEXT);
DROP FUNCTION IF EXISTS get_whatsapp_life_qrcode_rpc(UUID);
DROP FUNCTION IF EXISTS update_whatsapp_life_instance_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_whatsapp_life_instance(UUID);
```

#### **2. Rollback do Frontend**
```bash
# Reverter para commit anterior
git revert HEAD
git push origin main
```

#### **3. Remover Edge Functions**
```bash
supabase functions delete whatsapp-life-create-instance --project-ref etzdsywunlpbgxkphuil
supabase functions delete whatsapp-life-get-qrcode --project-ref etzdsywunlpbgxkphuil
```

---

## ✅ **GARANTIAS DE SEGURANÇA**

### **🛡️ O QUE ESTÁ PROTEGIDO:**
- ✅ Sistema de leads existente
- ✅ Todas as páginas atuais
- ✅ Banco de dados existente
- ✅ Configurações de produção
- ✅ Usuários e autenticação
- ✅ Todas as funcionalidades atuais

### **🆕 O QUE FOI ADICIONADO:**
- ✅ Tabela `whatsapp_life_instances` (isolada)
- ✅ RPC Functions com prefixo `whatsapp_life_`
- ✅ Edge Functions isoladas
- ✅ Componentes React isolados
- ✅ Página `/settings/whatsapp-life` (nova)
- ✅ Hooks personalizados isolados

---

## 📞 **SUPORTE**

### **Em caso de dúvidas ou problemas:**
1. **Verificar logs** do Vercel e Supabase
2. **Testar rollback** se necessário
3. **Documentar** qualquer erro encontrado
4. **Manter sistema principal** sempre funcionando

**LEMBRE-SE: A prioridade é manter o sistema existente 100% funcional!**
