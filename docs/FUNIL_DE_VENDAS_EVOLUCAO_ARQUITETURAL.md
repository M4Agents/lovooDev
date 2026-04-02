# Funil de Vendas — Evolução Arquitetural Completa

**Versão:** 4.0  
**Data:** Abril de 2026  
**Status:** Implementado em dev e produção

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura Final](#arquitetura-final)
3. [Fase 0 — Estado Inicial (Pré-melhoria)](#fase-0--estado-inicial)
4. [Fase 1 — Filtros e Debounce](#fase-1--filtros-e-debounce)
5. [Fase 2 — Filtros Server-Side e Performance](#fase-2--filtros-server-side-e-performance)
6. [Fase 3A — Fundação da Arquitetura por Coluna](#fase-3a--fundação-da-arquitetura-por-coluna)
7. [Fase 3B — Ativação da Nova Arquitetura](#fase-3b--ativação-da-nova-arquitetura)
8. [Fase 4 — Realtime Incremental](#fase-4--realtime-incremental)
9. [Regras de Negócio Adicionais](#regras-de-negócio-adicionais)
10. [Banco de Dados — Migrations e RPCs](#banco-de-dados--migrations-e-rpcs)
11. [Componentes e Hooks — Referência](#componentes-e-hooks--referência)
12. [Bugs Corrigidos](#bugs-corrigidos)
13. [Limitações Conhecidas](#limitações-conhecidas)
14. [Guia de Manutenção](#guia-de-manutenção)

---

## Visão Geral

O funil de vendas evoluiu de um modelo de **fetch global** (carrega todas as oportunidades de todas as colunas de uma vez) para uma **arquitetura escalável por coluna**, capaz de suportar até 100k oportunidades por tenant sem degradação de performance.

### Evolução em números

| Métrica | Antes | Depois |
|---|---|---|
| Queries por abertura do board | N+1 (1 por lead para foto) | 1 RPC global + 1 por coluna |
| Dados carregados na abertura | Todos os leads de todas as colunas | 20 por coluna (paginado) |
| Filtros aplicados | Frontend (após carregar tudo) | Backend (na query SQL) |
| Atualização após DnD | Refetch global | Otimista imediato + refresh cirúrgico |
| Sincronização multi-usuário | Nenhuma | Realtime incremental por coluna |
| Fotos de perfil | URL CDN do WhatsApp (expira) | Supabase Storage (permanente) |

---

## Arquitetura Final

```
SalesFunnel.tsx (página)
│
├── [filtros] searchTerm, selectedOrigin, selectedPeriod (debounced)
│
└── FunnelBoard.tsx (board principal)
    │
    ├── useFunnelStages      → etapas do funil
    ├── useBoardPositions    → posições por coluna (paginado, otimista, refresh cirúrgico)
    ├── useStageCounts       → contadores reais por etapa (servidor)
    ├── useMoveOpportunity   → mutação de movimentação (API + rollback)
    ├── useFunnelRealtime    → subscription Realtime (Fase 4)
    │
    └── FunnelColumn.tsx (por etapa)
        ├── count, totalValue  → do servidor via useStageCounts
        ├── hasMore, loading   → do useBoardPositions
        ├── onLoadMore         → paginação
        └── LeadCard.tsx (por oportunidade)
```

### Fluxo de dados

```
Supabase DB
    │
    ├── get_funnel_stage_counts()    → useStageCounts → FunnelColumn (header)
    ├── get_stage_positions_paged()  → useBoardPositions → FunnelColumn (cards)
    └── opportunity_funnel_positions (Realtime)
            │
            └── useFunnelRealtime → boardRefresh(stageId) → useBoardPositions
```

---

## Fase 0 — Estado Inicial

### Problemas identificados

- **N+1 queries:** Para cada lead no board, uma chamada separada buscava a foto de perfil via `chatApi.getContactInfo()`
- **Fetch global:** `useLeadPositions` carregava todas as oportunidades de todas as etapas em uma única query — inviável com muitos dados
- **Filtros no frontend:** Busca, origem e período eram aplicados em JavaScript após carregar tudo
- **Fotos com URL CDN do WhatsApp:** Expiravam causando erros 403 e imagens piscando
- **Sem sincronização multi-usuário:** Dois usuários no board ao mesmo tempo não viam as movimentações um do outro
- **Bug de DnD:** `draggableId` usava `lead.id`, fazendo com que leads com múltiplas oportunidades movessem todas ao arrastar uma

### Correção do bug de DnD (pré-Fase 1)

**Arquivo:** `src/components/SalesFunnel/LeadCard.tsx`

```tsx
// ANTES (incorreto — não único por oportunidade)
draggableId={`lead-${position.lead_id}`}

// DEPOIS (correto — único por oportunidade)
draggableId={`opportunity-${position.opportunity_id}`}
```

---

## Fase 1 — Filtros e Debounce

**Objetivo:** Correções de baixo risco sem alterar backend.

### Arquivos alterados

- `src/pages/SalesFunnel.tsx`
- `src/components/SalesFunnel/FunnelBoard.tsx`
- `src/hooks/useDebounce.ts` *(novo)*

### O que foi feito

**1. Hook `useDebounce`**

```ts
// src/hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T
```

Evita que cada tecla digitada na busca dispare uma nova query. Delay padrão: 400ms.

**2. Filtros de origem e período conectados**

Os filtros `selectedOrigin` e `selectedPeriod` estavam visíveis mas sem efeito. Foram conectados ao fluxo de dados passando os valores para o `FunnelBoard` e depois para as queries.

**3. Correção do campo de acesso nos filtros**

Os filtros acessavam `pos.lead` (campo inexistente no retorno da RPC). Corrigido para `pos.opportunity?.lead`:

```ts
// ANTES (incorreto)
pos.lead?.name?.toLowerCase()
pos.lead?.origin

// DEPOIS (correto)
pos.opportunity?.lead?.name?.toLowerCase()
pos.opportunity?.lead?.origin
```

**4. Filtro de tags desabilitado visualmente**

O filtro de tags foi mantido visível mas desabilitado com tooltip "Em breve", evitando confusão de UX sem esconder funcionalidade futura.

**5. Remoção de logs de debug**

Logs de console desnecessários removidos de `funnelApi.ts`.

---

## Fase 2 — Filtros Server-Side e Performance

**Objetivo:** Mover busca, origem e período para o banco de dados.

### Migrations criadas

| Arquivo | Objetivo |
|---|---|
| `20260402120000_add_chat_conv_lateral_index.sql` | Índice para otimizar LATERAL JOIN em `chat_conversations` |
| `20260402130000_add_phone_normalized_leads.sql` | Coluna gerada `phone_normalized` em `leads` + índice |
| `20260402140000_update_rpc_funnel_filters.sql` | RPC `get_funnel_positions_with_photos` com filtros server-side |

### Coluna gerada `phone_normalized`

```sql
-- Normaliza telefone removendo caracteres não numéricos
-- Gerada automaticamente pelo banco, sempre atualizada
phone_normalized TEXT GENERATED ALWAYS AS (
  REGEXP_REPLACE(phone, '[^0-9]', '', 'g')
) STORED;
```

**Por que:** Permite JOIN sargable (usa índice) entre `leads.phone_normalized` e `chat_contacts.phone_number`, eliminando `REGEXP_REPLACE` inline na query que impedia uso de índice.

### RPC `get_funnel_positions_with_photos`

**Assinatura:**
```sql
get_funnel_positions_with_photos(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_stage_id    UUID    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INT     DEFAULT NULL
) RETURNS JSONB
```

**Filtros server-side:**
- `p_search`: busca por nome, telefone ou email (ILIKE)
- `p_origin`: filtro exato por `leads.origin`
- `p_period_days`: oportunidades criadas nos últimos N dias

**Ordenação:**
```sql
ORDER BY
  (row_data->>'position_in_stage')::int   ASC,
  (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST
```

O desempate por `entered_stage_at` garante ordenação estável para dados legados com `position_in_stage` duplicado.

### Troca frontend → backend (atômica)

A remoção dos filtros client-side e ativação dos server-side foi feita no mesmo commit para evitar comportamento híbrido (filtrar duas vezes ou não filtrar).

---

## Fase 3A — Fundação da Arquitetura por Coluna

**Objetivo:** Criar a base da nova arquitetura sem ativar ainda no board principal.

### Migrations criadas

| Arquivo | Objetivo |
|---|---|
| `20260403120000_add_get_stage_positions_paged.sql` | RPC paginada por coluna |
| `20260403130000_add_get_funnel_stage_counts.sql` | RPC de contadores por etapa |

### RPC `get_stage_positions_paged`

Busca paginada de oportunidades para uma única etapa.

**Assinatura:**
```sql
get_stage_positions_paged(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INT     DEFAULT NULL,
  p_limit       INT     DEFAULT 20,
  p_offset      INT     DEFAULT 0
) RETURNS JSONB
```

**Isolamento multi-tenant:** `o.company_id = p_company_id` na cláusula WHERE garante que dados de outras empresas nunca aparecem.

**Ordenação:**
```sql
ORDER BY ofp.position_in_stage ASC, ofp.entered_stage_at DESC NULLS LAST
```

### RPC `get_funnel_stage_counts`

Retorna count e total_value para **todas as etapas** de um funil em uma única query.

**Assinatura:**
```sql
get_funnel_stage_counts(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_search      TEXT DEFAULT NULL,
  p_origin      TEXT DEFAULT NULL,
  p_period_days INT  DEFAULT NULL
) RETURNS JSONB
```

**Retorno:** Array JSON `[{ stage_id, count, total_value }, ...]`

> **Atenção de implementação:** A função usa subquery para agrupar por `stage_id`. O `GROUP BY` fica na subquery e o `jsonb_agg` fica no SELECT externo. Isso evita o erro `ERROR 21000: query returned more than one row` que ocorre ao usar `GROUP BY` com `SELECT INTO` no PL/pgSQL (ver [Bug corrigido #2](#bugs-corrigidos)).

```sql
-- Padrão correto (subquery)
SELECT COALESCE(jsonb_agg(stage_data), '[]'::jsonb)
INTO v_result
FROM (
  SELECT jsonb_build_object(...) AS stage_data
  FROM ...
  GROUP BY ofp.stage_id
) subq;
```

### Novos hooks criados

**`src/hooks/useBoardPositions.ts`**

Gerencia o mapa de posições por coluna com paginação e operações otimistas.

```ts
interface UseBoardPositionsReturn {
  stageMap: Map<string, StagePositionState>  // posições por stageId
  loadMore: (stageId: string) => void         // próxima página
  refresh: (stageId?: string) => void         // refresh cirúrgico ou full board
  optimisticMove: (...) => BoardPositionsSnapshot  // atualização otimista DnD
  rollback: (snapshot: BoardPositionsSnapshot) => void  // desfaz se API falhar
}
```

Responsabilidades:
- FAZ: gerenciar mapa de posições, paginação, refresh seletivo, otimismo DnD
- NÃO FAZ: lógica de UI, automações, contadores, addLeadToFunnel

**`src/hooks/useStageCounts.ts`**

Mantém contadores (count + total_value) de todas as etapas sincronizados com os filtros ativos.

```ts
interface UseStageCounts {
  counts: Record<string, StageCount>  // { [stageId]: { count, total_value } }
  loading: boolean
  refresh: () => void
}
```

**`src/hooks/useMoveOpportunity.ts`**

Encapsula a mutação de movimentação (chamada à API) com suporte a rollback.

```ts
const { move, moving } = useMoveOpportunity(companyId)
// move({ opportunityId, fromStageId, toStageId, newPosition })
```

### Atualização aditiva de `FunnelColumn`

Props opcionais adicionadas sem quebrar compatibilidade:

```ts
count?: number      // total real do servidor
totalValue?: number // soma de valores do servidor
hasMore?: boolean   // se há mais cards
onLoadMore?: () => void
loading?: boolean   // carregando próxima página
pageSize?: number   // default 20
```

---

## Fase 3B — Ativação da Nova Arquitetura

**Objetivo:** Substituir o fetch global pelo carregamento por coluna no `FunnelBoard`.

**Escopo:** Apenas `src/components/SalesFunnel/FunnelBoard.tsx`.

### Hooks substituídos

| Antes | Depois |
|---|---|
| `useLeadPositions` (fetch global) | `useBoardPositions` + `useStageCounts` + `useMoveOpportunity` |

### DnD otimista com rollback

```
Usuário arrasta card
    │
    ├── optimisticMove() → atualiza stageMap visualmente (instantâneo)
    ├── move() → chama API
    │   ├── Sucesso → refreshCounts() fire-and-forget
    │   └── Erro    → rollback(snapshot) → restaura estado anterior
    └── recentlyMovedRef.set(opportunityId, Date.now())  ← para deduplicação Realtime
```

**Por que `refreshCounts` sem await:** Evitar rollback falso caso a contagem falhe por problema de rede. Os cards em si já foram movidos com sucesso; o contador desatualizado é aceitável por um breve momento.

### Paginação por coluna

- Carga inicial: 20 oportunidades por coluna em paralelo
- `hasMore = positions.length === pageSize` (heurística simples)
- `loadMore(stageId)` carrega a próxima página via OFFSET
- Ao fazer `refresh(stageId)`, volta ao offset 0 (evita drift)

### Adição de oportunidade ao board (`addLeadToBoard`)

Após inserção, faz refresh cirúrgico apenas da coluna afetada:

```ts
await funnelApi.addOpportunityToFunnel(...)
boardRefresh(targetStageId)   // só a coluna que recebeu
refreshCounts()               // atualiza todos os contadores
```

---

## Fase 4 — Realtime Incremental

**Objetivo:** Sincronizar o board automaticamente quando outro usuário move uma oportunidade.

### Migration criada

**`20260404100000_enable_funnel_positions_realtime.sql`**

```sql
-- Necessário para que eventos UPDATE incluam old.stage_id no payload
ALTER TABLE opportunity_funnel_positions REPLICA IDENTITY FULL;

-- Adiciona a tabela à publicação Realtime do Supabase
ALTER PUBLICATION supabase_realtime ADD TABLE opportunity_funnel_positions;
```

> **Por que `REPLICA IDENTITY FULL`:** Sem isso, eventos `UPDATE` no Realtime incluem apenas os campos novos (`new`). Com `FULL`, o payload também inclui os campos antigos (`old`), permitindo identificar a coluna de origem em movimentações cross-stage sem fetch adicional.

### Hook `useFunnelRealtime`

```ts
useFunnelRealtime(
  funnelId,         // escopo da subscription
  companyId,        // pré-condição de segurança
  enabled,          // feature flag (FUNNEL_REALTIME_ENABLED)
  onStagesAffected, // callback com IDs das colunas afetadas
  onCountsChanged,  // callback para atualizar contadores
  recentlyMovedRef  // Map para deduplicação de eventos próprios
)
```

### Isolamento multi-tenant no Realtime

O canal filtra por `funnel_id=eq.${funnelId}`. Além disso, o RLS do Supabase aplica a policy `SELECT` de `opportunity_funnel_positions` antes de despachar qualquer evento — apenas rows onde o funil pertence à empresa do JWT chegam ao cliente.

### Deduplicação de eventos próprios

Problema: quando o usuário A move um card, a API confirma a mudança E o Realtime também notifica. Sem deduplicação, o board recarregaria desnecessariamente e poderia causar flash visual.

Solução: `recentlyMovedRef` é um `Map<opportunityId, timestamp>`. Após cada `move()` bem-sucedido, o `opportunityId` é registrado com o timestamp atual. Eventos Realtime para o mesmo `opportunityId` dentro de 3 segundos são ignorados.

```ts
// Em FunnelBoard após move() bem-sucedido:
recentlyMovedRef.current.set(opportunityId, Date.now())
setTimeout(() => recentlyMovedRef.current.delete(opportunityId), 6_000)
```

> **Limitação conhecida:** Se outro usuário mover o **mesmo card** dentro de 3s após uma movimentação local, o evento será ignorado. O banco sempre tem o estado correto; a inconsistência é apenas visual e dura no máximo 3s.

### Sincronização ao retornar para a aba

```ts
// Page Visibility API — refresca ao voltar para a aba
useEffect(() => {
  if (!FUNNEL_REALTIME_ENABLED) return
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      boardRefresh()    // refresca todas as etapas não-ocultas
      refreshCounts()
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)
  return () => document.removeEventListener('visibilitychange', handleVisibility)
}, [boardRefresh, refreshCounts])
```

### Feature flag de emergência

```ts
// src/components/SalesFunnel/FunnelBoard.tsx
const FUNNEL_REALTIME_ENABLED = true

// Para desabilitar Realtime imediatamente sem rollback de código:
// 1. Alterar para false
// 2. Commit + deploy
// O Realtime é desabilitado sem afetar nenhuma outra funcionalidade
```

---

## Regras de Negócio Adicionais

### Inserção automática no topo da etapa

**Migration:** `20260405120000_add_position_shift_on_opportunity_insert.sql`

Toda nova oportunidade inserida em `opportunity_funnel_positions` entra automaticamente na **posição 0** (topo) da etapa, deslocando as demais para baixo.

**Implementação via trigger BEFORE INSERT:**

```sql
CREATE OR REPLACE FUNCTION shift_positions_on_opportunity_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Desloca todas as oportunidades da mesma etapa para baixo
  UPDATE opportunity_funnel_positions
  SET    position_in_stage = position_in_stage + 1
  WHERE  funnel_id = NEW.funnel_id
    AND  stage_id  = NEW.stage_id;

  -- Força posição 0 independentemente do valor passado pelo caller
  NEW.position_in_stage := 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shift_positions_before_opportunity_insert
  BEFORE INSERT ON opportunity_funnel_positions
  FOR EACH ROW
  EXECUTE FUNCTION shift_positions_on_opportunity_insert();
```

**Caminhos cobertos automaticamente:**
- Webhook WhatsApp (novo lead → nova oportunidade)
- Modal do board (adicionar oportunidade manualmente)
- Hook legado `useLeadPositions`
- Qualquer futuro INSERT em `opportunity_funnel_positions`

**Garantias:**
- DnD não é afetado (trigger só dispara em INSERT; DnD usa UPDATE)
- Histórico de etapa não é afetado (`track_opportunity_stage_movement` só registra quando `OLD.stage_id != NEW.stage_id`)
- Realtime continua funcionando (INSERT gera evento INSERT normalmente)
- Contadores não mudam (trigger só altera `position_in_stage`, não conta linhas)
- Isolamento multi-tenant garantido (shift filtrado por `funnel_id + stage_id`)

### Correção do título da oportunidade

**Arquivo:** `src/hooks/useLeadPositions.ts`

```ts
// ANTES (incorreto — prefixo desnecessário)
title: `Oportunidade - ${lead.name}`

// DEPOIS (correto — apenas o nome do lead)
title: lead.name
```

Oportunidades criadas automaticamente (webhook) e manualmente usam apenas o nome do lead como título.

---

## Banco de Dados — Migrations e RPCs

### Índices criados

```sql
-- Otimiza LATERAL JOIN em chat_conversations (Fase 2)
CREATE INDEX IF NOT EXISTS idx_chat_conv_contact_company_last
  ON chat_conversations(contact_phone, company_id, last_message_at DESC);

-- Otimiza JOIN de foto com phone_normalized (Fase 2)
CREATE INDEX IF NOT EXISTS idx_leads_phone_normalized_company
  ON leads(phone_normalized, company_id);
```

### Tabela `opportunity_funnel_positions` — triggers ativos

| Trigger | Tipo | Função | Propósito |
|---|---|---|---|
| `shift_positions_before_opportunity_insert` | BEFORE INSERT | `shift_positions_on_opportunity_insert()` | Insere no topo, desloca demais |
| `track_opportunity_stage_movement` | AFTER UPDATE | `record_lead_stage_movement()` | Registra histórico de mudança de etapa |
| `update_opportunity_funnel_positions_updated_at` | BEFORE UPDATE | `update_updated_at_column()` | Atualiza `updated_at` automaticamente |

### RPCs ativas no banco

| RPC | Fases | Propósito |
|---|---|---|
| `get_funnel_positions_with_photos` | 2+ | Fetch global (fallback) com filtros server-side |
| `get_stage_positions_paged` | 3A+ | Fetch paginado por coluna (arquitetura principal) |
| `get_funnel_stage_counts` | 3A+ | Contadores reais por etapa |
| `create_lead_from_whatsapp_safe` | pré-Fase 1 | Criação atômica de lead + oportunidade + posição no funil via webhook |

---

## Componentes e Hooks — Referência

### `FunnelBoard.tsx`

**Props:**
```ts
interface FunnelBoardProps {
  funnelId: string
  visibleFields?: string[]
  onLeadClick?: (leadId: number) => void
  searchTerm?: string       // debounced em SalesFunnel.tsx
  selectedOrigin?: string
  selectedPeriod?: string
}
```

**Hooks internos:**
```ts
useFunnelStages(funnelId, companyId)
useBoardPositions(funnelId, stages, companyId, filter, pageSize=20)
useStageCounts(funnelId, companyId, filter)
useMoveOpportunity(companyId)
useFunnelRealtime(funnelId, companyId, FUNNEL_REALTIME_ENABLED, ...)
```

### `FunnelColumn.tsx`

**Props relevantes para paginação:**
```ts
count?: number       // total real do servidor (useStageCounts)
totalValue?: number  // soma de valores do servidor
hasMore?: boolean    // se há mais cards além dos carregados
onLoadMore?: () => void
loading?: boolean    // carregando próxima página
pageSize?: number    // default 20
```

**Variáveis de paginação calculadas internamente:**
```ts
const loadedCount    = leads.length
const remainingCount = Math.max(0, displayCount - loadedCount)
const nextLoadCount  = Math.min(remainingCount, pageSize)
const isLastPage     = nextLoadCount < pageSize
```

**Estados do footer de paginação:**
- `hasMore + !loading + !isLastPage` → `"Carregar mais N"`
- `hasMore + !loading + isLastPage`  → `"Carregar N restantes"`
- `hasMore + loading`                → `"Carregando..."` (botão desabilitado)
- `!hasMore`                         → sem footer

### `useBoardPositions.ts`

```ts
interface StagePositionState {
  positions: OpportunityFunnelPosition[]
  loading: boolean
  hasMore: boolean   // positions.length === pageSize
  page: number       // página atual (base 0)
}
```

**Heurística `hasMore`:** `positions.length === pageSize`. Se a etapa tem exatamente múltiplos de 20 itens, `hasMore` será `true` mesmo sem mais páginas. O clique extra resultará em 0 registros e `hasMore` passará para `false`.

### `useFunnelRealtime.ts`

Cria um canal Supabase Realtime filtrado por `funnel_id`. Não modifica estado diretamente — emite callbacks para o `FunnelBoard` que decide quais colunas atualizar.

---

## Bugs Corrigidos

### Bug 1 — Múltiplas oportunidades movendo juntas no DnD

**Causa:** `draggableId` usava `lead.id`, não único quando um lead tem múltiplas oportunidades.  
**Fix:** Mudado para `opportunity-${position.opportunity_id}`.  
**Arquivo:** `LeadCard.tsx`

### Bug 2 — RPC `get_funnel_stage_counts` retornando HTTP 400

**Causa:** O SQL original usava `GROUP BY stage_id` dentro de `SELECT ... INTO v_result`. Com múltiplos grupos, o PL/pgSQL falha com `ERROR 21000: query returned more than one row`. A função era criada sem erro (PL/pgSQL compila o corpo lazily) mas falhava em toda chamada.  
**Sintoma:** `counts` sempre `undefined` → `displayCount = leads.length` → "Carregar 0 restantes".  
**Fix:** `GROUP BY` movido para subquery; `jsonb_agg` aplicado no SELECT externo.  
**Migration:** `20260405140000_fix_get_funnel_stage_counts.sql`

### Bug 3 — "Carregar 0 restantes" mesmo com mais oportunidades

**Causa:** Consequência direta do Bug 2. Com `count = undefined`, `displayCount = leads.length`, então `remainingCount = 0`.  
**Fix:** Corrigido ao resolver o Bug 2.

### Bug 4 — Fotos piscando no funil (N+1 + CDN expirado)

**Causa:** N+1 queries para buscar foto + URLs CDN do WhatsApp expirando (403).  
**Fix:** RPC com foto embutida via JOIN em `chat_contacts.profile_picture_url` + sistema de armazenamento permanente no Supabase Storage (`contact-avatars`).  
**Arquivos:** `funnelApi.ts`, `api/webhook/uazapi/[company_id].js`, `lib/photoSync.cjs`

### Bug 5 — Filtros de busca e origem acessando campo inexistente

**Causa:** Filtros client-side acessavam `pos.lead` em vez de `pos.opportunity?.lead`.  
**Fix:** Corrigido os acessos nos filtros de `FunnelBoard.tsx`.

### Bug 6 — Overload acidental de RPC

**Causa:** `CREATE OR REPLACE FUNCTION` com assinatura diferente (parâmetros a mais/menos) cria uma nova sobrecarga em vez de substituir a existente no PostgreSQL.  
**Fix:** Sempre usar `DROP FUNCTION` explícito antes de recriar RPCs com assinaturas alteradas.

### Bug 7 — Oportunidades criadas com prefixo "Oportunidade -"

**Causa:** Título hardcoded como `` `Oportunidade - ${lead.name}` `` no hook.  
**Fix:** Mudado para `lead.name` diretamente.  
**Arquivo:** `useLeadPositions.ts`

---

## Limitações Conhecidas

### Paginação com LIMIT/OFFSET

Em cenários de alta concorrência (cards adicionados/removidos enquanto o usuário está paginando), o OFFSET pode gerar drift — gaps (card ignorado) ou duplicatas (card aparecendo duas vezes). Para o volume atual, isso é aceitável. O `refresh(stageId)` volta ao offset 0 como mitigação.

**Evolução futura:** Cursor-based pagination usando `position_in_stage` como cursor.

### Deduplicação de eventos Realtime

Janela de deduplicação de 3 segundos. Se outro usuário mover o **mesmo card** dentro desse janela após uma movimentação local, o evento será silenciado. O banco sempre tem o estado correto; a inconsistência é apenas visual e temporária.

### `hasMore` heurístico

`positions.length === pageSize` pode gerar um clique "em vão" quando a etapa tem exatamente múltiplos de 20 itens. O usuário clica, a query retorna 0 resultados, e `hasMore` passa para `false`. Não é um bug, apenas UX levemente subótima.

### RLS e Realtime

O filtro de canal (`funnel_id=eq.${funnelId}`) é aplicado no Supabase. O RLS aplica a policy `SELECT` de `opportunity_funnel_positions` antes de despachar eventos. A combinação garante isolamento multi-tenant, mas assume que as policies estão corretamente configuradas.

---

## Guia de Manutenção

### Desabilitar Realtime em emergência

```ts
// src/components/SalesFunnel/FunnelBoard.tsx — linha ~32
const FUNNEL_REALTIME_ENABLED = false  // ← mudar para false
```

Commit + deploy. Nenhum dado é perdido. O board continua funcionando normalmente sem sincronização automática.

### Alterar tamanho de página padrão

```ts
// src/components/SalesFunnel/FunnelBoard.tsx
const { stageMap, loadMore, refresh } = useBoardPositions(
  funnelId, stages, companyId, filter,
  20  // ← pageSize, alterar aqui
)
```

E também atualizar a prop `pageSize` passada ao `FunnelColumn`:
```tsx
<FunnelColumn ... pageSize={20} />
```

### Adicionar novo filtro server-side

1. Adicionar parâmetro nas RPCs `get_stage_positions_paged` e `get_funnel_stage_counts` (via nova migration)
2. Adicionar campo em `LeadPositionFilter` (`src/types/sales-funnel.ts`)
3. Passar o campo nos métodos `funnelApi.getStagePositionsPaged()` e `funnelApi.getStageCounts()`
4. Passar o valor de `SalesFunnel.tsx` → `FunnelBoard.tsx` → filtro memoizado

### Atualizar ou recriar uma RPC existente

⚠️ Se a **assinatura** (parâmetros) mudar, **nunca** usar apenas `CREATE OR REPLACE`. Isso cria uma sobrecarga.

```sql
-- CORRETO: dropar explicitamente antes de recriar com nova assinatura
DROP FUNCTION IF EXISTS nome_da_rpc(tipo1, tipo2, tipo3);
CREATE OR REPLACE FUNCTION nome_da_rpc(...nova assinatura...) ...
```

### Verificar saúde das RPCs no banco

```sql
-- Confirmar assinaturas sem overload
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc
WHERE proname IN (
  'get_funnel_positions_with_photos',
  'get_stage_positions_paged',
  'get_funnel_stage_counts',
  'shift_positions_on_opportunity_insert'
)
AND pronamespace = 'public'::regnamespace;

-- Confirmar triggers em opportunity_funnel_positions
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'opportunity_funnel_positions'::regclass
  AND NOT tgisinternal;

-- Testar get_funnel_stage_counts (deve retornar array com counts reais)
SELECT get_funnel_stage_counts(
  '<funnel_id_uuid>',
  '<company_id_uuid>'
);
```

### Estrutura de arquivos do funil

```
src/
├── pages/
│   └── SalesFunnel.tsx              # Página principal, filtros, debounce
├── components/SalesFunnel/
│   ├── FunnelBoard.tsx              # Board Kanban (Fases 1-4)
│   ├── FunnelColumn.tsx             # Coluna com paginação UX
│   ├── LeadCard.tsx                 # Card de oportunidade
│   ├── AddLeadToFunnelModal.tsx     # Modal de adição
│   └── EditStageModal.tsx           # Modal de edição de etapa
├── hooks/
│   ├── useDebounce.ts               # Fase 1
│   ├── useBoardPositions.ts         # Fase 3A — posições por coluna
│   ├── useStageCounts.ts            # Fase 3A — contadores por etapa
│   ├── useMoveOpportunity.ts        # Fase 3A — mutação de DnD
│   ├── useFunnelRealtime.ts         # Fase 4 — Realtime
│   ├── useFunnelStages.ts           # Etapas do funil
│   └── useLeadPositions.ts          # Hook legado (mantido para compatibilidade)
├── services/
│   └── funnelApi.ts                 # Todas as chamadas ao Supabase do funil
└── types/
    └── sales-funnel.ts              # Todos os tipos TypeScript do funil

supabase/migrations/
├── 20260401120000_create_get_funnel_positions_with_photos.sql  # Fase 2 base
├── 20260401190000_protect_stable_photo_url_in_webhook.sql      # Foto estável
├── 20260402120000_add_chat_conv_lateral_index.sql              # Fase 2
├── 20260402130000_add_phone_normalized_leads.sql               # Fase 2
├── 20260402140000_update_rpc_funnel_filters.sql                # Fase 2
├── 20260403120000_add_get_stage_positions_paged.sql            # Fase 3A
├── 20260403130000_add_get_funnel_stage_counts.sql              # Fase 3A
├── 20260404100000_enable_funnel_positions_realtime.sql         # Fase 4
├── 20260405120000_add_position_shift_on_opportunity_insert.sql # Regra de negócio
└── 20260405140000_fix_get_funnel_stage_counts.sql              # Fix Bug 2
```

---

*Documentação gerada em abril de 2026. Atualizar sempre que novas fases ou correções forem implementadas.*
