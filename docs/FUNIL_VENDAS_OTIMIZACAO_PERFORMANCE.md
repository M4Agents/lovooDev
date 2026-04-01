# Funil de Vendas — Otimização de Performance e Correções

**Versão:** 3.0  
**Data:** 01/04/2026  
**Autor:** Equipe M4 Digital

---

## Índice

1. [Visão Geral das Mudanças](#visão-geral-das-mudanças)
2. [Correção: Múltiplas Oportunidades por Lead](#correção-múltiplas-oportunidades-por-lead)
3. [Otimização: Fotos via RPC Única](#otimização-fotos-via-rpc-única)
4. [Arquitetura Antes × Depois](#arquitetura-antes--depois)
5. [RPC: get_funnel_positions_with_photos](#rpc-get_funnel_positions_with_photos)
6. [Arquivos Alterados](#arquivos-alterados)
7. [Isolamento Multi-Tenant](#isolamento-multi-tenant)
8. [Impacto de Performance](#impacto-de-performance)

---

## Visão Geral das Mudanças

Esta versão resolve dois problemas críticos do Funil de Vendas:

| Problema | Causa | Solução |
|---|---|---|
| Mover uma oportunidade movia outra do mesmo lead | `draggableId` usava `lead_id` (não único por oportunidade) | `draggableId` agora usa `opportunity_id` (UUID único) |
| Fotos dos leads piscando no Kanban | N+1 queries assíncronas causando re-renders em cascata | Foto incluída diretamente na RPC principal via JOIN |

---

## Correção: Múltiplas Oportunidades por Lead

### Problema

Quando um lead possuía duas ou mais oportunidades no mesmo funil, mover qualquer uma delas no Kanban causava o movimento da **primeira** oportunidade encontrada para aquele lead, independentemente de qual card foi arrastado.

**Causa raiz — três camadas encadeadas:**

**1. `LeadCard.tsx` — identificador não único**
```tsx
// ANTES (bug)
<Draggable draggableId={`lead-${lead.id}`} index={index}>
// lead com 2 oportunidades → 2 cards com o mesmo draggableId "lead-123"
```

**2. `FunnelBoard.tsx` — lookup por lead_id**
```tsx
// ANTES (bug)
const leadId = parseInt(draggableId.replace('lead-', ''))
const currentPosition = positions.find(p => p.lead_id === leadId)
// .find() retorna sempre a primeira oportunidade do lead
```

**3. `useLeadPositions.ts` — mesmo padrão falho**
```ts
// ANTES (bug)
const currentPosition = positions.find(p => p.lead_id === leadId)
// mesmo para moveLeadToStage
```

### Solução

**`LeadCard.tsx`** — `draggableId` único por oportunidade:
```tsx
// DEPOIS (correto)
<Draggable draggableId={`opportunity-${position.opportunity_id}`} index={index}>
```

**`FunnelBoard.tsx`** — lookup direto por `opportunity_id`:
```tsx
// DEPOIS (correto)
const opportunityId = draggableId.replace('opportunity-', '')
const currentPosition = positions.find(p => p.opportunity_id === opportunityId)
await moveOpportunityById(opportunityId, toStageId, newPosition)
```

**`useLeadPositions.ts`** — nova função `moveOpportunityById`:
```ts
// DEPOIS (correto)
const moveOpportunityById = useCallback(async (
  opportunityId: string,
  toStageId: string,
  position: number
): Promise<void> => {
  const currentPosition = positions.find(p => p.opportunity_id === opportunityId)
  // lookup por opportunity_id — sem ambiguidade
  await funnelApi.moveOpportunityToStage({ opportunity_id: opportunityId, ... })
}, [funnelId, positions, fetchPositions])
```

> A query Supabase em `funnelApi.moveOpportunityToStage` já usava `opportunity_id` corretamente — o bug era exclusivamente no lookup do frontend antes de chegar à query.

---

## Otimização: Fotos via RPC Única

### Problema

O `FunnelBoard` carregava as fotos dos leads com o seguinte padrão:

```
1. getOpportunityPositions()          → 1 query (posições + oportunidades + leads)
2. loadLeadPhotos (useEffect)         → 1 chamada chatApi.getContactInfo() POR LEAD

Funil com 50 cards = 51 round-trips ao banco
Funil com 100 cards = 101 round-trips
```

Além disso, o `useEffect` tinha `leadPhotos` como dependência, criando um ciclo de re-renders toda vez que uma foto era carregada. O `forEach(async ...)` sem batching causava múltiplos `setState` independentes — resultando no piscar visível das fotos.

**Duplo `fetchPositions()`:** `moveOpportunityById` chamava `fetchPositions()` internamente E `handleDragEnd` chamava `refreshPositions()` logo depois — dobrando o número de re-fetches por movimento.

### Solução

Foto incluída diretamente na query principal via RPC com JOIN em `chat_contacts`. O chat já usava esse padrão (view `chat_conversations_with_leads`); agora o funil segue o mesmo princípio.

```
ANTES: 1 query + N chamadas chatApi (N = número de cards)
DEPOIS: 1 query única — foto vem no mesmo payload das posições
```

O `useEffect loadLeadPhotos`, o estado `leadPhotos` e o import `chatApi` foram **completamente removidos** do `FunnelBoard`.

---

## Arquitetura Antes × Depois

### Antes

```
FunnelBoard
├── useLeadPositions(funnelId)
│   └── funnelApi.getOpportunityPositions(funnelId)
│       └── PostgREST: positions → opportunities → leads  [1 query]
│
└── useEffect [loadLeadPhotos]  ← dependência de "positions" E "leadPhotos"
    └── para cada lead com telefone:
        └── chatApi.getContactInfo(companyId, phone)
            └── RPC chat_get_contact_info  [1 query por lead]
                └── setLeadPhotos(prev => ...)  ← re-render por foto
```

### Depois

```
FunnelBoard
└── useLeadPositions(funnelId, companyId)
    └── funnelApi.getOpportunityPositions(funnelId, filter, companyId)
        └── RPC get_funnel_positions_with_photos  [1 query única]
            ├── positions → opportunities → leads
            ├── LEFT JOIN chat_contacts (foto por phone normalizado)
            └── LATERAL subquery chat_conversations (conversa mais recente)
```

---

## RPC: get_funnel_positions_with_photos

**Migration:** `supabase/migrations/20260401120000_create_get_funnel_positions_with_photos.sql`

### Assinatura

```sql
get_funnel_positions_with_photos(
  p_funnel_id  UUID,
  p_company_id UUID,
  p_stage_id   UUID DEFAULT NULL   -- opcional: filtrar por etapa
)
RETURNS JSONB
```

### Estrutura retornada

```json
[
  {
    "id": "uuid-da-posição",
    "opportunity_id": "uuid-da-oportunidade",
    "lead_id": 123,
    "funnel_id": "uuid-do-funil",
    "stage_id": "uuid-da-etapa",
    "position_in_stage": 0,
    "entered_stage_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-15T14:30:00Z",
    "opportunity": {
      "id": "uuid",
      "title": "Oportunidade - Lead Exemplo",
      "value": 5000.00,
      "currency": "BRL",
      "status": "open",
      "probability": 60,
      "lead": {
        "id": 123,
        "name": "João Silva",
        "phone": "5511999990000",
        "company_name": "Empresa XYZ",
        "profile_picture_url": "https://pps.whatsapp.net/...",
        "chat_conversations": [{ "id": "uuid-da-conversa" }]
      }
    }
  }
]
```

### Regra de JOIN para foto

```sql
LEFT JOIN chat_contacts cc ON
  REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') = cc.phone_number
  AND l.company_id = cc.company_id
```

`REGEXP_REPLACE` normaliza o telefone do lead (remove `+`, espaços, parênteses) antes de comparar com `chat_contacts.phone_number`, que sempre armazena apenas dígitos. Isso garante o match independente do formato cadastrado no lead.

### Conversa mais recente (para automação)

```sql
LEFT JOIN LATERAL (
  SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
  FROM   chat_conversations cv
  WHERE  cv.contact_phone = REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')
    AND  cv.company_id    = l.company_id
  ORDER  BY cv.last_message_at DESC NULLS LAST
  LIMIT  1
) conv ON true
```

Retorna apenas a conversa mais recente do lead — suficiente para o `triggerManager.onOpportunityStageChanged` identificar o `conversation_id`.

---

## Arquivos Alterados

### `supabase/migrations/20260401120000_create_get_funnel_positions_with_photos.sql`
Nova RPC versionada.

### `src/services/funnelApi.ts`

`getOpportunityPositions` agora aceita `companyId` como terceiro parâmetro:

```ts
async getOpportunityPositions(
  funnelId: string,
  filter?: LeadPositionFilter,
  companyId?: string          // novo
): Promise<OpportunityFunnelPosition[]>
```

- **Com `companyId`:** chama `get_funnel_positions_with_photos` via RPC
- **Sem `companyId`:** usa a query PostgREST original como fallback (sem foto)

### `src/hooks/useLeadPositions.ts`

```ts
// ANTES
export const useLeadPositions = (funnelId: string, filter?: LeadPositionFilter)

// DEPOIS
export const useLeadPositions = (funnelId: string, companyId?: string, filter?: LeadPositionFilter)
```

- Repassa `companyId` para `funnelApi.getOpportunityPositions`
- `moveOpportunityById` não chama mais `fetchPositions()` internamente — o refresh é responsabilidade do `handleDragEnd` via `refreshPositions()`, evitando o duplo fetch

### `src/components/SalesFunnel/FunnelBoard.tsx`

Removidos:
- `import { chatApi }` — sem uso no módulo de funil
- `const [leadPhotos, setLeadPhotos] = useState<Record<string, string>>({})`
- `useEffect loadLeadPhotos` (35 linhas) com o padrão N+1
- Prop `leadPhotos={leadPhotos}` no render de `FunnelColumn`

Adicionado:
- `companyId` passado para `useLeadPositions(funnelId, companyId)`

### `src/components/SalesFunnel/FunnelColumn.tsx`

Removidos da interface `FunnelColumnProps`:
- `leadPhotos?: Record<string, string>`

Removido do render de `LeadCard`:
- `leadPhotos={leadPhotos}`

### `src/components/SalesFunnel/LeadCard.tsx`

Interface — removido `leadPhotos?: Record<string, string>`

Avatar da foto:
```tsx
// ANTES
src={lead.phone ? leadPhotos?.[lead.phone.replace(/\D/g, '')] : undefined}

// DEPOIS
src={lead.profile_picture_url ?? undefined}
```

O campo `profile_picture_url` já existia em `LeadCardData` — nenhuma alteração de tipo necessária.

---

## Isolamento Multi-Tenant

A RPC usa `SECURITY DEFINER` (padrão do sistema) com isolamento explícito em três camadas:

```sql
WHERE ofp.funnel_id = p_funnel_id
  AND o.company_id  = p_company_id   -- layer 1: oportunidades da empresa
  AND l.deleted_at  IS NULL          -- layer 2: excluir leads deletados

-- layer 3: foto apenas do contato da mesma empresa
LEFT JOIN chat_contacts cc ON
  REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') = cc.phone_number
  AND l.company_id = cc.company_id   -- isolamento da foto por company_id
```

`p_company_id` vem sempre do `useAuth()` no frontend — nunca hardcoded, nunca inferido de outra fonte.

---

## Impacto de Performance

| Métrica | Antes | Depois |
|---|---|---|
| Queries por carregamento do funil | 1 + N (N = cards) | 1 |
| Re-renders por foto carregada | 1 por foto (forEach async) | 0 extras |
| Re-fetches por movimentação de card | 2 (duplo fetchPositions) | 1 |
| Dependência circular no useEffect | Sim (leadPhotos na dep array) | Eliminada |
| Import chatApi no FunnelBoard | Sim (acoplamento) | Removido |
| Fotos piscando | Sim | Eliminado |

> Para um funil com 80 cards: de 81 round-trips para 1 ao carregar a tela.
