# 🤖 FLOW BUILDER - SISTEMA DE AUTOMAÇÃO LOVOO CRM
**Data:** 13/03/2026  
**Versão:** 1.0  
**Status:** 📋 DOCUMENTAÇÃO

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Análise do Minichat](#análise-do-minichat)
3. [Recursos Nativos Existentes](#recursos-nativos-existentes)
4. [Arquitetura do Sistema](#arquitetura-do-sistema)
5. [Componentes do Flow Builder](#componentes-do-flow-builder)
6. [Blocos de Automação](#blocos-de-automação)
7. [Estrutura de Dados](#estrutura-de-dados)
8. [Interface Visual](#interface-visual)
9. [Implementação Técnica](#implementação-técnica)
10. [Roadmap de Desenvolvimento](#roadmap-de-desenvolvimento)
11. [Casos de Uso](#casos-de-uso)

---

## 🎯 VISÃO GERAL

### Objetivo
Criar um **Flow Builder visual** para automação de processos no LovoCRM, permitindo que usuários criem fluxos de automação através de uma interface drag & drop, similar ao Minichat, mas focado em vendas B2B e gestão de oportunidades.

### Escopo
- **Editor visual** de automações (canvas infinito)
- **Blocos de gatilhos** (triggers) baseados em eventos do CRM
- **Blocos de ações** específicas para vendas e WhatsApp
- **Blocos de lógica** (condições, delays, ramificações)
- **Distribuição inteligente** de leads
- **Sequências de follow-up** automatizadas
- **Integração profunda** com funil de vendas

### Diferencial Competitivo
- ✅ Integração nativa com funil de oportunidades
- ✅ Foco em vendas B2B e consultivas
- ✅ Distribuição e balanceamento de leads
- ✅ WhatsApp como canal principal
- ✅ Analytics de conversão integrado
- ✅ Compliance LGPD nativo

---

## 📸 ANÁLISE DO MINICHAT

### Tela 1: Interface Inicial

**Componentes Identificados:**

```
┌─────────────────────────────────────────────────────────┐
│  [Automations > Manychat automation]    [✓ Saved] [🔄] │
│                                                          │
│  ┌──────────────┐                  ┌─────────────────┐ │
│  │   When...    │                  │ Choose first    │ │
│  │              │                  │ step:           │ │
│  │ + New Trigger│─────Then────────▶│                 │ │
│  └──────────────┘                  │ • Messenger     │ │
│                                     │ • Instagram     │ │
│                                     │ • Telegram      │ │
│                                     │ • SMS           │ │
│                                     │ • Email         │ │
│                                     │ • AI Step       │ │
│                                     │ • Actions       │ │
│                                     │ • Condition     │ │
│                                     │ • Randomizer    │ │
│                                     │ • Smart Delay   │ │
│                                     └─────────────────┘ │
│                                                          │
│  [✨ Create with AI]                                    │
└─────────────────────────────────────────────────────────┘
```

**Sidebar Direito:**
- Starting Step
- Trigger
- Content (canais)
- Channel
- Start Automation
- AI

**Controles:**
- Preview
- Set Live
- Go To Basic Builder

---

### Tela 2: Fluxo Construído

**Estrutura Visual:**

```
[When...] ──Then──▶ [Send Message #1] ──Next──▶ [Send Message #2]
                                                        │
                                                     Next
                                                        ▼
                                              [Actions: destination_selected]
                                                        │
                                                     Next
                                                        ▼
                                              [Send Message #3]
                                                        │
                                                     Next
                                                        ▼
                                    [Waiting for Multiple Choice from Contact]
                                            │                    │
                                         Beach              Mountains
                                            │                    │
                                            ▼                    ▼
                                    [Next Steps...]      [Next Steps...]
```

**Elementos Observados:**
- Blocos conectados por linhas
- Mensagens com conteúdo visível
- Botões de ação (Beach, Mountains)
- Blocos de ação (Actions)
- Aguardar resposta do usuário
- Ramificações baseadas em escolha

---

### Tela 3: Visão Completa (Zoom Out)

**Características:**
- Canvas infinito com múltiplos fluxos
- Cores diferentes para diferentes caminhos
- Estrutura de árvore complexa
- Múltiplas ramificações
- Zoom in/out
- Pan horizontal/vertical

---

## ✅ RECURSOS NATIVOS EXISTENTES

### O que já funciona no LovoCRM:

1. **Criação Automática de Oportunidade**
   - Quando novo lead entra, oportunidade é criada automaticamente
   - Vinculação automática ao funil de vendas

2. **Programação de Mensagens**
   - Agendar mensagens dentro do chat
   - Suporte a texto

3. **Integração WhatsApp**
   - Chat funcional
   - Envio e recebimento de mensagens
   - Webhook configurado

4. **Sistema de Funil**
   - Múltiplos funis
   - Etapas customizáveis
   - Oportunidades vinculadas a leads
   - Drag & drop no Kanban

5. **Atividades**
   - Criação de tarefas
   - Agendamento
   - Sincronização com Google Calendar

6. **Sistema de Leads**
   - Cadastro completo
   - Tags
   - Campos customizados
   - Histórico de interações

---

## 🏗️ ARQUITETURA DO SISTEMA

### Visão Macro

```
┌─────────────────────────────────────────────────────────────────┐
│                      FLOW BUILDER SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   EDITOR     │      │    ENGINE    │      │   EXECUTOR   │  │
│  │   (Canvas)   │─────▶│ (Processor)  │─────▶│  (Actions)   │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│         │                      │                      │          │
│         │                      │                      │          │
│         ▼                      ▼                      ▼          │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   STORAGE    │      │   TRIGGERS   │      │     LOGS     │  │
│  │   (Flows)    │      │   (Events)   │      │  (History)   │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Fluxo de Execução

```
1. USUÁRIO CRIA FLUXO NO EDITOR
   ↓
2. FLUXO É SALVO NO BANCO DE DADOS
   ↓
3. EVENTO OCORRE (ex: novo lead)
   ↓
4. TRIGGER DETECTA E INICIA FLUXO
   ↓
5. ENGINE PROCESSA BLOCOS SEQUENCIALMENTE
   ↓
6. EXECUTOR REALIZA AÇÕES
   ↓
7. LOGS SÃO REGISTRADOS
   ↓
8. PRÓXIMO BLOCO OU FIM
```

---

## 🧩 COMPONENTES DO FLOW BUILDER

### 1. Canvas (Área de Trabalho)

**Características:**
- Área infinita com scroll/pan
- Grid de fundo para alinhamento
- Zoom: 25% até 400%
- Minimap para navegação
- Snap to grid (opcional)

**Tecnologia Sugerida:**
- React Flow (biblioteca especializada)
- Ou ReactFlow + Custom Nodes
- Ou Canvas HTML5 customizado

---

### 2. Blocos (Nodes)

**Estrutura de um Bloco:**

```typescript
interface FlowNode {
  id: string
  type: 'trigger' | 'action' | 'condition' | 'delay' | 'message'
  position: { x: number, y: number }
  data: {
    label: string
    config: object
    icon?: string
    color?: string
  }
  inputs: number  // Quantas conexões de entrada
  outputs: number // Quantas conexões de saída
}
```

**Tipos de Blocos:**

1. **Trigger (Gatilho)** - Verde
   - 0 inputs, 1 output
   - Inicia o fluxo

2. **Action (Ação)** - Azul
   - 1 input, 1 output
   - Executa uma ação

3. **Condition (Condição)** - Amarelo
   - 1 input, 2+ outputs (true/false)
   - Ramificação condicional

4. **Message (Mensagem)** - Roxo
   - 1 input, 1 output
   - Envia mensagem

5. **Delay (Espera)** - Laranja
   - 1 input, 1 output
   - Aguarda tempo

6. **End (Fim)** - Vermelho
   - 1 input, 0 outputs
   - Termina o fluxo

---

### 3. Conexões (Edges)

**Estrutura de uma Conexão:**

```typescript
interface FlowEdge {
  id: string
  source: string      // ID do bloco de origem
  target: string      // ID do bloco de destino
  sourceHandle?: string
  targetHandle?: string
  label?: string
  animated?: boolean
  style?: object
}
```

**Tipos de Conexão:**
- **Sequencial** - Linha sólida
- **Condicional** - Linha tracejada
- **Delay** - Linha pontilhada
- **Erro** - Linha vermelha

---

### 4. Sidebar (Paleta de Blocos)

**Categorias:**

```
📌 GATILHOS (Triggers)
  • Novo Lead
  • Mensagem Recebida
  • Oportunidade Criada
  • Mudança de Etapa
  • Horário Agendado
  • Tag Adicionada

💬 MENSAGENS (Messages)
  • Enviar WhatsApp
  • Enviar com Mídia
  • Enviar com Botões
  • Aguardar Resposta

⚡ AÇÕES CRM (Actions)
  • Criar Oportunidade
  • Mover Oportunidade
  • Criar Atividade
  • Atualizar Lead
  • Adicionar Tag
  • Atribuir Vendedor

🔀 LÓGICA (Logic)
  • Condição (If/Else)
  • Delay (Tempo)
  • Randomizer (A/B)
  • Switch (Múltiplos)

🎯 DISTRIBUIÇÃO (Distribution)
  • Round Robin
  • Por Disponibilidade
  • Por Região

🔚 CONTROLE (Control)
  • Fim do Fluxo
  • Ir para Outro Fluxo
```

---

### 5. Toolbar (Barra de Ferramentas)

**Controles:**

```
[💾 Salvar] [👁️ Preview] [▶️ Ativar] [⏸️ Pausar]
[↩️ Desfazer] [↪️ Refazer] [🗑️ Limpar]
[🔍- Zoom Out] [100%] [🔍+ Zoom In]
[📊 Estatísticas] [⚙️ Configurações]
```

---

### 6. Painel de Configuração

**Ao clicar em um bloco:**

```
┌─────────────────────────────────┐
│  Configurar Bloco               │
├─────────────────────────────────┤
│                                 │
│  Nome: [___________________]    │
│                                 │
│  [Configurações específicas     │
│   do tipo de bloco]             │
│                                 │
│  [Cancelar]  [Salvar]           │
└─────────────────────────────────┘
```

---

## 🎬 BLOCOS DE AUTOMAÇÃO

### CATEGORIA 1: GATILHOS (Triggers)

#### 1.1 Novo Lead Criado

```typescript
{
  type: 'trigger',
  name: 'lead.created',
  config: {
    filters: {
      source?: string[]      // ['website', 'whatsapp']
      tags?: string[]        // ['interesse-produto-x']
      has_phone?: boolean
      has_email?: boolean
    }
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `lead.id`
- `lead.name`
- `lead.phone`
- `lead.email`
- `lead.source`
- `lead.created_at`

---

#### 1.2 Mensagem Recebida

```typescript
{
  type: 'trigger',
  name: 'message.received',
  config: {
    filters: {
      contains_keyword?: string[]  // ['orçamento', 'preço']
      from_lead_id?: number
      has_media?: boolean
      business_hours_only?: boolean
    }
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `message.id`
- `message.content`
- `message.media_type`
- `lead.id`
- `lead.name`

---

#### 1.3 Oportunidade Criada

```typescript
{
  type: 'trigger',
  name: 'opportunity.created',
  config: {
    filters: {
      funnel_id?: string
      min_value?: number
      max_value?: number
    }
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `opportunity.id`
- `opportunity.title`
- `opportunity.value`
- `lead.id`
- `funnel.id`
- `stage.id`

---

#### 1.4 Mudança de Etapa

```typescript
{
  type: 'trigger',
  name: 'opportunity.stage_changed',
  config: {
    funnel_id?: string
    from_stage_id?: string
    to_stage_id?: string
    min_value?: number
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `opportunity.id`
- `from_stage.id`
- `from_stage.name`
- `to_stage.id`
- `to_stage.name`
- `lead.id`

---

#### 1.5 Horário Agendado

```typescript
{
  type: 'trigger',
  name: 'schedule.time',
  config: {
    time: string           // '09:00'
    days_of_week?: number[] // [1,2,3,4,5] (seg-sex)
    timezone: string       // 'America/Sao_Paulo'
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `current_date`
- `current_time`
- `day_of_week`

---

#### 1.6 Tag Adicionada

```typescript
{
  type: 'trigger',
  name: 'tag.added',
  config: {
    tag_name: string       // 'cliente-vip'
  },
  outputs: 1
}
```

**Dados Disponíveis:**
- `lead.id`
- `tag.name`
- `added_by`
- `added_at`

---

### CATEGORIA 2: MENSAGENS (Messages)

#### 2.1 Enviar WhatsApp

```typescript
{
  type: 'action',
  name: 'send.whatsapp',
  config: {
    message: string        // Texto da mensagem
    variables: boolean     // Usar {{lead.name}}?
    save_to_history: boolean
  },
  inputs: 1,
  outputs: 1
}
```

**Variáveis Disponíveis:**
- `{{lead.name}}`
- `{{lead.phone}}`
- `{{opportunity.value}}`
- `{{user.name}}`
- `{{current_date}}`
- `{{current_time}}`

---

#### 2.2 Enviar com Mídia

```typescript
{
  type: 'action',
  name: 'send.whatsapp.media',
  config: {
    media_type: 'image' | 'video' | 'audio' | 'document'
    media_url: string
    caption?: string
    variables: boolean
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 2.3 Enviar com Botões

```typescript
{
  type: 'action',
  name: 'send.whatsapp.buttons',
  config: {
    message: string
    buttons: Array<{
      id: string
      text: string
      action: 'reply' | 'url' | 'call'
      value: string
    }>
  },
  inputs: 1,
  outputs: number // Um output por botão
}
```

**Exemplo:**
```json
{
  "message": "Qual seu interesse?",
  "buttons": [
    { "id": "btn1", "text": "Produto A", "action": "reply" },
    { "id": "btn2", "text": "Produto B", "action": "reply" },
    { "id": "btn3", "text": "Falar com vendedor", "action": "reply" }
  ]
}
```

---

#### 2.4 Aguardar Resposta

```typescript
{
  type: 'action',
  name: 'wait.response',
  config: {
    timeout_minutes: number  // Tempo máximo de espera
    save_response_to?: string // Campo para salvar
    expected_type?: 'text' | 'number' | 'email' | 'phone'
  },
  inputs: 1,
  outputs: 2 // Respondeu / Timeout
}
```

---

### CATEGORIA 3: AÇÕES CRM (Actions)

#### 3.1 Criar Oportunidade

```typescript
{
  type: 'action',
  name: 'create.opportunity',
  config: {
    title: string
    funnel_id: string
    stage_id: string
    value?: number
    probability?: number
    description?: string
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 3.2 Mover Oportunidade

```typescript
{
  type: 'action',
  name: 'move.opportunity',
  config: {
    to_stage_id: string
    notes?: string
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 3.3 Criar Atividade

```typescript
{
  type: 'action',
  name: 'create.activity',
  config: {
    title: string
    activity_type: string
    scheduled_date: string  // 'today' | 'tomorrow' | '+3 days'
    scheduled_time: string  // '09:00'
    duration_minutes: number
    assigned_to?: string
    description?: string
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 3.4 Atualizar Lead

```typescript
{
  type: 'action',
  name: 'update.lead',
  config: {
    fields: {
      name?: string
      email?: string
      phone?: string
      company_name?: string
      custom_fields?: object
    }
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 3.5 Adicionar Tag

```typescript
{
  type: 'action',
  name: 'add.tag',
  config: {
    tag: string
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 3.6 Atribuir Vendedor

```typescript
{
  type: 'action',
  name: 'assign.owner',
  config: {
    user_id?: string       // ID específico
    method?: 'round_robin' | 'least_busy' | 'by_region'
  },
  inputs: 1,
  outputs: 1
}
```

---

### CATEGORIA 4: LÓGICA (Logic)

#### 4.1 Condição (If/Else)

```typescript
{
  type: 'condition',
  name: 'condition.if',
  config: {
    conditions: Array<{
      field: string          // 'lead.name'
      operator: string       // 'equals', 'contains', '>', '<'
      value: any
      logic?: 'AND' | 'OR'
    }>
  },
  inputs: 1,
  outputs: 2 // True / False
}
```

**Operadores:**
- `equals` - Igual a
- `not_equals` - Diferente de
- `contains` - Contém
- `not_contains` - Não contém
- `greater_than` - Maior que
- `less_than` - Menor que
- `is_empty` - Está vazio
- `is_not_empty` - Não está vazio

**Exemplo:**
```json
{
  "conditions": [
    {
      "field": "opportunity.value",
      "operator": "greater_than",
      "value": 5000,
      "logic": "AND"
    },
    {
      "field": "lead.tags",
      "operator": "contains",
      "value": "vip"
    }
  ]
}
```

---

#### 4.2 Delay (Tempo)

```typescript
{
  type: 'delay',
  name: 'delay.time',
  config: {
    duration: number
    unit: 'minutes' | 'hours' | 'days'
    business_hours_only?: boolean
  },
  inputs: 1,
  outputs: 1
}
```

**Exemplos:**
- 30 minutos
- 2 horas
- 3 dias
- 1 dia (apenas horário comercial)

---

#### 4.3 Randomizer (A/B Test)

```typescript
{
  type: 'randomizer',
  name: 'randomizer.ab',
  config: {
    paths: Array<{
      id: string
      label: string
      weight: number  // Porcentagem (0-100)
    }>
  },
  inputs: 1,
  outputs: number // Um output por path
}
```

**Exemplo:**
```json
{
  "paths": [
    { "id": "a", "label": "Versão A", "weight": 50 },
    { "id": "b", "label": "Versão B", "weight": 50 }
  ]
}
```

---

#### 4.4 Switch (Múltiplos Caminhos)

```typescript
{
  type: 'switch',
  name: 'switch.multiple',
  config: {
    field: string          // Campo para avaliar
    cases: Array<{
      value: any
      label: string
    }>
    default: boolean       // Incluir caminho padrão?
  },
  inputs: 1,
  outputs: number // Um output por case + default
}
```

---

### CATEGORIA 5: DISTRIBUIÇÃO (Distribution)

#### 5.1 Round Robin

```typescript
{
  type: 'action',
  name: 'distribute.round_robin',
  config: {
    users: string[]        // IDs dos vendedores
    skip_unavailable: boolean
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 5.2 Por Disponibilidade

```typescript
{
  type: 'action',
  name: 'distribute.availability',
  config: {
    users: string[]
    max_leads_per_user?: number
    check_online_status: boolean
  },
  inputs: 1,
  outputs: 1
}
```

---

#### 5.3 Por Região

```typescript
{
  type: 'action',
  name: 'distribute.region',
  config: {
    mappings: Array<{
      region: string
      user_id: string
    }>
    default_user_id?: string
  },
  inputs: 1,
  outputs: 1
}
```

---

### CATEGORIA 6: CONTROLE (Control)

#### 6.1 Fim do Fluxo

```typescript
{
  type: 'end',
  name: 'flow.end',
  config: {
    reason?: string
  },
  inputs: 1,
  outputs: 0
}
```

---

#### 6.2 Ir para Outro Fluxo

```typescript
{
  type: 'action',
  name: 'flow.goto',
  config: {
    target_flow_id: string
    pass_context: boolean
  },
  inputs: 1,
  outputs: 0
}
```

---

## 🗄️ ESTRUTURA DE DADOS

### Tabela: automation_flows

```sql
CREATE TABLE automation_flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  
  -- Identificação
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  
  -- Definição do Fluxo
  nodes JSONB NOT NULL,           -- Array de blocos
  edges JSONB NOT NULL,           -- Array de conexões
  variables JSONB,                -- Variáveis customizadas
  
  -- Controle
  is_active BOOLEAN DEFAULT false,
  trigger_type VARCHAR(100) NOT NULL,
  trigger_config JSONB,
  
  -- Limites
  max_executions_per_day INTEGER,
  max_executions_per_lead INTEGER,
  
  -- Horário de Funcionamento
  business_hours_only BOOLEAN DEFAULT false,
  allowed_days_of_week INTEGER[],  -- [1,2,3,4,5]
  start_time TIME,                 -- '08:00'
  end_time TIME,                   -- '18:00'
  
  -- Estatísticas
  execution_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_executed_at TIMESTAMP,
  
  -- Auditoria
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_company FOREIGN KEY (company_id) 
    REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_flows_company ON automation_flows(company_id);
CREATE INDEX idx_automation_flows_active ON automation_flows(is_active);
CREATE INDEX idx_automation_flows_trigger ON automation_flows(trigger_type);
```

---

### Tabela: automation_executions

```sql
CREATE TABLE automation_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES automation_flows(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  
  -- Contexto
  trigger_data JSONB NOT NULL,
  lead_id INTEGER REFERENCES leads(id),
  opportunity_id UUID REFERENCES opportunities(id),
  
  -- Estado
  status VARCHAR(50) NOT NULL,  -- 'running', 'completed', 'failed', 'paused'
  current_node_id VARCHAR(100),
  
  -- Dados de Execução
  variables JSONB,              -- Variáveis durante execução
  executed_nodes JSONB,         -- Histórico de blocos executados
  
  -- Resultado
  error_message TEXT,
  error_node_id VARCHAR(100),
  
  -- Timing
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  paused_at TIMESTAMP,
  resume_at TIMESTAMP,          -- Para delays
  duration_ms INTEGER,
  
  CONSTRAINT fk_flow FOREIGN KEY (flow_id) 
    REFERENCES automation_flows(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_executions_flow ON automation_executions(flow_id);
CREATE INDEX idx_automation_executions_status ON automation_executions(status);
CREATE INDEX idx_automation_executions_lead ON automation_executions(lead_id);
CREATE INDEX idx_automation_executions_resume ON automation_executions(resume_at) 
  WHERE status = 'paused';
```

---

### Tabela: automation_logs

```sql
CREATE TABLE automation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID NOT NULL REFERENCES automation_executions(id),
  flow_id UUID NOT NULL REFERENCES automation_flows(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  
  -- Detalhes do Log
  node_id VARCHAR(100) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  
  -- Resultado
  status VARCHAR(50) NOT NULL,  -- 'success', 'error', 'skipped'
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  
  -- Timing
  executed_at TIMESTAMP DEFAULT NOW(),
  duration_ms INTEGER,
  
  CONSTRAINT fk_execution FOREIGN KEY (execution_id) 
    REFERENCES automation_executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_logs_execution ON automation_logs(execution_id);
CREATE INDEX idx_automation_logs_flow ON automation_logs(flow_id);
CREATE INDEX idx_automation_logs_status ON automation_logs(status);
```

---

### Tabela: automation_templates

```sql
CREATE TABLE automation_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identificação
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  
  -- Template
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,
  trigger_type VARCHAR(100) NOT NULL,
  
  -- Controle
  is_public BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  
  -- Estatísticas
  usage_count INTEGER DEFAULT 0,
  rating DECIMAL(3,2),
  
  -- Metadados
  tags TEXT[],
  preview_image_url TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_automation_templates_category ON automation_templates(category);
CREATE INDEX idx_automation_templates_public ON automation_templates(is_public);
```

---

## 🎨 INTERFACE VISUAL

### Layout Principal

```
┌─────────────────────────────────────────────────────────────────┐
│  [LovoCRM] Automações > Novo Fluxo                    [👤 User] │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────┐  ┌──────────────────────────────────┐  ┌────────┐ │
│  │         │  │                                    │  │        │ │
│  │ SIDEBAR │  │          CANVAS                   │  │ CONFIG │ │
│  │         │  │                                    │  │ PANEL  │ │
│  │ Blocos  │  │   [Área de trabalho infinita]    │  │        │ │
│  │         │  │                                    │  │        │ │
│  │ • Trig  │  │   [Blocos conectados]             │  │        │ │
│  │ • Msg   │  │                                    │  │        │ │
│  │ • Ação  │  │   [Zoom: 100%]                    │  │        │ │
│  │ • Lógic │  │                                    │  │        │ │
│  │         │  │                                    │  │        │ │
│  └─────────┘  └──────────────────────────────────┘  └────────┘ │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  [💾 Salvar] [👁️ Preview] [▶️ Ativar] [📊 Stats] [⚙️ Config]  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Sidebar (Paleta de Blocos)

```
┌─────────────────────────┐
│  🔍 Buscar blocos...    │
├─────────────────────────┤
│                         │
│  📌 GATILHOS            │
│  ├─ 🆕 Novo Lead        │
│  ├─ 💬 Mensagem         │
│  ├─ 💼 Oportunidade     │
│  └─ ⏰ Horário          │
│                         │
│  💬 MENSAGENS           │
│  ├─ 📱 WhatsApp         │
│  ├─ 🖼️ Com Mídia        │
│  └─ 🔘 Com Botões       │
│                         │
│  ⚡ AÇÕES CRM           │
│  ├─ ➕ Criar Oport.     │
│  ├─ ↔️ Mover Oport.     │
│  ├─ 📅 Criar Ativid.    │
│  └─ 🏷️ Adicionar Tag   │
│                         │
│  🔀 LÓGICA              │
│  ├─ ❓ Condição         │
│  ├─ ⏱️ Delay            │
│  └─ 🎲 Randomizer       │
│                         │
│  🎯 DISTRIBUIÇÃO        │
│  ├─ 🔄 Round Robin      │
│  └─ 📍 Por Região       │
│                         │
│  🔚 CONTROLE            │
│  └─ ⏹️ Fim do Fluxo     │
│                         │
└─────────────────────────┘
```

---

### Bloco Visual (Exemplo)

```
┌─────────────────────────────┐
│  📌 Novo Lead Criado        │
├─────────────────────────────┤
│  Quando um novo lead        │
│  entrar no sistema          │
│                             │
│  Filtros: ✓ WhatsApp       │
│           ✓ Tem telefone    │
│                             │
│           [⚙️ Configurar]   │
└──────────────┬──────────────┘
               │
               ▼ Then
```

---

### Painel de Configuração (Exemplo)

```
┌─────────────────────────────────────┐
│  Configurar: Enviar WhatsApp        │
├─────────────────────────────────────┤
│                                     │
│  Mensagem:                          │
│  ┌─────────────────────────────┐   │
│  │ Olá {{lead.name}}!          │   │
│  │                             │   │
│  │ Bem-vindo ao LovoCRM.       │   │
│  │                             │   │
│  │ Como posso te ajudar?       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ☑️ Usar variáveis                  │
│  ☑️ Salvar no histórico             │
│                                     │
│  Variáveis disponíveis:             │
│  • {{lead.name}}                    │
│  • {{lead.phone}}                   │
│  • {{opportunity.value}}            │
│  • {{user.name}}                    │
│                                     │
│  [Cancelar]  [Salvar]               │
└─────────────────────────────────────┘
```

---

## 💻 IMPLEMENTAÇÃO TÉCNICA

### Stack Tecnológico Sugerido

**Frontend:**
- **React** - Framework principal
- **React Flow** - Canvas e blocos
- **Tailwind CSS** - Estilização
- **Zustand** - State management
- **React Hook Form** - Formulários
- **Lucide React** - Ícones

**Backend:**
- **Node.js** - Runtime
- **Supabase** - Banco de dados
- **Edge Functions** - Processamento
- **Cron Jobs** - Agendamentos

---

### Estrutura de Arquivos

```
src/
├── pages/
│   └── Automations.tsx                 # Página principal
│
├── components/
│   └── Automation/
│       ├── FlowBuilder/
│       │   ├── Canvas.tsx              # Canvas principal
│       │   ├── Sidebar.tsx             # Paleta de blocos
│       │   ├── Toolbar.tsx             # Barra de ferramentas
│       │   ├── ConfigPanel.tsx         # Painel de configuração
│       │   └── Minimap.tsx             # Minimap de navegação
│       │
│       ├── Nodes/
│       │   ├── TriggerNode.tsx         # Bloco de gatilho
│       │   ├── ActionNode.tsx          # Bloco de ação
│       │   ├── ConditionNode.tsx       # Bloco de condição
│       │   ├── MessageNode.tsx         # Bloco de mensagem
│       │   ├── DelayNode.tsx           # Bloco de delay
│       │   └── EndNode.tsx             # Bloco de fim
│       │
│       ├── Edges/
│       │   └── CustomEdge.tsx          # Conexão customizada
│       │
│       ├── FlowList.tsx                # Lista de fluxos
│       ├── FlowStats.tsx               # Estatísticas
│       ├── ExecutionHistory.tsx        # Histórico
│       └── TemplateGallery.tsx         # Galeria de templates
│
├── services/
│   └── automation/
│       ├── flowApi.ts                  # API de fluxos
│       ├── executionEngine.ts          # Motor de execução
│       ├── triggerManager.ts           # Gerenciador de gatilhos
│       └── actionExecutor.ts           # Executor de ações
│
├── hooks/
│   ├── useFlowBuilder.ts               # Hook do builder
│   ├── useAutomationFlows.ts          # Hook de fluxos
│   └── useExecutionHistory.ts          # Hook de histórico
│
├── types/
│   └── automation.ts                   # Types TypeScript
│
└── utils/
    └── automation/
        ├── validators.ts               # Validações
        ├── nodeFactory.ts              # Factory de blocos
        └── flowSerializer.ts           # Serialização
```

---

### Types TypeScript

```typescript
// types/automation.ts

export interface FlowNode {
  id: string
  type: 'trigger' | 'action' | 'condition' | 'message' | 'delay' | 'end'
  position: { x: number; y: number }
  data: {
    label: string
    config: Record<string, any>
    icon?: string
    color?: string
  }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  animated?: boolean
  style?: React.CSSProperties
}

export interface AutomationFlow {
  id: string
  company_id: string
  name: string
  description?: string
  category?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  variables?: Record<string, any>
  is_active: boolean
  trigger_type: string
  trigger_config?: Record<string, any>
  max_executions_per_day?: number
  max_executions_per_lead?: number
  business_hours_only: boolean
  allowed_days_of_week?: number[]
  start_time?: string
  end_time?: string
  execution_count: number
  success_count: number
  error_count: number
  last_executed_at?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface AutomationExecution {
  id: string
  flow_id: string
  company_id: string
  trigger_data: Record<string, any>
  lead_id?: number
  opportunity_id?: string
  status: 'running' | 'completed' | 'failed' | 'paused'
  current_node_id?: string
  variables?: Record<string, any>
  executed_nodes?: Array<{
    node_id: string
    executed_at: string
    status: string
    output?: any
  }>
  error_message?: string
  error_node_id?: string
  started_at: string
  completed_at?: string
  paused_at?: string
  resume_at?: string
  duration_ms?: number
}

export interface AutomationLog {
  id: string
  execution_id: string
  flow_id: string
  company_id: string
  node_id: string
  node_type: string
  action: string
  status: 'success' | 'error' | 'skipped'
  input_data?: Record<string, any>
  output_data?: Record<string, any>
  error_message?: string
  executed_at: string
  duration_ms?: number
}
```

---

### Exemplo de Uso do React Flow

```typescript
// components/Automation/FlowBuilder/Canvas.tsx

import React, { useCallback } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection
} from 'reactflow'
import 'reactflow/dist/style.css'

import TriggerNode from '../Nodes/TriggerNode'
import ActionNode from '../Nodes/ActionNode'
import ConditionNode from '../Nodes/ConditionNode'

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode
}

export const Canvas: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Controls />
        <MiniMap />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
    </div>
  )
}
```

---

### Motor de Execução

```typescript
// services/automation/executionEngine.ts

export class AutomationEngine {
  async executeFlow(
    flowId: string,
    triggerData: Record<string, any>
  ): Promise<void> {
    // 1. Buscar fluxo
    const flow = await this.getFlow(flowId)
    
    // 2. Validar se pode executar
    if (!this.canExecute(flow)) {
      return
    }
    
    // 3. Criar execução
    const execution = await this.createExecution(flow, triggerData)
    
    try {
      // 4. Processar blocos sequencialmente
      await this.processNodes(flow, execution)
      
      // 5. Marcar como completo
      await this.completeExecution(execution.id, 'completed')
      
    } catch (error) {
      await this.completeExecution(execution.id, 'failed', error)
    }
  }
  
  private async processNodes(
    flow: AutomationFlow,
    execution: AutomationExecution
  ): Promise<void> {
    // Começar pelo nó trigger
    const startNode = flow.nodes.find(n => n.type === 'trigger')
    if (!startNode) throw new Error('No trigger node found')
    
    // Processar recursivamente
    await this.processNode(startNode, flow, execution)
  }
  
  private async processNode(
    node: FlowNode,
    flow: AutomationFlow,
    execution: AutomationExecution
  ): Promise<void> {
    // Log início
    await this.logNodeExecution(node, execution, 'started')
    
    try {
      // Executar ação do nó
      const result = await this.executeNodeAction(node, execution)
      
      // Log sucesso
      await this.logNodeExecution(node, execution, 'success', result)
      
      // Encontrar próximo nó
      const nextNodes = this.getNextNodes(node, flow, result)
      
      // Processar próximos nós
      for (const nextNode of nextNodes) {
        await this.processNode(nextNode, flow, execution)
      }
      
    } catch (error) {
      await this.logNodeExecution(node, execution, 'error', null, error)
      throw error
    }
  }
  
  private async executeNodeAction(
    node: FlowNode,
    execution: AutomationExecution
  ): Promise<any> {
    switch (node.type) {
      case 'action':
        return await this.executeAction(node, execution)
      case 'message':
        return await this.sendMessage(node, execution)
      case 'condition':
        return await this.evaluateCondition(node, execution)
      case 'delay':
        return await this.scheduleDelay(node, execution)
      default:
        return null
    }
  }
}
```

---

## 🚀 ROADMAP DE DESENVOLVIMENTO

### FASE 1: FUNDAÇÃO (4-6 semanas)

**Semana 1-2: Estrutura Base**
- [ ] Criar estrutura de dados (tabelas Supabase)
- [ ] Implementar types TypeScript
- [ ] Criar página de Automações
- [ ] Implementar lista de fluxos
- [ ] Criar/Editar/Deletar fluxos básicos

**Semana 3-4: Canvas Básico**
- [ ] Integrar React Flow
- [ ] Implementar canvas com zoom/pan
- [ ] Criar sidebar com paleta de blocos
- [ ] Implementar drag & drop básico
- [ ] Criar 3 tipos de blocos iniciais:
  - Trigger (Novo Lead)
  - Action (Enviar WhatsApp)
  - End (Fim)

**Semana 5-6: Execução Básica**
- [ ] Implementar motor de execução
- [ ] Criar sistema de triggers
- [ ] Implementar executor de ações
- [ ] Criar logs de execução
- [ ] Testes básicos

---

### FASE 2: BLOCOS ESSENCIAIS (4-6 semanas)

**Semana 1-2: Gatilhos**
- [ ] Novo Lead Criado
- [ ] Mensagem Recebida
- [ ] Oportunidade Criada
- [ ] Mudança de Etapa
- [ ] Tag Adicionada

**Semana 3-4: Ações CRM**
- [ ] Criar Oportunidade
- [ ] Mover Oportunidade
- [ ] Criar Atividade
- [ ] Atualizar Lead
- [ ] Adicionar/Remover Tag
- [ ] Atribuir Vendedor

**Semana 5-6: Mensagens**
- [ ] Enviar WhatsApp (texto)
- [ ] Enviar com Mídia
- [ ] Enviar com Botões
- [ ] Aguardar Resposta
- [ ] Variáveis dinâmicas

---

### FASE 3: LÓGICA E CONDIÇÕES (3-4 semanas)

**Semana 1-2: Condições**
- [ ] Bloco de Condição (If/Else)
- [ ] Operadores de comparação
- [ ] Múltiplas condições (AND/OR)
- [ ] Condições sobre campos customizados

**Semana 3-4: Controle de Fluxo**
- [ ] Delay (tempo fixo)
- [ ] Smart Delay (horário comercial)
- [ ] Randomizer (A/B test)
- [ ] Switch (múltiplos caminhos)

---

### FASE 4: DISTRIBUIÇÃO (2-3 semanas)

**Semana 1-2: Algoritmos**
- [ ] Round Robin
- [ ] Por Disponibilidade
- [ ] Por Carga de Trabalho
- [ ] Por Região

**Semana 3: Configurações**
- [ ] Configurar equipes
- [ ] Definir regiões
- [ ] Horários de disponibilidade

---

### FASE 5: INTERFACE AVANÇADA (3-4 semanas)

**Semana 1-2: UX**
- [ ] Painel de configuração de blocos
- [ ] Preview de fluxo
- [ ] Validação de fluxo
- [ ] Undo/Redo
- [ ] Copiar/Colar blocos

**Semana 3-4: Gestão**
- [ ] Templates de fluxos
- [ ] Duplicar fluxo
- [ ] Importar/Exportar
- [ ] Histórico de versões

---

### FASE 6: ANALYTICS (2-3 semanas)

**Semana 1-2: Métricas**
- [ ] Dashboard de automações
- [ ] Estatísticas por fluxo
- [ ] Taxa de sucesso/erro
- [ ] Tempo médio de execução
- [ ] Conversão por fluxo

**Semana 3: Visualizações**
- [ ] Gráficos de performance
- [ ] Funil de conversão
- [ ] Heatmap de blocos
- [ ] Relatórios exportáveis

---

### FASE 7: OTIMIZAÇÕES (2-3 semanas)

**Semana 1-2: Performance**
- [ ] Cache de fluxos
- [ ] Processamento em lote
- [ ] Otimização de queries
- [ ] Índices no banco

**Semana 3: Confiabilidade**
- [ ] Retry automático
- [ ] Circuit breaker
- [ ] Rate limiting
- [ ] Monitoramento de erros

---

### FASE 8: RECURSOS AVANÇADOS (4-6 semanas)

**Semana 1-2: Integrações**
- [ ] Webhooks externos
- [ ] HTTP Requests
- [ ] Zapier/Make
- [ ] Google Sheets

**Semana 3-4: IA (Futuro)**
- [ ] AI Step básico
- [ ] Classificação automática
- [ ] Análise de sentimento
- [ ] Sugestões de resposta

**Semana 5-6: Multi-canal (Futuro)**
- [ ] Email
- [ ] SMS
- [ ] Telegram

---

## 📊 CASOS DE USO

### Caso 1: Boas-vindas Automáticas

**Objetivo:** Enviar mensagem de boas-vindas quando novo lead entra

**Fluxo:**
```
[Novo Lead Criado]
    ↓
[Condição: Tem telefone?]
    ↓ Sim
[Enviar WhatsApp: "Olá {{lead.name}}! Bem-vindo!"]
    ↓
[Criar Atividade: "Primeiro contato" +1 dia]
    ↓
[Adicionar Tag: "novo-lead"]
    ↓
[Fim]
```

---

### Caso 2: Follow-up de Proposta

**Objetivo:** Acompanhar lead após envio de proposta

**Fluxo:**
```
[Oportunidade mudou para "Proposta Enviada"]
    ↓
[Enviar WhatsApp: "Proposta enviada! Dúvidas?"]
    ↓
[Delay: 2 dias]
    ↓
[Criar Atividade: "Ligar para discutir proposta"]
    ↓
[Delay: 3 dias]
    ↓
[Condição: Oportunidade ainda em "Proposta Enviada"?]
    ↓ Sim
[Enviar WhatsApp: "Conseguiu analisar?"]
    ↓
[Delay: 5 dias]
    ↓
[Condição: Oportunidade ainda em "Proposta Enviada"?]
    ↓ Sim
[Mover para: "Follow-up Necessário"]
    ↓
[Notificar Gerente]
    ↓
[Fim]
```

---

### Caso 3: Distribuição de Leads

**Objetivo:** Distribuir leads entre vendedores automaticamente

**Fluxo:**
```
[Novo Lead Criado]
    ↓
[Condição: Lead tem empresa?]
    ↓ Sim (B2B)
[Condição: Valor estimado > R$ 10.000?]
    ↓ Sim
[Atribuir: Vendedor Senior (Round Robin)]
    ↓ Não
[Atribuir: Vendedor Junior (Round Robin)]
    ↓
[Criar Oportunidade no Funil]
    ↓
[Enviar Notificação ao Vendedor]
    ↓
[Fim]
```

---

### Caso 4: Reengajamento de Lead Frio

**Objetivo:** Reativar leads inativos

**Fluxo:**
```
[Horário: Segunda-feira 09:00]
    ↓
[Buscar Leads: Sem interação há 30 dias]
    ↓
[Para cada Lead:]
    ↓
[Condição: Tem oportunidade aberta?]
    ↓ Sim
[Enviar WhatsApp: "Olá! Tudo bem? Podemos ajudar?"]
    ↓
[Aguardar Resposta: 48 horas]
    ↓ Respondeu
[Criar Atividade: "Retomar negociação"]
    ↓ Não Respondeu
[Adicionar Tag: "lead-frio"]
    ↓
[Reduzir Probabilidade: -20%]
    ↓
[Fim]
```

---

### Caso 5: Qualificação Automática

**Objetivo:** Qualificar leads através de perguntas

**Fluxo:**
```
[Novo Lead Criado]
    ↓
[Enviar WhatsApp com Botões:]
"Qual seu interesse?"
[Produto A] [Produto B] [Consultoria]
    ↓
[Switch baseado na resposta:]
    ├─ Produto A → [Adicionar Tag: "interesse-produto-a"]
    ├─ Produto B → [Adicionar Tag: "interesse-produto-b"]
    └─ Consultoria → [Adicionar Tag: "interesse-consultoria"]
    ↓
[Enviar WhatsApp: "Qual o orçamento disponível?"]
    ↓
[Aguardar Resposta]
    ↓
[Salvar em: Campo "budget"]
    ↓
[Condição: Budget > R$ 50.000?]
    ↓ Sim
[Atribuir: Vendedor Senior]
[Criar Oportunidade: Valor = Budget]
    ↓ Não
[Atribuir: Vendedor Junior]
[Criar Oportunidade: Valor = Budget]
    ↓
[Fim]
```

---

## 🎯 MÉTRICAS DE SUCESSO

### KPIs do Sistema

**Performance:**
- Tempo médio de execução < 2 segundos
- Taxa de sucesso > 95%
- Uptime > 99.5%

**Adoção:**
- Número de fluxos ativos por empresa
- Número de execuções por dia
- Usuários ativos criando fluxos

**Impacto:**
- Redução de tempo em tarefas manuais
- Aumento na taxa de resposta
- Melhoria na conversão de leads
- Redução no tempo de ciclo de vendas

---

## 🔒 SEGURANÇA E COMPLIANCE

### Controles de Segurança

1. **Isolamento por Empresa**
   - RLS em todas as tabelas
   - Validação de company_id em todas as queries

2. **Validação de Ações**
   - Verificar permissões antes de executar
   - Limitar execuções por dia/lead
   - Rate limiting por empresa

3. **Auditoria**
   - Log completo de todas as execuções
   - Rastreabilidade de ações
   - Histórico de mudanças

4. **LGPD/GDPR**
   - Respeitar opt-out de comunicações
   - Não processar dados de leads excluídos
   - Permitir exportação de dados
   - Direito ao esquecimento

---

## 📚 GLOSSÁRIO

- **Flow (Fluxo):** Sequência de blocos conectados que define uma automação
- **Node (Bloco):** Elemento individual do fluxo (gatilho, ação, condição)
- **Edge (Conexão):** Linha que conecta dois blocos
- **Trigger (Gatilho):** Evento que inicia um fluxo
- **Action (Ação):** Tarefa executada pelo fluxo
- **Condition (Condição):** Decisão que ramifica o fluxo
- **Execution (Execução):** Instância de um fluxo sendo processado
- **Canvas:** Área de trabalho visual onde o fluxo é construído
- **Template:** Fluxo pré-configurado reutilizável

---

## 📝 PRÓXIMOS PASSOS

1. ✅ **Revisar esta documentação** com a equipe
2. ⏳ **Aprovar escopo e prioridades**
3. ⏳ **Definir MVP** (Minimum Viable Product)
4. ⏳ **Criar protótipo** da interface
5. ⏳ **Iniciar Fase 1** do desenvolvimento

---

**Documento criado por:** Cascade AI  
**Para:** LovoCRM - Flow Builder de Automação  
**Baseado em:** Análise do Minichat Flow Builder  
**Data:** 13/03/2026  
**Versão:** 1.0

---

**🚀 Aguardando comando para iniciar o desenvolvimento!**
