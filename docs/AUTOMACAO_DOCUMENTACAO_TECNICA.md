# Documentação Técnica - Sistema de Automação LovooCRM

**Versão:** 2.0  
**Última Atualização:** 25/03/2026  
**Autor:** Equipe M4 Digital

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Componentes Principais](#componentes-principais)
4. [Fluxo de Execução](#fluxo-de-execução)
5. [Sistema de Timeout](#sistema-de-timeout)
6. [Gerenciamento de Instâncias WhatsApp](#gerenciamento-de-instâncias-whatsapp)
7. [Edge Functions](#edge-functions)
8. [Cron Jobs](#cron-jobs)
9. [Banco de Dados](#banco-de-dados)
10. [Ações Disponíveis](#ações-disponíveis)
11. [Triggers Disponíveis](#triggers-disponíveis)
12. [Exemplos Práticos](#exemplos-práticos)
13. [Troubleshooting](#troubleshooting)
14. [Manutenção](#manutenção)

---

## 🎯 Visão Geral

O Sistema de Automação do LovooCRM é uma plataforma visual de automação de processos que permite criar fluxos de trabalho complexos sem código. O sistema suporta:

- **17 Ações** distribuídas em 5 categorias
- **11 Triggers** para iniciar automações
- **Execução assíncrona** com suporte a pausas e retomadas
- **Timeout automático** para perguntas aguardando resposta
- **Gerenciamento inteligente** de instâncias WhatsApp
- **Validação e logging** completo de execuções

---

## 🏗️ Arquitetura do Sistema

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                        │
├─────────────────────────────────────────────────────────────┤
│  FlowEditor.tsx          │  NodeConfigPanel.tsx             │
│  - Editor visual         │  - Configuração de nós           │
│  - React Flow            │  - Formulários dinâmicos         │
│                          │                                   │
│  MessageConfigModal.tsx  │  UserInputForm.tsx               │
│  - Config mensagens      │  - Config perguntas + timeout    │
└─────────────────────────────────────────────────────────────┘
                              ↓ API Calls
┌─────────────────────────────────────────────────────────────┐
│                      BACKEND (Services)                      │
├─────────────────────────────────────────────────────────────┤
│  AutomationEngine.ts     │  TriggerManager.ts               │
│  - Execução de fluxos    │  - Gerenciamento de triggers     │
│  - Processamento de nós  │  - Matching de eventos           │
│                          │                                   │
│  CRMService.ts           │  WhatsAppService.ts              │
│  - Operações CRM         │  - Envio de mensagens            │
│  - Leads/Oportunidades   │  - Gerenciamento de instâncias   │
└─────────────────────────────────────────────────────────────┘
                              ↓ Database
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                     │
├─────────────────────────────────────────────────────────────┤
│  automation_flows        │  automation_executions           │
│  automation_triggers     │  whatsapp_life_instances         │
└─────────────────────────────────────────────────────────────┘
                              ↓ Cron Jobs
┌─────────────────────────────────────────────────────────────┐
│                      EDGE FUNCTIONS                          │
├─────────────────────────────────────────────────────────────┤
│  check-automation-timeouts                                   │
│  - Verifica execuções com timeout expirado (a cada 5 min)   │
│  - Cancela automaticamente execuções pausadas               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Componentes Principais

### 1. FlowEditor.tsx

**Localização:** `/src/pages/FlowEditor.tsx`

**Responsabilidades:**
- Renderização do editor visual usando React Flow
- Gerenciamento de nós e conexões
- Salvamento de fluxos no banco de dados
- Interface de arrastar e soltar

**Principais Funções:**
```typescript
handleNodeConfigSave(nodeId: string, config: any): void
handleAddNode(type: string): void
handleSaveFlow(): Promise<void>
```

---

### 2. AutomationEngine.ts

**Localização:** `/src/services/automation/AutomationEngine.ts`

**Responsabilidades:**
- Execução de fluxos de automação
- Processamento sequencial de nós
- Gerenciamento de contexto de execução
- Tratamento de pausas e retomadas
- Cálculo e aplicação de timeouts

**Principais Funções:**
```typescript
async processFlow(execution: AutomationExecution): Promise<void>
async processNode(node: Node, allNodes: Node[], allEdges: Edge[], context: ExecutionContext): Promise<void>
async executeNodeAction(node: Node, context: ExecutionContext): Promise<any>
async handleUserInput(node: Node, context: ExecutionContext): Promise<any>
async resumeExecution(executionId: string, userResponse: string): Promise<void>
```

**Fluxo de Execução:**
```
1. processFlow() - Inicia execução
   ↓
2. Extrai instanceId do trigger (se configurado)
   ↓
3. processNode() - Processa cada nó
   ↓
4. executeNodeAction() - Executa ação do nó
   ↓
5. Se user_input → handleUserInput()
   ├─ Envia pergunta
   ├─ Calcula timeout_at
   ├─ Pausa execução (status: 'paused')
   └─ Aguarda resposta ou timeout
   ↓
6. Se timeout expirado → Cron job cancela
7. Se resposta recebida → resumeExecution()
```

---

### 3. TriggerManager.ts

**Localização:** `/src/services/automation/TriggerManager.ts`

**Responsabilidades:**
- Matching de eventos com triggers configurados
- Validação de condições de disparo
- Criação de execuções de automação
- Filtragem por instância WhatsApp (para message.received)

**Principais Funções:**
```typescript
async handleEvent(eventType: string, eventData: any, companyId: string): Promise<void>
async matchTriggers(eventType: string, eventData: any, companyId: string): Promise<AutomationTrigger[]>
async createExecution(trigger: AutomationTrigger, triggerData: any): Promise<void>
```

---

### 4. NodeConfigPanel.tsx

**Localização:** `/src/components/Automation/NodeConfigPanel.tsx`

**Responsabilidades:**
- Renderização de formulários de configuração
- Validação de campos obrigatórios
- Detecção de instanceId do trigger
- Ocultação condicional de campos

**Lógica de Detecção de Instância:**
```typescript
const triggerNode = nodes?.find(n => n.id === 'start-node')
const firstTrigger = triggerNode?.data?.triggers?.find((t: any) => t.enabled)
const triggerInstanceId = firstTrigger?.config?.instanceId
const triggerInstanceName = firstTrigger?.config?.instanceName

// Se trigger tem instância, oculta campo de instância nos cards de mensagem
if (triggerInstanceId && node.type === 'message') {
  // Não renderiza campo de seleção de instância
}
```

---

### 5. MessageConfigModal.tsx

**Localização:** `/src/components/Automation/MessageConfigModal.tsx`

**Responsabilidades:**
- Configuração de mensagens WhatsApp
- Seleção de instância (se não definida no trigger)
- Salvamento correto de instanceId e instanceName

**Correção Implementada (25/03/2026):**
```typescript
// ❌ ANTES (INCORRETO):
const configToSave = { ...currentConfig, instance: selectedInstance }

// ✅ DEPOIS (CORRETO):
const selectedInstanceData = instances.find(inst => inst.id === selectedInstance)
const configToSave = { 
  ...currentConfig, 
  instanceId: selectedInstance,
  instanceName: selectedInstanceData?.instance_name || ''
}
```

---

### 6. UserInputForm.tsx

**Localização:** `/src/components/Automation/forms/UserInputForm.tsx`

**Responsabilidades:**
- Configuração de perguntas para o usuário
- Definição de timeout (minutos/horas/dias)
- Validação de resposta (texto/número/email/telefone)

**Interface de Configuração:**
```typescript
interface UserInputFormProps {
  config: {
    question?: string
    variable?: string
    validation?: 'text' | 'number' | 'email' | 'phone'
    timeoutValue?: number        // ✅ NOVO (25/03/2026)
    timeoutUnit?: 'minutes' | 'hours' | 'days'  // ✅ NOVO (25/03/2026)
  }
  onChange: (config: any) => void
}
```

---

## ⚡ Fluxo de Execução

### Execução Normal (Sem Pausas)

```
1. Evento ocorre (ex: lead.created)
   ↓
2. TriggerManager.handleEvent()
   ├─ Busca triggers matching
   ├─ Valida condições
   └─ Cria automation_execution
   ↓
3. AutomationEngine.processFlow()
   ├─ Extrai instanceId do trigger
   ├─ Cria ExecutionContext
   └─ Inicia processamento
   ↓
4. Para cada nó:
   ├─ processNode()
   ├─ executeNodeAction()
   ├─ createLog()
   └─ Avança para próximo nó
   ↓
5. Fluxo completo
   └─ Status: 'completed'
```

### Execução com Pausa (User Input)

```
1. Nó de tipo 'user_input' detectado
   ↓
2. handleUserInput()
   ├─ Envia pergunta ao WhatsApp
   ├─ Calcula timeout_at = NOW() + (timeoutValue * timeoutUnit)
   ├─ Salva em automation_executions:
   │  ├─ status: 'paused'
   │  ├─ timeout_at: timestamp
   │  ├─ paused_at: timestamp
   │  └─ variables._awaiting_input: { node_id, variable_name, timeout_value, timeout_unit }
   └─ Retorna { paused: true }
   ↓
3. processNode() detecta pausa
   └─ INTERROMPE processamento (não avança para próximos nós)
   ↓
4. Aguarda resposta OU timeout
   ↓
5a. Se resposta recebida ANTES do timeout:
    ├─ Webhook recebe mensagem
    ├─ Busca execução pausada
    ├─ resumeExecution(executionId, userResponse)
    ├─ Salva resposta em variables[variable_name]
    ├─ Muda status para 'running'
    └─ Continua processamento
    ↓
5b. Se timeout expirado (SEM resposta):
    ├─ Cron job executa (a cada 5 min)
    ├─ Edge Function detecta timeout_at < NOW()
    ├─ Muda status para 'failed'
    ├─ error_message: "Timeout - usuário não respondeu dentro do prazo"
    └─ Execução NÃO retoma (mesmo se usuário responder depois)
```

---

## ⏱️ Sistema de Timeout

**Implementado em:** 25/03/2026

### Objetivo

Evitar que execuções fiquem pausadas indefinidamente aguardando resposta do usuário.

### Componentes

#### 1. Frontend - UserInputForm.tsx

**Campos adicionados:**
```tsx
<div>
  <label>Tempo limite para resposta</label>
  <div className="flex gap-2">
    <input
      type="number"
      min="1"
      value={timeoutValue}
      onChange={(e) => {
        const value = parseInt(e.target.value) || 1
        setTimeoutValue(value)
        handleChange('timeoutValue', value)
      }}
      placeholder="24"
    />
    <select
      value={timeoutUnit}
      onChange={(e) => {
        setTimeoutUnit(e.target.value)
        handleChange('timeoutUnit', e.target.value)
      }}
    >
      <option value="minutes">Minutos</option>
      <option value="hours">Horas</option>
      <option value="days">Dias</option>
    </select>
  </div>
  <p className="text-xs text-gray-500">
    Após este período sem resposta, a automação será cancelada automaticamente
  </p>
</div>
```

**Valor padrão:** 24 horas

---

#### 2. Backend - AutomationEngine.ts

**Cálculo de Timeout:**
```typescript
// Linha ~1910-1932
const timeoutValue = node.data.config?.timeoutValue || 24
const timeoutUnit = node.data.config?.timeoutUnit || 'hours'

let timeoutMinutes = 0
switch (timeoutUnit) {
  case 'minutes':
    timeoutMinutes = timeoutValue
    break
  case 'hours':
    timeoutMinutes = timeoutValue * 60
    break
  case 'days':
    timeoutMinutes = timeoutValue * 60 * 24
    break
}

const timeoutAt = new Date(Date.now() + timeoutMinutes * 60 * 1000)

console.log('⏰ Timeout configurado:', {
  value: timeoutValue,
  unit: timeoutUnit,
  expiresAt: timeoutAt.toISOString()
})
```

**Salvamento no Banco:**
```typescript
// Linha ~1939-1958
await supabase
  .from('automation_executions')
  .update({
    status: 'paused',
    current_node_id: node.id,
    paused_at: new Date().toISOString(),
    timeout_at: timeoutAt.toISOString(),  // ✅ NOVO
    variables: {
      ...context.variables,
      _awaiting_input: {
        node_id: node.id,
        variable_name: variableName,
        question: node.data.config?.question,
        message_id: messageId,
        timeout_value: timeoutValue,  // ✅ NOVO
        timeout_unit: timeoutUnit     // ✅ NOVO
      }
    }
  })
  .eq('id', context.executionId)
```

---

#### 3. Banco de Dados - Migration

**Arquivo:** `supabase/migrations/add_timeout_at_to_automation_executions.sql`

```sql
-- Adicionar coluna timeout_at
ALTER TABLE automation_executions
ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMP WITH TIME ZONE;

-- Criar índice para otimizar busca de execuções expiradas
CREATE INDEX IF NOT EXISTS idx_automation_executions_timeout 
ON automation_executions(timeout_at) 
WHERE status = 'paused' AND timeout_at IS NOT NULL;

-- Comentário na coluna
COMMENT ON COLUMN automation_executions.timeout_at IS 
'Timestamp de quando a execução pausada deve expirar e ser cancelada automaticamente';
```

---

#### 4. Edge Function - check-automation-timeouts

**Arquivo:** `supabase/functions/check-automation-timeouts/index.ts`

**Função:** Verificar e cancelar execuções com timeout expirado

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log('🔍 Verificando execuções com timeout expirado...')

    // Buscar execuções pausadas com timeout expirado
    const { data: expiredExecutions, error } = await supabase
      .from('automation_executions')
      .select('id, flow_id, lead_id, timeout_at, variables')
      .eq('status', 'paused')
      .not('timeout_at', 'is', null)
      .lt('timeout_at', new Date().toISOString())

    if (error) throw error

    console.log(`📊 Encontradas ${expiredExecutions?.length || 0} execuções expiradas`)

    if (!expiredExecutions || expiredExecutions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Nenhuma execução expirada', count: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Cancelar execuções expiradas
    const { error: updateError } = await supabase
      .from('automation_executions')
      .update({
        status: 'failed',
        error_message: 'Timeout - usuário não respondeu dentro do prazo',
        completed_at: new Date().toISOString()
      })
      .in('id', expiredExecutions.map(e => e.id))

    if (updateError) throw updateError

    console.log(`✅ ${expiredExecutions.length} execuções canceladas por timeout`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${expiredExecutions.length} execuções canceladas`,
        count: expiredExecutions.length,
        executions: expiredExecutions.map(e => ({
          id: e.id,
          flow_id: e.flow_id,
          lead_id: e.lead_id,
          timeout_at: e.timeout_at
        }))
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('❌ Erro ao verificar timeouts:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

**Deploy:**
```bash
# Via MCP Supabase
mcp0_deploy_edge_function(
  project_id: "etzdsywunlpbgxkphuil",
  name: "check-automation-timeouts",
  verify_jwt: false
)
```

---

#### 5. Cron Job - Execução Periódica

**Configuração:**
```sql
-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Criar cron job (executa a cada 5 minutos)
SELECT cron.schedule(
  'check-automation-timeouts',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://etzdsywunlpbgxkphuil.supabase.co/functions/v1/check-automation-timeouts',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer [ANON_KEY]"}'::jsonb
    ) AS request_id;
  $$
);
```

**Verificar Status:**
```sql
-- Listar cron jobs
SELECT jobid, schedule, command, active, jobname
FROM cron.job 
WHERE jobname = 'check-automation-timeouts';

-- Ver histórico de execuções
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = [JOB_ID]
ORDER BY start_time DESC
LIMIT 10;
```

---

## 📱 Gerenciamento de Instâncias WhatsApp

**Implementado em:** 25/03/2026

### Problema Resolvido

Antes da correção, mensagens eram enviadas pela instância errada porque:
1. `instanceId` era salvo como `instance` no frontend
2. `instanceId` não era propagado entre nós do fluxo
3. `conversationId` do trigger tinha prioridade sobre `instanceId` configurado

### Solução Implementada

#### 1. Prioridade de Instância

```
1º - instanceId do trigger (se configurado)
2º - instanceId do primeiro card de mensagem (se trigger não tem)
3º - ERRO (se nenhum dos dois)
```

#### 2. Propagação de instanceId

**AutomationEngine.ts - Linha ~1590-1601:**
```typescript
// Após criar conversa com instanceId do primeiro card
conversationId = conversation.id
console.log('✅ Conversa criada/encontrada com instância configurada:', conversationId)

// ✅ PROPAGAR instanceId para próximos nós (se não veio do trigger)
if (!context.instanceId && instanceId) {
  context.instanceId = instanceId
  console.log('✅ instanceId propagado para próximos nós:', {
    instanceId,
    instanceName: instance.instance_name,
    source: 'primeiro card'
  })
}
```

**Resultado:**
- Card 1: usa `instanceId` configurado
- Card 2+: herdam `instanceId` do Card 1 via `context`
- Todos os cards usam a MESMA instância

---

#### 3. Lógica de Seleção de Instância

**AutomationEngine.ts - sendWhatsAppMessage() - Linha ~1528-1602:**

```typescript
// ✅ PRIORIZAR instanceId sobre conversationId
const instanceId = context.instanceId || node.data.config?.instanceId
let conversationId: string | undefined;

if (instanceId) {
  // ✅ TEM instanceId configurado: SEMPRE criar/buscar conversa com essa instância
  // ✅ IGNORA conversationId do triggerData para garantir instância correta

  console.log('📱 Instância configurada detectada:', {
    source: context.instanceId ? 'trigger' : 'card',
    instanceId
  })

  // Validar status da instância
  const { data: instance, error: instanceError } = await supabase
    .from('whatsapp_life_instances')
    .select('id, instance_name, status, phone_number')
    .eq('id', instanceId)
    .eq('company_id', context.companyId)
    .single()

  if (instanceError || !instance) {
    throw new Error(`Instância WhatsApp não encontrada (ID: ${instanceId})`)
  }

  if (instance.status !== 'connected') {
    await this.notifyInstanceDisconnected(context, instance, node.data.label || 'Enviar Mensagem WhatsApp')
    throw new Error(
      `Instância "${instance.instance_name}" está ${instance.status}. ` +
      `Conecte a instância antes de enviar mensagens.`
    )
  }

  console.log('✅ Instância validada:', {
    instanceName: instance.instance_name,
    status: instance.status,
    phone: instance.phone_number
  })

  // Criar ou buscar conversa com instância específica
  const conversation = await ChatApi.createOrGetConversation(
    context.companyId,
    instanceId,
    lead.phone,
    lead.name
  )

  conversationId = conversation.id
  console.log('✅ Conversa criada/encontrada com instância configurada:', conversationId)

  // ✅ PROPAGAR instanceId para próximos nós
  if (!context.instanceId && instanceId) {
    context.instanceId = instanceId
    console.log('✅ instanceId propagado para próximos nós:', {
      instanceId,
      instanceName: instance.instance_name,
      source: 'primeiro card'
    })
  }
} else {
  // ✅ NÃO tem instanceId: usar conversationId do triggerData (fallback)
  conversationId = context.triggerData?.conversation_id ||
                   context.triggerData?.opportunity?.conversation_id

  if (!conversationId) {
    throw new Error('Instância WhatsApp não configurada. Configure no gatilho ou no card de mensagem.')
  }

  console.log('✅ Usando conversationId do triggerData (sem instanceId configurado):', conversationId)
}
```

---

## 🔌 Edge Functions

### check-automation-timeouts

**ID:** `2f6d503e-f1b1-46fa-a75a-7fa74bbed728`  
**Status:** ACTIVE  
**Verify JWT:** false (permite chamadas do cron job)

**Responsabilidades:**
- Buscar execuções pausadas com `timeout_at < NOW()`
- Cancelar automaticamente (`status: 'failed'`)
- Retornar relatório de execuções canceladas

**Logs:**
```
🔍 Verificando execuções com timeout expirado...
📊 Encontradas 3 execuções expiradas
✅ 3 execuções canceladas por timeout
```

**Response:**
```json
{
  "success": true,
  "message": "3 execuções canceladas",
  "count": 3,
  "executions": [
    {
      "id": "f09ab2df-5294-4d23-b684-fd980b2b2fa9",
      "flow_id": "3e6196b4-467d-47e0-b976-b867a7a6e071",
      "lead_id": 161,
      "timeout_at": "2026-03-25T21:38:31.054Z"
    }
  ]
}
```

---

## ⏰ Cron Jobs

### check-automation-timeouts

**Job ID:** 2  
**Schedule:** `*/5 * * * *` (a cada 5 minutos)  
**Status:** ATIVO  
**Database:** postgres  
**Username:** postgres

**Comando:**
```sql
SELECT
  net.http_post(
    url := 'https://etzdsywunlpbgxkphuil.supabase.co/functions/v1/check-automation-timeouts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer [ANON_KEY]"}'::jsonb
  ) AS request_id;
```

**Verificar Execuções:**
```sql
SELECT 
  jobid,
  runid,
  status,
  return_message,
  start_time,
  end_time,
  NOW() - start_time as time_ago
FROM cron.job_run_details
WHERE jobid = 2
ORDER BY start_time DESC
LIMIT 10;
```

**Cancelar Job:**
```sql
SELECT cron.unschedule('check-automation-timeouts');
```

---

## 🗄️ Banco de Dados

### Tabela: automation_executions

**Colunas Principais:**
```sql
id                UUID PRIMARY KEY
flow_id           UUID REFERENCES automation_flows(id)
company_id        UUID REFERENCES companies(id)
lead_id           INTEGER REFERENCES leads(id)
opportunity_id    UUID REFERENCES opportunities(id)
status            VARCHAR CHECK (status IN ('running', 'completed', 'failed', 'paused'))
current_node_id   VARCHAR
paused_at         TIMESTAMP WITH TIME ZONE  -- Quando foi pausado
timeout_at        TIMESTAMP WITH TIME ZONE  -- ✅ NOVO: Quando deve expirar
completed_at      TIMESTAMP WITH TIME ZONE
error_message     TEXT
variables         JSONB
executed_nodes    JSONB
trigger_data      JSONB
```

**Índices:**
```sql
-- Índice para busca de execuções expiradas (otimizado)
CREATE INDEX idx_automation_executions_timeout 
ON automation_executions(timeout_at) 
WHERE status = 'paused' AND timeout_at IS NOT NULL;

-- Outros índices
CREATE INDEX idx_automation_executions_status ON automation_executions(status);
CREATE INDEX idx_automation_executions_company ON automation_executions(company_id);
CREATE INDEX idx_automation_executions_flow ON automation_executions(flow_id);
```

**Estrutura de variables:**
```json
{
  "lead_name": "João Silva",
  "custom_field_value": "Premium",
  "_awaiting_input": {
    "node_id": "message-1774010306214",
    "variable_name": "Pode_enviar",
    "question": "Posso te enviar mais exemplos?",
    "message_id": "msg_123",
    "timeout_value": 24,
    "timeout_unit": "hours"
  }
}
```

---

## 🎬 Ações Disponíveis

### Lead (4 ações)

1. **add_tag** - Adicionar tag ao lead
2. **remove_tag** - Remover tag do lead
3. **update_lead** - Atualizar dados do lead
4. **set_custom_field** - Definir campo customizado

### Oportunidade (5 ações)

5. **create_opportunity** - Criar oportunidade
6. **move_opportunity** - Mover para outra etapa
7. **win_opportunity** - Marcar como ganha
8. **lose_opportunity** - Marcar como perdida
9. **assign_owner** - Atribuir responsável

### Atividade (5 ações)

10. **create_activity** - Criar atividade
11. **update_activity** - Atualizar atividade
12. **complete_activity** - Completar atividade
13. **cancel_activity** - Cancelar atividade
14. **reschedule_activity** - Reagendar atividade

### Sistema (2 ações)

15. **send_notification** - Enviar notificação
16. **trigger_automation** - Disparar outra automação

### Integração (1 ação)

17. **send_webhook** - Enviar webhook HTTP

---

## 🎯 Triggers Disponíveis

1. **lead.created** - Lead criado
2. **message.received** - Mensagem recebida (filtra por instanceId)
3. **opportunity.created** - Oportunidade criada
4. **opportunity.stage_changed** - Mudança de etapa
5. **opportunity.won** - Oportunidade ganha
6. **opportunity.lost** - Oportunidade perdida
7. **opportunity.owner_assigned** - Responsável atribuído
8. **opportunity.owner_removed** - Responsável removido
9. **tag.added** - Tag adicionada
10. **tag.removed** - Tag removida
11. **schedule.time** - Agendamento por tempo

---

## 💡 Exemplos Práticos

### Exemplo 1: Automação com Timeout

**Cenário:** Enviar pergunta ao lead e aguardar resposta por 24 horas

**Configuração:**
```
Trigger: lead.created
  ↓
Ação 1: Enviar Mensagem WhatsApp
  - Tipo: user_input
  - Pergunta: "Qual seu interesse principal?"
  - Variável: interesse
  - Timeout: 24 horas
  ↓
Ação 2: Condição
  - Se {{interesse}} == "produto A"
    ↓
    Ação 3: Criar Oportunidade
```

**Fluxo:**
1. Lead criado → Trigger dispara
2. Mensagem enviada: "Qual seu interesse principal?"
3. Execução pausada (status: 'paused', timeout_at: NOW() + 24h)
4. **Cenário A:** Lead responde "produto A" em 2 horas
   - Execução retoma
   - Variável `interesse` = "produto A"
   - Condição avaliada
   - Oportunidade criada
5. **Cenário B:** Lead NÃO responde em 24 horas
   - Cron job detecta timeout expirado
   - Execução cancelada (status: 'failed')
   - Mensagem: "Timeout - usuário não respondeu dentro do prazo"

---

### Exemplo 2: Automação com Instância Específica

**Cenário:** Enviar mensagens sempre pela mesma instância WhatsApp

**Configuração:**
```
Trigger: opportunity.stage_changed
  - Instância: "Marcio - teste" (ID: 23f37ca0...)
  ↓
Ação 1: Enviar Mensagem WhatsApp
  - Mensagem: "Parabéns! Sua oportunidade avançou."
  - (Instância herdada do trigger)
  ↓
Ação 2: Enviar Mensagem WhatsApp
  - Mensagem: "Em breve entraremos em contato."
  - (Instância herdada do trigger)
```

**Fluxo:**
1. Oportunidade muda de etapa → Trigger dispara
2. `context.instanceId` = '23f37ca0...' (do trigger)
3. Mensagem 1 enviada pela instância "Marcio - teste"
4. Mensagem 2 enviada pela MESMA instância (herdada)

---

### Exemplo 3: Automação com Múltiplas Condições

**Cenário:** Fluxo complexo com validações

**Configuração:**
```
Trigger: message.received
  - Instância: "Atendimento" (ID: abc123...)
  ↓
Ação 1: Condição
  - Se mensagem contém "orçamento"
    ↓
    Ação 2: Adicionar Tag "interessado_orcamento"
    ↓
    Ação 3: Criar Oportunidade
      - Funil: Vendas
      - Etapa: Qualificação
    ↓
    Ação 4: Enviar Mensagem WhatsApp
      - Tipo: user_input
      - Pergunta: "Qual o valor do investimento?"
      - Variável: valor_investimento
      - Timeout: 1 hora
    ↓
    Ação 5: Condição
      - Se {{valor_investimento}} > 10000
        ↓
        Ação 6: Atribuir Responsável (Gerente)
      - Senão
        ↓
        Ação 7: Atribuir Responsável (Vendedor)
```

---

## 🔧 Troubleshooting

### Problema: Execução não inicia

**Sintomas:**
- Trigger configurado mas execução não é criada
- Nenhum log no console

**Diagnóstico:**
```sql
-- Verificar se trigger está ativo
SELECT * FROM automation_triggers
WHERE flow_id = '[FLOW_ID]'
  AND enabled = true;

-- Verificar logs de erro
SELECT * FROM automation_executions
WHERE flow_id = '[FLOW_ID]'
  AND status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

**Soluções:**
1. Verificar se trigger está habilitado
2. Verificar se condições do trigger são atendidas
3. Verificar logs do TriggerManager no console

---

### Problema: Timeout não funciona

**Sintomas:**
- Execução fica pausada indefinidamente
- Cron job não cancela execução expirada

**Diagnóstico:**
```sql
-- Verificar se cron job está executando
SELECT jobid, runid, status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = 2
ORDER BY start_time DESC
LIMIT 5;

-- Verificar execuções com timeout expirado
SELECT id, status, paused_at, timeout_at, NOW() - timeout_at as expired_time
FROM automation_executions
WHERE status = 'paused'
  AND timeout_at < NOW()
ORDER BY timeout_at ASC;

-- Verificar se Edge Function está deployada
SELECT * FROM pg_net.http_post(
  url := 'https://etzdsywunlpbgxkphuil.supabase.co/functions/v1/check-automation-timeouts',
  headers := '{"Content-Type": "application/json"}'::jsonb
);
```

**Soluções:**
1. Verificar se extensões `pg_cron` e `pg_net` estão habilitadas
2. Verificar se Edge Function está deployada (status: ACTIVE)
3. Verificar logs da Edge Function
4. Recriar cron job se necessário

---

### Problema: Mensagem enviada pela instância errada

**Sintomas:**
- Instância configurada no trigger/card não é respeitada
- Mensagens enviadas por outra instância

**Diagnóstico:**
```typescript
// Verificar logs do AutomationEngine
console.log('📱 Instância configurada detectada:', {
  source: context.instanceId ? 'trigger' : 'card',
  instanceId
})

console.log('✅ instanceId propagado para próximos nós:', {
  instanceId,
  instanceName: instance.instance_name,
  source: 'primeiro card'
})
```

**Soluções:**
1. Verificar se `instanceId` está salvo corretamente no nó
2. Verificar se `context.instanceId` está sendo propagado
3. Verificar logs de criação de conversa
4. Limpar execuções pausadas antigas

---

### Problema: Execução pausada não retoma

**Sintomas:**
- Usuário responde mas execução não continua
- Status permanece 'paused'

**Diagnóstico:**
```sql
-- Verificar execução pausada
SELECT id, status, paused_at, timeout_at, variables->'_awaiting_input' as awaiting_input
FROM automation_executions
WHERE id = '[EXECUTION_ID]';

-- Verificar se webhook está funcionando
-- (logs do endpoint /api/uazapi-webhook-final)
```

**Soluções:**
1. Verificar se webhook está recebendo mensagens
2. Verificar se `resumeExecution()` está sendo chamado
3. Verificar se `conversation_id` corresponde à execução pausada
4. Verificar logs do webhook no Vercel

---

## 🛠️ Manutenção

### Limpeza de Execuções Antigas

**Cancelar execuções pausadas há mais de 7 dias:**
```sql
UPDATE automation_executions
SET 
  status = 'failed',
  error_message = 'Timeout - execução pausada por mais de 7 dias',
  completed_at = NOW()
WHERE status = 'paused'
  AND paused_at < NOW() - INTERVAL '7 days';
```

**Deletar execuções completadas há mais de 30 dias:**
```sql
DELETE FROM automation_executions
WHERE status IN ('completed', 'failed')
  AND completed_at < NOW() - INTERVAL '30 days';
```

---

### Monitoramento

**Execuções ativas:**
```sql
SELECT 
  status,
  COUNT(*) as total,
  AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_duration_seconds
FROM automation_executions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

**Taxa de sucesso:**
```sql
SELECT 
  flow_id,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'paused') as paused,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'completed')::numeric / 
    COUNT(*)::numeric * 100, 
    2
  ) as success_rate
FROM automation_executions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY flow_id
ORDER BY success_rate DESC;
```

**Timeouts por fluxo:**
```sql
SELECT 
  flow_id,
  COUNT(*) as total_timeouts,
  AVG(EXTRACT(EPOCH FROM (completed_at - paused_at))) as avg_wait_time_seconds
FROM automation_executions
WHERE status = 'failed'
  AND error_message LIKE '%Timeout%'
  AND completed_at > NOW() - INTERVAL '7 days'
GROUP BY flow_id
ORDER BY total_timeouts DESC;
```

---

### Backup e Restore

**Backup de fluxos:**
```sql
COPY (
  SELECT * FROM automation_flows
  WHERE company_id = '[COMPANY_ID]'
) TO '/tmp/automation_flows_backup.csv' WITH CSV HEADER;
```

**Backup de execuções:**
```sql
COPY (
  SELECT * FROM automation_executions
  WHERE company_id = '[COMPANY_ID]'
    AND created_at > NOW() - INTERVAL '30 days'
) TO '/tmp/automation_executions_backup.csv' WITH CSV HEADER;
```

---

## 📚 Referências

### Arquivos Principais

- **Frontend:**
  - `/src/pages/FlowEditor.tsx` - Editor visual
  - `/src/components/Automation/NodeConfigPanel.tsx` - Configuração de nós
  - `/src/components/Automation/MessageConfigModal.tsx` - Config mensagens
  - `/src/components/Automation/forms/UserInputForm.tsx` - Config perguntas

- **Backend:**
  - `/src/services/automation/AutomationEngine.ts` - Motor de execução
  - `/src/services/automation/TriggerManager.ts` - Gerenciador de triggers
  - `/src/services/automation/CRMService.ts` - Operações CRM
  - `/src/services/automation/WhatsAppService.ts` - Envio de mensagens

- **Edge Functions:**
  - `/supabase/functions/check-automation-timeouts/index.ts`

- **Migrations:**
  - `/supabase/migrations/add_timeout_at_to_automation_executions.sql`

### Commits Importantes

- **25/03/2026 - c1e7064:** Propagação de instanceId entre nós
- **25/03/2026 - 79b8101:** Implementação de timeout para perguntas
- **25/03/2026 - 8bb1432:** Sincronização lovooDev com loovocrm

---

## 📝 Changelog

### v2.0 - 25/03/2026

**Novas Funcionalidades:**
- ✅ Sistema de timeout para perguntas aguardando resposta
- ✅ Configuração de timeout (minutos/horas/dias)
- ✅ Cancelamento automático via cron job
- ✅ Edge Function para verificação de timeouts
- ✅ Propagação de instanceId entre nós
- ✅ Priorização de instanceId sobre conversationId

**Correções:**
- ✅ instanceId salvo corretamente (instanceId/instanceName)
- ✅ instanceId propagado para próximos nós via context
- ✅ Instância configurada sempre respeitada
- ✅ Extensões pg_cron e pg_net habilitadas

**Melhorias:**
- ✅ Logs detalhados de timeout e instância
- ✅ Índice otimizado para busca de timeouts
- ✅ Documentação técnica completa

---

**Última Atualização:** 25/03/2026  
**Versão:** 2.0  
**Autor:** Equipe M4 Digital
