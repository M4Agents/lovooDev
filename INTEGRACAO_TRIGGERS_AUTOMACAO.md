# 🎯 INTEGRAÇÃO DE TRIGGERS AUTOMÁTICOS - FASE 5.5

## 📋 VISÃO GERAL

Este documento explica como integrar os triggers automáticos para que os fluxos de automação sejam disparados automaticamente quando eventos ocorrem no sistema.

---

## 🔧 TRIGGERS IMPLEMENTADOS

O `TriggerManager` já está preparado para os seguintes eventos:

### 1. **Novo Lead Criado** (`lead.created`)
Dispara quando um novo lead é criado no sistema.

### 2. **Mensagem Recebida** (`message.received`)
Dispara quando uma mensagem WhatsApp é recebida.

### 3. **Oportunidade Criada** (`opportunity.created`)
Dispara quando uma nova oportunidade é criada no funil.

### 4. **Mudança de Etapa** (`opportunity.stage_changed`)
Dispara quando uma oportunidade muda de etapa no funil.

### 5. **Tag Adicionada** (`tag.added`)
Dispara quando uma tag é adicionada a um lead.

---

## 🚀 COMO INTEGRAR

### **1. Integração no Webhook WhatsApp**

**Arquivo:** `src/pages/api/uazapi-webhook-final.js`

Adicionar após salvar mensagem no banco:

```javascript
// Importar TriggerManager
const { triggerManager } = require('../../services/automation/TriggerManager')

// Após salvar mensagem, disparar trigger
if (message.fromMe === false) {
  // Buscar leadId do contato
  const { data: contact } = await supabase
    .from('chat_contacts')
    .select('lead_id')
    .eq('conversation_id', conversationId)
    .single()

  if (contact && contact.lead_id) {
    // Disparar trigger de mensagem recebida
    await triggerManager.onMessageReceived(
      companyId,
      contact.lead_id,
      {
        text: message.text,
        from: message.from,
        timestamp: message.timestamp
      }
    )
  }
}
```

---

### **2. Integração na Criação de Leads**

**Arquivo:** Onde leads são criados (ex: `src/pages/api/leads/create.ts`)

Adicionar após criar lead:

```typescript
import { triggerManager } from '../../services/automation/TriggerManager'

// Após criar lead
const { data: newLead } = await supabase
  .from('leads')
  .insert(leadData)
  .select()
  .single()

// Disparar trigger
await triggerManager.onLeadCreated(
  companyId,
  newLead.id,
  newLead
)
```

---

### **3. Integração na Criação de Oportunidades**

**Arquivo:** Onde oportunidades são criadas

```typescript
import { triggerManager } from '../../services/automation/TriggerManager'

// Após criar oportunidade
const { data: opportunity } = await supabase
  .from('opportunities')
  .insert(opportunityData)
  .select()
  .single()

// Disparar trigger
await triggerManager.onOpportunityCreated(
  companyId,
  opportunity.id,
  opportunity
)
```

---

### **4. Integração na Mudança de Etapa**

**Arquivo:** Onde oportunidades são atualizadas

```typescript
import { triggerManager } from '../../services/automation/TriggerManager'

// Antes de atualizar, buscar etapa atual
const { data: currentOpp } = await supabase
  .from('opportunities')
  .select('stage_id')
  .eq('id', opportunityId)
  .single()

const oldStageId = currentOpp.stage_id

// Atualizar oportunidade
const { data: updatedOpp } = await supabase
  .from('opportunities')
  .update({ stage_id: newStageId })
  .eq('id', opportunityId)
  .select()
  .single()

// Se mudou de etapa, disparar trigger
if (oldStageId !== newStageId) {
  await triggerManager.onOpportunityStageChanged(
    companyId,
    opportunityId,
    oldStageId,
    newStageId,
    updatedOpp
  )
}
```

---

### **5. Integração ao Adicionar Tags**

**Arquivo:** Onde tags são adicionadas

```typescript
import { triggerManager } from '../../services/automation/TriggerManager'

// Após adicionar tag
await supabase
  .from('lead_tags')
  .insert({ lead_id: leadId, tag_id: tagId })

// Buscar nome da tag
const { data: tag } = await supabase
  .from('tags')
  .select('name')
  .eq('id', tagId)
  .single()

// Disparar trigger
await triggerManager.onTagAdded(
  companyId,
  leadId,
  tagId,
  tag.name
)
```

