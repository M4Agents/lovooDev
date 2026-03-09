# 📅 GOOGLE CALENDAR - FASE 2: SINCRONIZAÇÃO SISTEMA → GOOGLE

**Status:** ✅ Implementado  
**Data:** 09/03/2026  
**Versão:** 1.0.0

---

## 🎯 OBJETIVO

Sincronizar automaticamente atividades do sistema LovoCRM para o Google Calendar do usuário, mantendo os eventos sempre atualizados em ambas as plataformas.

---

## 🏗️ ARQUITETURA IMPLEMENTADA

### **1. Migration - Campos de Rastreamento**
**Arquivo:** `supabase/migrations/20260309140000_add_google_event_id_to_activities.sql`

**Campos adicionados à tabela `lead_activities`:**
- `google_event_id` (VARCHAR) - ID do evento no Google Calendar
- `sync_to_google` (BOOLEAN) - Flag para controlar sincronização (padrão: false)
- `last_synced_at` (TIMESTAMPTZ) - Timestamp da última sincronização

**Segurança:** Campos opcionais, não quebram funcionalidades existentes.

---

### **2. Helper de Conversão**
**Arquivo:** `api/google-calendar/helpers/event-converter.js`

**Funções:**
- `activityToGoogleEvent(activity)` - Converte atividade → evento Google
- `googleEventToActivity(event)` - Converte evento Google → atividade

**Recursos:**
- ✅ Mapeamento de cores por tipo de atividade
- ✅ Descrição rica com informações do lead
- ✅ Metadados privados para rastreamento
- ✅ Suporte a timezone (America/Sao_Paulo)
- ✅ Lembretes configuráveis

**Exemplo de evento gerado:**
```json
{
  "summary": "Reunião com João Silva",
  "description": "📋 INFORMAÇÕES DO LEAD:\nNome: João Silva\nTelefone: (11) 99999-9999",
  "start": {
    "dateTime": "2026-03-09T14:00:00",
    "timeZone": "America/Sao_Paulo"
  },
  "end": {
    "dateTime": "2026-03-09T15:00:00",
    "timeZone": "America/Sao_Paulo"
  },
  "colorId": "10",
  "extendedProperties": {
    "private": {
      "lovoo_activity_id": "uuid",
      "lovoo_lead_id": "123"
    }
  }
}
```

---

### **3. APIs de Sincronização**

#### **API 1: Criar Evento**
**Endpoint:** `POST /api/google-calendar/sync/create-event`

**Payload:**
```json
{
  "activity_id": "uuid"
}
```

**Fluxo:**
1. Busca atividade no banco
2. Verifica se já está sincronizada
3. Busca conexão Google Calendar do usuário
4. Converte atividade para evento Google
5. Cria evento no Google Calendar
6. Salva `google_event_id` na atividade

**Response:**
```json
{
  "success": true,
  "google_event_id": "abc123xyz"
}
```

---

#### **API 2: Atualizar Evento**
**Endpoint:** `POST /api/google-calendar/sync/update-event`

**Payload:**
```json
{
  "activity_id": "uuid"
}
```

**Fluxo:**
1. Busca atividade no banco
2. Verifica se tem `google_event_id`
3. Busca conexão Google Calendar do usuário
4. Atualiza evento no Google Calendar
5. Atualiza `last_synced_at`

---

#### **API 3: Deletar Evento**
**Endpoint:** `POST /api/google-calendar/sync/delete-event`

**Payload:**
```json
{
  "activity_id": "uuid"
}
```

**Fluxo:**
1. Busca atividade no banco
2. Verifica se tem `google_event_id`
3. Busca conexão Google Calendar do usuário
4. Deleta evento no Google Calendar
5. Limpa `google_event_id` e `sync_to_google`

---

## 🔒 SEGURANÇA E COMPATIBILIDADE

### **Garantias:**
- ✅ Sistema existente **não foi modificado**
- ✅ Atividades podem ser criadas **sem sincronizar**
- ✅ Sincronização é **opcional** (flag `sync_to_google`)
- ✅ Falha na sincronização **não quebra** criação de atividade
- ✅ Isolamento por `company_id` mantido
- ✅ RLS (Row Level Security) preservado

### **Validações:**
- ✅ Verifica se usuário tem Google Calendar conectado
- ✅ Verifica se atividade já está sincronizada
- ✅ Usa tokens OAuth2 do usuário específico
- ✅ Trata erros de API do Google gracefully

---

## 📊 MAPEAMENTO DE CORES

| Tipo de Atividade | Cor Google Calendar |
|-------------------|---------------------|
| 📞 Ligação        | Azul (#4285F4)      |
| 🤝 Reunião        | Verde (#0F9D58)     |
| 📧 Email          | Laranja (#F4B400)   |
| ✅ Tarefa         | Vermelho (#DB4437)  |
| 🔄 Follow-up      | Amarelo (#F4B400)   |
| 🎯 Demonstração   | Roxo (#AB47BC)      |
| 📌 Outro          | Cinza (#616161)     |

---

## 🧪 COMO TESTAR

### **1. Testar Criação de Evento**
```bash
curl -X POST https://app.lovoocrm.com/api/google-calendar/sync/create-event \
  -H "Content-Type: application/json" \
  -d '{"activity_id": "seu-activity-id"}'
```

### **2. Testar Atualização de Evento**
```bash
curl -X POST https://app.lovoocrm.com/api/google-calendar/sync/update-event \
  -H "Content-Type: application/json" \
  -d '{"activity_id": "seu-activity-id"}'
```

### **3. Testar Deleção de Evento**
```bash
curl -X POST https://app.lovoocrm.com/api/google-calendar/sync/delete-event \
  -H "Content-Type: application/json" \
  -d '{"activity_id": "seu-activity-id"}'
```

---

## 📋 PRÓXIMOS PASSOS (FASE 3)

### **Integração Automática no Frontend**
1. Adicionar toggle "Sincronizar com Google" no modal de atividades
2. Modificar `calendarApi.ts` para chamar APIs de sync automaticamente
3. Adicionar indicador visual de eventos sincronizados
4. Implementar sincronização em lote

### **Webhooks Google → Sistema (Bidirecional)**
1. Configurar webhook do Google Calendar
2. Receber notificações de mudanças
3. Sincronizar eventos do Google para o sistema
4. Resolver conflitos de sincronização

---

## 🚀 DEPLOY

**Arquivos criados:**
- ✅ `supabase/migrations/20260309140000_add_google_event_id_to_activities.sql`
- ✅ `api/google-calendar/helpers/event-converter.js`
- ✅ `api/google-calendar/sync/create-event.js`
- ✅ `api/google-calendar/sync/update-event.js`
- ✅ `api/google-calendar/sync/delete-event.js`

**Nenhum arquivo existente foi modificado.**

---

## ⚠️ IMPORTANTE

- Sincronização é **opcional** e controlada por flag
- Sistema funciona normalmente **sem Google Calendar**
- Falhas de sincronização **não afetam** o sistema principal
- Usuário precisa ter **Google Calendar conectado** (FASE 1)

---

**FASE 2 COMPLETA E PRONTA PARA TESTES!** 🎉
