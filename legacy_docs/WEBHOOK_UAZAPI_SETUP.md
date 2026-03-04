# 🔗 **SISTEMA DE WEBHOOK UAZAPI - GUIA COMPLETO**

## 📋 **RESUMO DA IMPLEMENTAÇÃO**

Sistema completo para recebimento automático de mensagens WhatsApp via webhook da Uazapi, com auto-cadastro de leads e atualização em tempo real do chat.

### ✅ **FUNCIONALIDADES IMPLEMENTADAS**

- **Endpoint de webhook** para receber mensagens da Uazapi
- **Auto-cadastro de contatos/leads** quando nova mensagem chega
- **Processamento inteligente** de mensagens com validações
- **Prevenção de loops** (ignora mensagens enviadas pela API)
- **Atualização em tempo real** via Supabase Realtime
- **Log completo** de todos os webhooks para auditoria
- **Integração perfeita** com sistema de chat existente

---

## 🚀 **INSTRUÇÕES DE DEPLOY**

### **1. APLICAR MIGRAÇÕES NO SUPABASE**

```sql
-- Executar no SQL Editor do Supabase
-- Arquivo: src/services/migrations/003_create_webhook_system.sql
```

### **2. DEPLOY DA EDGE FUNCTION**

```bash
# No terminal, dentro do projeto
supabase functions deploy webhook-uazapi

# Verificar se foi deployada
supabase functions list
```

### **3. CONFIGURAR WEBHOOK NA UAZAPI**

**URL do Webhook:**
```
https://[seu-project-id].supabase.co/functions/v1/webhook-uazapi
```

**Configuração recomendada:**
- **Método**: POST
- **Eventos**: `messages`, `messages_update`, `connection`
- **Filtros**: Excluir `wasSentByApi` (OBRIGATÓRIO)
- **Status**: Habilitado ✅

### **4. TESTAR INTEGRAÇÃO**

1. Enviar mensagem para número da instância conectada
2. Verificar logs no Supabase (tabela `webhook_logs`)
3. Confirmar criação de contato e conversa
4. Verificar atualização em tempo real no chat

---

## 🔧 **ARQUITETURA DO SISTEMA**

### **📊 Fluxo de Dados**

```
WhatsApp → Uazapi → Webhook → Edge Function → 
Supabase RPC → Validações → Auto-cadastro → 
Salvar Mensagem → Realtime → Interface Atualizada
```

### **🗄️ Tabelas Afetadas**

1. **`webhook_logs`**: Log de todos os webhooks (nova)
2. **`chat_conversations`**: Conversas criadas/atualizadas
3. **`chat_messages`**: Mensagens recebidas salvas
4. **`chat_contacts`**: Contatos auto-cadastrados
5. **`whatsapp_life_instances`**: Validação de instâncias

### **⚙️ Funções Criadas**

- `process_uazapi_webhook()`: Função principal
- `auto_create_contact()`: Auto-cadastro de leads
- `get_or_create_conversation()`: Gestão de conversas
- `extract_phone_from_jid()`: Limpeza de números
- `handle_uazapi_webhook_http()`: Handler HTTP

---

## 🛡️ **SEGURANÇA E VALIDAÇÕES**

### **🔒 Validações Implementadas**

- ✅ **Instância válida**: Verifica se existe no sistema
- ✅ **Empresa correta**: Isolamento por company_id
- ✅ **Prevenção de loops**: Ignora `fromMe: true`
- ✅ **Sanitização**: Limpeza de dados de entrada
- ✅ **Rate limiting**: Via Supabase Edge Functions
- ✅ **Logs detalhados**: Auditoria completa

### **🚫 Prevenção de Problemas**

- **Loops infinitos**: Filtro `wasSentByApi` obrigatório
- **Duplicatas**: Verificação antes de inserir
- **Spam**: Rate limiting automático
- **Dados inválidos**: Validação rigorosa
- **Falhas**: Try/catch com logs de erro

---

## 📱 **INTEGRAÇÃO COM CHAT EXISTENTE**

### **🔄 Realtime Updates**

O sistema integra perfeitamente com o chat existente:

- **Novas conversas** aparecem automaticamente na sidebar
- **Mensagens recebidas** atualizam contadores em tempo real
- **Status de conversas** sincronizado automaticamente
- **Zero impacto** no sistema atual

