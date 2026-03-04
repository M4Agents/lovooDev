# 📊 FUNIL DE VENDAS - SISTEMA DE OPORTUNIDADES

**Data de Atualização:** 04/03/2026  
**Versão:** 2.0 - Sistema completo com Oportunidades

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Funcionalidades](#funcionalidades)
4. [Gestão de Oportunidades](#gestão-de-oportunidades)
5. [Personalização de Cards](#personalização-de-cards)
6. [Ordenação e Filtros](#ordenação-e-filtros)
7. [Estrutura de Dados](#estrutura-de-dados)
8. [APIs e Serviços](#apis-e-serviços)
9. [Componentes](#componentes)
10. [Migrations](#migrations)

---

## 🎯 VISÃO GERAL

O Funil de Vendas é um sistema Kanban completo para gestão de **oportunidades de negócio**, permitindo visualização, criação, edição e movimentação de oportunidades através de diferentes etapas do processo comercial.

### **Conceitos Principais:**

- **Oportunidade:** Negócio em potencial vinculado a um lead
- **Funil:** Pipeline de vendas com múltiplas etapas
- **Etapa:** Fase do processo comercial (Lead Novo, Contato Realizado, etc.)
- **Card:** Representação visual da oportunidade no Kanban

---

## 🏗️ ARQUITETURA

### **Fluxo de Dados:**

```
Lead (WhatsApp) 
    ↓
Oportunidade Criada
    ↓
Adicionada ao Funil (etapa "Lead Novo")
    ↓
Movimentação entre Etapas (drag & drop)
    ↓
Fechamento (Ganho/Perdido)
```

### **Estrutura de Tabelas:**

```
opportunities
├── id (uuid)
├── lead_id (int) → leads.id
├── company_id (uuid)
├── title (text)
├── value (numeric)
├── status (enum: open, won, lost)
├── probability (int)
├── created_at (timestamp)
└── ...

opportunity_funnel_positions
├── id (uuid)
├── opportunity_id (uuid) → opportunities.id
├── lead_id (int) → leads.id
├── funnel_id (uuid) → funnels.id
├── stage_id (uuid) → funnel_stages.id
├── position_in_stage (int)
└── entered_stage_at (timestamp)

leads
├── id (int)
├── name (text)
├── phone (text)
├── email (text)
├── last_contact_at (timestamp) ← NOVO
└── ...
```

---

## ✨ FUNCIONALIDADES

### **1. CRUD de Oportunidades**

#### **Criar Oportunidade:**
- Modal acessível via botão "+ Novo Lead" ou seção de oportunidades do lead
- Campos obrigatórios: Título, Lead
- Campos opcionais: Descrição, Valor, Probabilidade, Data prevista, Origem
- **Adição automática** ao funil padrão na etapa "Lead Novo"
- **Criação automática de lead** se não existir (via telefone)

#### **Editar Oportunidade:**
- Botão de edição (✏️) em cada card
- Modal pré-preenchido com dados atuais
- Atualização em tempo real no funil

#### **Excluir Oportunidade:**
- Botão de exclusão (🗑️) em cada card
- Confirmação obrigatória antes de excluir
- Remove da posição do funil automaticamente

### **2. Drag & Drop**

- **Movimentação entre etapas:** Arrastar card para outra coluna
- **Reordenação na mesma etapa:** Arrastar para cima/baixo
- **Feedback visual:** Card destaca ao arrastar
- **Histórico automático:** Registra todas as movimentações

### **3. Personalização de Cards**

#### **Campos Disponíveis:**
- ✅ Foto do Lead
- ✅ Nome
- ✅ Email
- ✅ Telefone
- ✅ Empresa
- ✅ Tags
- ✅ Valor do Negócio
- ✅ Origem
- ✅ Status
- ✅ Data de Criação
- ✅ **Último Contato** (NOVO)

#### **Funcionalidades:**
- Selecionar/desselecionar campos
- Salvar preferências por empresa
- Restaurar padrão
- Preferências persistidas no banco de dados

### **4. Ordenação Inteligente**

**Ordenação por Data de Criação da Oportunidade:**
- Mais recentes aparecem primeiro
- Ordenação automática em todas as etapas
- Fallback para `position_in_stage` se não houver data

```typescript
// Lógica de ordenação
return filtered.sort((a, b) => {
  const dateA = a.opportunity?.created_at
  const dateB = b.opportunity?.created_at
  
  if (dateA && dateB) {
    return new Date(dateB).getTime() - new Date(dateA).getTime()
  }
  
  return a.position_in_stage - b.position_in_stage
})
```

### **5. Filtros e Busca**

- **Busca por nome:** Filtra leads em tempo real
- **Busca por email:** Localiza por endereço de email
- **Busca por telefone:** Encontra por número
- **Busca por empresa:** Filtra por nome da empresa

---

## 💼 GESTÃO DE OPORTUNIDADES

### **Ciclo de Vida:**

```
1. CRIAÇÃO
   ├── Via modal de criação
   ├── Automática ao adicionar lead ao funil
   └── Vinculada ao lead existente ou criado

2. MOVIMENTAÇÃO
   ├── Drag & drop entre etapas
   ├── Histórico registrado
   └── Data de entrada na etapa atualizada

3. ATUALIZAÇÃO
   ├── Edição de dados via modal
   ├── Mudança de valor/probabilidade
   └── Atualização de data prevista

4. FECHAMENTO
   ├── Mover para etapa "Ganho" (won)
   ├── Mover para etapa "Perdido" (lost)
   └── Status atualizado automaticamente

5. EXCLUSÃO
   ├── Confirmação obrigatória
   ├── Remove da posição do funil
   └── Registro mantido no banco (soft delete)
```

### **Adição Automática ao Funil:**

Quando uma oportunidade é criada:
1. Busca o funil padrão da empresa
2. Identifica a etapa "Lead Novo" (primeira etapa)
3. Adiciona a oportunidade nessa etapa
4. Define `position_in_stage = 0`
5. Registra `entered_stage_at = now()`

```typescript
// Código de adição automática
const funnels = await funnelApi.getFunnels(company.id)
const defaultFunnel = funnels.find(f => f.is_default) || funnels[0]
const stages = await funnelApi.getStages(defaultFunnel.id)
const firstStage = stages.find(s => s.is_system_stage && s.position === 0) || stages[0]

await funnelApi.addOpportunityToFunnel(
  opportunity.id,
  defaultFunnel.id,
  firstStage.id,
  leadId
)
```

---

## 🎨 PERSONALIZAÇÃO DE CARDS

### **Sistema de Preferências:**

**Tabela:** `lead_card_field_preferences`

```sql
CREATE TABLE lead_card_field_preferences (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID REFERENCES auth.users(id),
  visible_fields JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_user_card_prefs UNIQUE (company_id, user_id)
);
```

### **Salvamento de Preferências:**

```typescript
// Upsert com onConflict
await supabase
  .from('lead_card_field_preferences')
  .upsert({
    company_id: companyId,
    user_id: userId || null,
    visible_fields: visibleFields
  }, {
    onConflict: 'company_id,user_id'  // Atualiza registro existente
  })
```

### **Carregamento de Preferências:**

```typescript
// Busca preferências ao carregar página
const preferences = await funnelApi.getCardPreferences(companyId)
if (preferences?.visible_fields) {
  setVisibleFields(preferences.visible_fields)
}
```

---

## 🔄 ORDENAÇÃO E FILTROS

### **Ordenação Padrão:**

**Por Data de Criação da Oportunidade (DESC):**
- Oportunidades mais recentes aparecem primeiro
- Independente da etapa do funil
- Atualização automática ao criar nova oportunidade

### **Filtros Disponíveis:**

1. **Busca Global:**
   - Nome do lead
   - Email
   - Telefone
   - Nome da empresa

2. **Filtro por Etapa:**
   - Automático (cada coluna = uma etapa)

3. **Filtro por Status:**
   - Aberta (open)
   - Ganha (won)
   - Perdida (lost)

---

## 📊 ESTRUTURA DE DADOS

### **Interface: Opportunity**

```typescript
interface Opportunity {
  id: string
  lead_id: number
  company_id: string
  title: string
  description?: string
  value: number
  currency: string
  status: 'open' | 'won' | 'lost'
  probability: number
  expected_close_date?: string
  actual_close_date?: string
  source?: string
  owner_user_id?: string
  created_at: string
  updated_at: string
  closed_at?: string
  
  // Joins
  lead?: LeadCardData
}
```

### **Interface: OpportunityFunnelPosition**

```typescript
interface OpportunityFunnelPosition {
  id: string
  opportunity_id: string
  lead_id: number
  funnel_id: string
  stage_id: string
  position_in_stage: number
  entered_stage_at?: Date
  updated_at: Date
  
  // Joins
  opportunity?: Opportunity
  lead?: LeadCardData
  stage?: FunnelStage
  days_in_stage?: number
}
```

### **Interface: LeadCardData**

```typescript
interface LeadCardData {
  id: number
  name: string
  email?: string
  phone?: string
  company_name?: string
  tags?: string[]
  origin?: string
  created_at?: Date
  status?: string
  record_type?: string
  last_contact_at?: Date  // NOVO
}
```

---

## 🔌 APIs E SERVIÇOS

### **funnelApi.ts - Principais Métodos:**

#### **Oportunidades:**

```typescript
// Criar oportunidade
createOpportunity(data: CreateOpportunityForm): Promise<Opportunity>

// Atualizar oportunidade
updateOpportunity(id: string, data: UpdateOpportunityForm): Promise<Opportunity>

// Buscar oportunidades por lead
getOpportunitiesByLead(leadId: number, companyId: string): Promise<Opportunity[]>

// Buscar posições das oportunidades no funil
getOpportunityPositions(funnelId: string, filter?: LeadPositionFilter): Promise<OpportunityFunnelPosition[]>
```

#### **Posições no Funil:**

```typescript
// Adicionar oportunidade ao funil
addOpportunityToFunnel(
  opportunityId: string,
  funnelId: string,
  stageId: string,
  leadId?: number
): Promise<OpportunityFunnelPosition>

// Mover oportunidade entre etapas
moveOpportunityToStage(data: {
  opportunity_id: string
  funnel_id: string
  from_stage_id: string
  to_stage_id: string
  position_in_stage: number
}): Promise<void>

// Remover oportunidade do funil
removeOpportunityFromFunnel(
  opportunityId: string,
  funnelId: string
): Promise<void>
```

#### **Preferências:**

```typescript
// Buscar preferências de cards
getCardPreferences(
  companyId: string,
  userId?: string
): Promise<LeadCardFieldPreference | null>

// Atualizar preferências de cards
updateCardPreferences(
  companyId: string,
  visibleFields: string[],
  userId?: string
): Promise<LeadCardFieldPreference>
```

---

## 🧩 COMPONENTES

### **Estrutura de Componentes:**

```
SalesFunnel (Página Principal)
├── FunnelSelector (Seletor de funil)
├── FunnelBoard (Board Kanban)
│   ├── FunnelColumn (Coluna/Etapa)
│   │   └── LeadCard (Card da oportunidade)
│   ├── EditStageModal (Editar etapa)
│   └── AddLeadToFunnelModal (Adicionar lead)
├── CreateFunnelModal (Criar funil)
├── EditFunnelModal (Editar funil)
├── LeadCardCustomizer (Personalizar cards)
└── ChatModalSimple (Chat do lead)
```

### **Componente: LeadCard**

**Arquivo:** `src/components/SalesFunnel/LeadCard.tsx`

**Props:**
```typescript
interface LeadCardProps {
  position: OpportunityFunnelPosition
  index: number
  visibleFields?: string[]
  leadPhotos?: Record<string, string>
  onClick?: (leadId: number) => void
}
```

**Campos Renderizados:**
- Foto do lead (avatar ou foto do WhatsApp)
- Título da oportunidade (💼)
- Nome do lead (👤)
- Email (se visível)
- Telefone (📞)
- Empresa (🏢)
- Valor do negócio (💰)
- Origem (tag)
- **Último contato (📅)** - NOVO
- Tags (🏷️)
- Tempo na etapa (📅)

### **Componente: CreateOpportunityModal**

**Arquivo:** `src/components/SalesFunnel/CreateOpportunityModal.tsx`

**Modos de Operação:**
1. **Criação:** `opportunityData` não fornecido
2. **Edição:** `opportunityData` fornecido

**Props:**
```typescript
interface CreateOpportunityModalProps {
  isOpen: boolean
  onClose: () => void
  leadId: number
  leadName: string
  opportunityData?: any  // Se fornecido, modo edição
  onSuccess?: () => void
}
```

**Funcionalidades:**
- Formulário completo de oportunidade
- Validação de campos obrigatórios
- Formatação automática de valor (BRL)
- Pré-preenchimento em modo edição
- Adição automática ao funil (apenas criação)

---

## 🗄️ MIGRATIONS

### **Migration: add_last_contact_at_to_leads**

**Arquivo:** `supabase/migrations/add_last_contact_at_to_leads.sql`

**Objetivo:** Adicionar campo `last_contact_at` para rastrear última interação com o lead.

**Ações:**
1. Adiciona coluna `last_contact_at` (TIMESTAMP WITH TIME ZONE)
2. Cria índice para performance
3. Popula com dados históricos do chat
4. Adiciona comentário descritivo

**SQL:**
```sql
-- 1. Adicionar coluna
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMP WITH TIME ZONE;

-- 2. Criar índice
CREATE INDEX IF NOT EXISTS idx_leads_last_contact_at 
ON leads(last_contact_at DESC);

-- 3. Popular com dados históricos
UPDATE leads
SET last_contact_at = subquery.last_message_at
FROM (
  SELECT 
    l.id as lead_id,
    MAX(cm.created_at) as last_message_at
  FROM leads l
  INNER JOIN chat_conversations cc 
    ON cc.contact_phone = REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')
  INNER JOIN chat_messages cm 
    ON cm.conversation_id = cc.id
  WHERE l.phone IS NOT NULL AND l.phone != ''
  GROUP BY l.id
) AS subquery
WHERE leads.id = subquery.lead_id;
```

**Resultado:**
- Campo criado com sucesso
- 92 leads populados com dados históricos (21.35%)
- Performance otimizada com índice

---

## 📈 ESTATÍSTICAS E MÉTRICAS

### **Dados Atuais (04/03/2026):**

- **Total de Leads:** 431
- **Leads com Último Contato:** 92 (21.35%)
- **Oportunidades Ativas:** Variável por empresa
- **Funis Configurados:** Múltiplos por empresa

### **Performance:**

- **Carregamento do Funil:** < 2s
- **Drag & Drop:** Instantâneo
- **Salvamento de Preferências:** < 500ms
- **Busca/Filtro:** Tempo real

---

## 🔒 SEGURANÇA

### **RLS (Row Level Security):**

Todas as tabelas possuem políticas RLS ativas:
- `opportunities`: Isolamento por `company_id`
- `opportunity_funnel_positions`: Isolamento por `company_id`
- `lead_card_field_preferences`: Isolamento por `company_id`

### **Validações:**

- Usuário só acessa oportunidades da própria empresa
- Movimentações validadas no backend
- Exclusões com confirmação obrigatória

---

## 🚀 DEPLOY E MANUTENÇÃO

### **Repositório:**
- **Dev:** https://github.com/M4Agents/lovooDev
- **Prod:** https://github.com/M4Agents/loovocrm

### **Deploy Automático:**
- Push para `main` → Deploy automático via Vercel
- Tempo de deploy: ~1-2 minutos

### **Migrations:**
- Executar via Supabase Dashboard (SQL Editor)
- Ou via MCP Supabase (automatizado)

---

## 📝 CHANGELOG

### **Versão 2.0 - 04/03/2026**

**Funcionalidades Adicionadas:**
- ✅ CRUD completo de oportunidades (criar, editar, excluir)
- ✅ Ordenação por data de criação da oportunidade
- ✅ Campo "Último Contato" com dados históricos
- ✅ Personalização de cards com persistência
- ✅ Adição automática ao funil padrão
- ✅ Criação automática de lead via telefone

**Correções:**
- ✅ Erro 404 ao carregar funil (campo inexistente)
- ✅ Preferências não salvando (upsert sem onConflict)
- ✅ Ordenação incorreta (última mensagem → created_at)

**Migrations:**
- ✅ `add_last_contact_at_to_leads.sql`

---

## 🎯 PRÓXIMOS PASSOS

### **Melhorias Planejadas:**

1. **Automações:**
   - Mover automaticamente após X dias
   - Notificações de oportunidades paradas
   - Alertas de follow-up

2. **Relatórios:**
   - Taxa de conversão por etapa
   - Tempo médio em cada etapa
   - Valor total do pipeline

3. **Integrações:**
   - Sincronização com CRM externo
   - Webhooks de movimentação
   - API pública

4. **UX:**
   - Filtros avançados
   - Visualização em lista
   - Exportação para Excel/CSV

---

## 📞 SUPORTE

**Documentação Técnica:** Este arquivo  
**Código Fonte:** `/src/components/SalesFunnel/`  
**APIs:** `/src/services/funnelApi.ts`  
**Migrations:** `/supabase/migrations/`

---

**Última Atualização:** 04/03/2026 às 18:20 (UTC-3)  
**Mantido por:** M4 Digital - Equipe de Desenvolvimento
