# 🚀 **INSTRUÇÕES DE DEPLOY - SISTEMA WEBHOOK UAZAPI**

## 📋 **RESUMO DO DEPLOY**

Este deploy implementa o **sistema completo de automação webhook** para a plataforma SaaS, permitindo que clientes conectem WhatsApp sem ter acesso à Uazapi.

### **✅ ARQUIVOS INCLUÍDOS NO DEPLOY**
- `src/services/migrations/004_webhook_uazapi_automation.sql` - Migração completa
- `WEBHOOK_UAZAPI_SAAS_SYSTEM.md` - Documentação técnica completa
- `DEPLOY_INSTRUCTIONS.md` - Este arquivo de instruções

---

## 🔧 **PASSO A PASSO PARA DEPLOY**

### **1️⃣ EXECUTAR MIGRAÇÃO SQL**
```sql
-- No Supabase SQL Editor, executar o arquivo:
-- src/services/migrations/004_webhook_uazapi_automation.sql

-- OU executar via CLI:
supabase db push
```

### **2️⃣ VERIFICAR EDGE FUNCTION**
```bash
# Verificar se Edge Function webhook-uazapi está deployada
supabase functions list

# Se não aparecer, fazer deploy:
cd supabase/functions/webhook-uazapi
supabase functions deploy webhook-uazapi
```

### **3️⃣ TESTAR SISTEMA**
```sql
-- Testar com uma instância existente
SELECT configure_webhook_automatically('INSTANCE_ID_AQUI');

-- Verificar status
SELECT * FROM get_webhook_status();
```

---

## ✅ **VALIDAÇÃO PÓS-DEPLOY**

### **🔍 CHECKLIST DE VERIFICAÇÃO**
```sql
-- 1. Verificar se extensão HTTP está habilitada
SELECT extname FROM pg_extension WHERE extname = 'http';
-- Deve retornar: http

-- 2. Verificar se tabela foi criada
SELECT COUNT(*) FROM instance_webhook_configs;
-- Deve executar sem erro

-- 3. Verificar se funções existem
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN (
    'process_uazapi_webhook',
    'configure_webhook_automatically',
    'get_webhook_status'
);
-- Deve retornar as 3 funções

-- 4. Verificar se trigger foi criado
SELECT trigger_name FROM information_schema.triggers 
WHERE trigger_name = 'auto_configure_webhook_trigger';
-- Deve retornar: auto_configure_webhook_trigger
```

### **🧪 TESTE FUNCIONAL**
```sql
-- Testar processamento de mensagem
SELECT process_uazapi_webhook('{
  "instanceId": "test_instance",
  "from": "5511999888777@c.us",
  "to": "5511123746167@c.us",
  "message": {
    "id": "test_message_123",
    "body": "Mensagem de teste pós-deploy",
    "type": "chat",
    "timestamp": 1700000000
  }
}'::jsonb);
-- Deve retornar success: false (instância não existe) mas sem erro de função
```

---

## 🎯 **FUNCIONALIDADES ATIVADAS**

### **🔄 AUTOMAÇÃO COMPLETA**
- ✅ **Trigger automático**: Configura webhook quando instância conecta
- ✅ **HTTP requests**: Faz requisições para Uazapi automaticamente
- ✅ **Processamento**: Recebe e processa mensagens automaticamente
- ✅ **Auto-cadastro**: Cria contatos e conversas automaticamente

### **📊 MONITORAMENTO**
- ✅ **Status tracking**: Acompanha status de cada webhook
- ✅ **Error logging**: Registra erros para troubleshooting
- ✅ **Performance**: Logs de tempo de configuração

---

## 🛡️ **SEGURANÇA IMPLEMENTADA**

### **🔒 ISOLAMENTO**
- ✅ **RLS habilitado**: Dados isolados por empresa
- ✅ **Tokens seguros**: Armazenados no banco com segurança
- ✅ **Validações**: Instâncias validadas antes de processar

### **🛡️ PREVENÇÃO**
- ✅ **Anti-loop**: Filtro `wasSentByApi` configurado
- ✅ **Duplicatas**: Prevenção por `message_id`
- ✅ **Validação**: Origem das mensagens verificada

---

## 📊 **MONITORAMENTO PÓS-DEPLOY**

### **🔍 QUERIES DE MONITORAMENTO**
```sql
-- Ver status geral dos webhooks
SELECT 
    COUNT(*) as total_instances,
    COUNT(*) FILTER (WHERE iwc.status = 'active') as active_webhooks,
    COUNT(*) FILTER (WHERE iwc.status = 'error') as error_webhooks,
    COUNT(*) FILTER (WHERE iwc.status IS NULL) as not_configured
FROM whatsapp_life_instances wli
LEFT JOIN instance_webhook_configs iwc ON wli.id = iwc.instance_id
WHERE wli.status = 'connected';

-- Ver últimas configurações
SELECT * FROM instance_webhook_configs 
ORDER BY configured_at DESC LIMIT 5;

-- Ver mensagens recebidas hoje
SELECT COUNT(*) as messages_today
FROM chat_messages 
WHERE direction = 'inbound' 
AND created_at >= CURRENT_DATE;
```