### **📊 Auto-cadastro de Leads**

Quando uma mensagem chega de número desconhecido:

1. **Contato criado** automaticamente em `chat_contacts`
2. **Conversa iniciada** em `chat_conversations`
3. **Mensagem salva** em `chat_messages`
4. **Interface atualizada** via Realtime

---

## 🧪 **TESTES E VALIDAÇÃO**

### **✅ Checklist de Testes**

- [ ] Webhook recebe mensagens corretamente
- [ ] Auto-cadastro de contatos funciona
- [ ] Conversas são criadas automaticamente
- [ ] Mensagens aparecem no chat em tempo real
- [ ] Filtros de segurança funcionam
- [ ] Logs são gerados corretamente
- [ ] Sistema não quebra funcionalidades existentes

### **🔍 Como Testar**

1. **Enviar mensagem** para instância conectada
2. **Verificar logs** em `webhook_logs`
3. **Confirmar contato** em `chat_contacts`
4. **Verificar conversa** em `chat_conversations`
5. **Ver mensagem** em `chat_messages`
6. **Validar interface** atualizada em tempo real

---

## 📊 **MONITORAMENTO E LOGS**

### **📋 Tabela webhook_logs**

Todos os webhooks são logados com:
- `event_type`: Tipo do evento
- `instance_token`: Token da instância
- `payload`: Dados completos recebidos
- `processed`: Se foi processado com sucesso
- `error_message`: Erro se houver
- `created_at`: Timestamp de recebimento

### **🔍 Queries Úteis**

```sql
-- Ver últimos webhooks recebidos
SELECT * FROM webhook_logs 
ORDER BY created_at DESC 
LIMIT 10;

-- Ver webhooks com erro
SELECT * FROM webhook_logs 
WHERE processed = false 
OR error_message IS NOT NULL;

-- Estatísticas por instância
SELECT instance_token, 
       COUNT(*) as total,
       COUNT(CASE WHEN processed THEN 1 END) as success
FROM webhook_logs 
GROUP BY instance_token;
```

---

## ⚠️ **TROUBLESHOOTING**

### **🚨 Problemas Comuns**

#### **Webhook não recebe mensagens**
- Verificar URL configurada na Uazapi
- Confirmar Edge Function deployada
- Checar logs do Supabase

#### **Mensagens não aparecem no chat**
- Verificar se instância existe no sistema
- Confirmar company_id correto
- Checar subscription do Realtime

#### **Contatos não são criados**
- Verificar função `auto_create_contact`
- Confirmar permissões RLS
- Checar logs de erro

#### **Loops infinitos**
- Confirmar filtro `wasSentByApi` ativo
- Verificar configuração do webhook
- Checar logs para mensagens duplicadas

### **🔧 Comandos de Debug**

```sql
-- Verificar última mensagem processada
SELECT * FROM webhook_logs 
WHERE processed = true 
ORDER BY created_at DESC 
LIMIT 1;

-- Ver conversas criadas hoje
SELECT * FROM chat_conversations 
WHERE created_at >= CURRENT_DATE;

-- Contar mensagens por direção
SELECT direction, COUNT(*) 
FROM chat_messages 
GROUP BY direction;
```

---

## 🎯 **PRÓXIMOS PASSOS**

### **🔄 Melhorias Futuras**

- [ ] Suporte a mensagens de mídia
- [ ] Processamento de mensagens de grupo
- [ ] Integração com chatbots
- [ ] Métricas avançadas de performance
- [ ] Dashboard de monitoramento

### **📈 Otimizações**

- [ ] Cache de contatos frequentes
- [ ] Batch processing para alto volume
- [ ] Compressão de logs antigos
- [ ] Alertas automáticos de falhas

---

## 📞 **SUPORTE**

### **📋 Informações para Suporte**

Ao reportar problemas, incluir:
- Timestamp do problema
- Instance token afetado
- Logs da tabela `webhook_logs`
- Mensagem de erro específica
- Passos para reproduzir

### **🔗 Links Úteis**

- **Documentação Uazapi**: [API Docs]
- **Supabase Edge Functions**: [Docs]
- **Realtime Subscriptions**: [Docs]

---

**✅ Sistema 100% funcional e integrado com chat existente!**