---

## ⚙️ CONFIGURAÇÃO DO CRON JOB

Para processar delays agendados, configurar cron job:

### **Vercel Cron (vercel.json)**

```json
{
  "crons": [
    {
      "path": "/api/automation/process-schedules",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Isso executará a cada 5 minutos.

### **Alternativa: Cron Manual**

Criar script que chama a API:

```bash
#!/bin/bash
# cron-automation.sh

curl -X POST https://seu-dominio.com/api/automation/process-schedules
```

Adicionar ao crontab:

```bash
*/5 * * * * /path/to/cron-automation.sh
```

---

## 🔒 SEGURANÇA

### **Autenticação da API de Cron**

Adicionar autenticação na API `process-schedules.ts`:

```typescript
// Verificar token de autenticação
const authToken = req.headers.authorization

if (authToken !== `Bearer ${process.env.CRON_SECRET}`) {
  return res.status(401).json({ error: 'Unauthorized' })
}
```

Configurar `CRON_SECRET` nas variáveis de ambiente.

---

## 📊 MONITORAMENTO

### **Logs de Execução**

Todos os logs são salvos em `automation_logs`:

```sql
SELECT 
  al.*,
  af.name as flow_name
FROM automation_logs al
JOIN automation_flows af ON al.flow_id = af.id
WHERE al.company_id = 'xxx'
ORDER BY al.executed_at DESC
LIMIT 100;
```

### **Execuções Ativas**

```sql
SELECT 
  ae.*,
  af.name as flow_name
FROM automation_executions ae
JOIN automation_flows af ON ae.flow_id = af.id
WHERE ae.status = 'running'
AND ae.company_id = 'xxx';
```

### **Schedules Pendentes**

```sql
SELECT *
FROM automation_schedules
WHERE status = 'pending'
AND resume_at <= NOW()
ORDER BY resume_at ASC;
```

---

## 🧪 TESTES

### **Testar Trigger Manualmente**

```typescript
import { triggerManager } from './services/automation/TriggerManager'

// Disparar trigger de teste
await triggerManager.onLeadCreated(
  'company-id-aqui',
  123, // leadId
  {
    name: 'Lead Teste',
    email: 'teste@example.com',
    phone: '5511999999999'
  }
)
```

### **Testar Execução Manual**

```bash
curl -X POST http://localhost:3000/api/automation/execute \
  -H "Content-Type: application/json" \
  -d '{
    "flowId": "flow-id-aqui",
    "companyId": "company-id-aqui",
    "triggerData": {
      "lead_id": 123,
      "lead": {
        "name": "Teste"
      }
    }
  }'
```

---

## ⚠️ IMPORTANTE

### **Não Quebra Sistema Existente**

- ✅ Todas as integrações são **opcionais**
- ✅ Se não integrar, sistema continua funcionando normalmente
- ✅ Triggers só disparam se houver fluxos ativos
- ✅ Erros em automação não afetam operação principal

### **Performance**

- Triggers são executados de forma **assíncrona**
- Não bloqueiam a operação principal
- Logs detalhados para debug
- Isolamento por `company_id`

### **Rollback**

Se precisar desativar temporariamente:

```sql
-- Desativar todos os fluxos
UPDATE automation_flows 
SET is_active = false 
WHERE company_id = 'xxx';
```

---

## 📝 CHECKLIST DE INTEGRAÇÃO

- [ ] Integrar trigger no webhook WhatsApp
- [ ] Integrar trigger na criação de leads
- [ ] Integrar trigger na criação de oportunidades
- [ ] Integrar trigger na mudança de etapa
- [ ] Integrar trigger ao adicionar tags
- [ ] Configurar cron job para processar schedules
- [ ] Adicionar autenticação no cron
- [ ] Testar cada trigger
- [ ] Monitorar logs
- [ ] Documentar para equipe

---

## 🎯 PRÓXIMOS PASSOS

1. **Escolher quais triggers integrar primeiro**
2. **Testar em ambiente de desenvolvimento**
3. **Monitorar execuções**
4. **Ajustar configurações conforme necessário**
5. **Expandir para outros eventos**

---

**Sistema pronto para automação completa!** 🚀