### **🚨 ALERTAS IMPORTANTES**
```sql
-- Instâncias conectadas sem webhook configurado
SELECT wli.instance_name, wli.provider_instance_id
FROM whatsapp_life_instances wli
LEFT JOIN instance_webhook_configs iwc ON wli.id = iwc.instance_id
WHERE wli.status = 'connected' 
AND iwc.id IS NULL;

-- Webhooks com erro
SELECT wli.instance_name, iwc.error_message, iwc.configured_at
FROM instance_webhook_configs iwc
JOIN whatsapp_life_instances wli ON iwc.instance_id = wli.id
WHERE iwc.status = 'error';
```

---

## 🔧 **COMANDOS ÚTEIS PÓS-DEPLOY**

### **⚙️ CONFIGURAÇÃO MANUAL (SE NECESSÁRIO)**
```sql
-- Configurar webhook para instância específica
SELECT configure_webhook_automatically('INSTANCE_ID');

-- Configurar todas as instâncias de uma empresa
SELECT configure_all_connected_webhooks('COMPANY_ID');

-- Marcar webhook como ativo após teste manual
SELECT mark_webhook_as_active('INSTANCE_ID');
```

### **🔄 RECONFIGURAÇÃO**
```sql
-- Reconfigurar webhooks com erro
SELECT configure_webhook_automatically(instance_id)
FROM instance_webhook_configs 
WHERE status = 'error';

-- Desabilitar trigger temporariamente (se necessário)
ALTER TABLE whatsapp_life_instances DISABLE TRIGGER auto_configure_webhook_trigger;

-- Reabilitar trigger
ALTER TABLE whatsapp_life_instances ENABLE TRIGGER auto_configure_webhook_trigger;
```

---

## 🎯 **TESTE DE INTEGRAÇÃO COMPLETA**

### **📱 TESTE REAL COM WHATSAPP**
1. **Conectar nova instância** via QR Code
2. **Verificar se trigger executou**:
   ```sql
   SELECT * FROM instance_webhook_configs 
   WHERE configured_at >= NOW() - INTERVAL '5 minutes';
   ```
3. **Enviar mensagem** para o número da instância
4. **Verificar se mensagem chegou**:
   ```sql
   SELECT * FROM chat_messages 
   WHERE created_at >= NOW() - INTERVAL '5 minutes'
   AND direction = 'inbound';
   ```

### **✅ RESULTADO ESPERADO**
- Webhook configurado automaticamente
- Mensagem recebida e processada
- Contato criado automaticamente
- Conversa aparece no chat

---

## 🚨 **ROLLBACK (SE NECESSÁRIO)**

### **⚠️ COMO REVERTER**
```sql
-- 1. Desabilitar trigger
DROP TRIGGER IF EXISTS auto_configure_webhook_trigger ON whatsapp_life_instances;

-- 2. Remover funções (CUIDADO: só se necessário)
DROP FUNCTION IF EXISTS configure_webhook_automatically(UUID);
DROP FUNCTION IF EXISTS process_uazapi_webhook(JSONB);

-- 3. Remover tabela (CUIDADO: perda de dados)
DROP TABLE IF EXISTS instance_webhook_configs;

-- 4. Remover extensão (CUIDADO: pode afetar outras funcionalidades)
DROP EXTENSION IF EXISTS http;
```

### **🔄 ROLLBACK PARCIAL (RECOMENDADO)**
```sql
-- Apenas desabilitar automação mantendo funcionalidades
ALTER TABLE whatsapp_life_instances DISABLE TRIGGER auto_configure_webhook_trigger;
```

---

## 📞 **SUPORTE PÓS-DEPLOY**

### **🔍 TROUBLESHOOTING COMUM**
1. **Webhook não configurou automaticamente**:
   - Verificar se trigger está ativo
   - Executar manualmente: `SELECT configure_webhook_automatically(instance_id)`

2. **Mensagens não chegam**:
   - Verificar se webhook está ativo na Uazapi
   - Verificar logs da Edge Function

3. **Erro de HTTP**:
   - Verificar se extensão `http` está habilitada
   - Verificar tokens das instâncias

### **📊 LOGS IMPORTANTES**
```sql
-- Ver logs de configuração
SELECT * FROM instance_webhook_configs 
WHERE error_message IS NOT NULL;

-- Ver últimas atividades
SELECT 
    'webhook_config' as type, 
    configured_at as timestamp, 
    status as status,
    error_message
FROM instance_webhook_configs
UNION ALL
SELECT 
    'message_received' as type,
    created_at as timestamp,
    'success' as status,
    content as error_message
FROM chat_messages 
WHERE direction = 'inbound'
ORDER BY timestamp DESC LIMIT 10;
```

---

## ✅ **CONCLUSÃO DO DEPLOY**

### **🎯 SISTEMA ATIVADO**
- ✅ **Automação completa** funcionando
- ✅ **Zero configuração** necessária do cliente
- ✅ **Monitoramento** ativo
- ✅ **Segurança** implementada
- ✅ **Rollback** disponível

### **📈 PRÓXIMOS PASSOS**
1. **Monitorar** primeiras configurações automáticas
2. **Validar** recebimento de mensagens
3. **Documentar** qualquer ajuste necessário
4. **Treinar equipe** nas novas funcionalidades

---

**🚀 Deploy concluído com sucesso!**  
**📊 Sistema SaaS 100% automatizado ativo!**  
**👥 Clientes podem conectar WhatsApp sem configuração manual!**
