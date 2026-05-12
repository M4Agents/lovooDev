# FASE 4.2 — Dual-read Controlado (Plano Técnico)

**Status:** Não iniciado — aguarda readiness FASE 4.1.5  
**Pré-requisito:** critérios de readiness atendidos por 7 dias consecutivos  
**Estimativa:** 1–2 semanas de implementação  
**Referência de readiness:** `get_snapshot_health_score` → `readiness_4_2.ready = true`

---

## Princípio Fundamental (Imutável)

```
Snapshot NUNCA substitui realtime para dados de "hoje".
Realtime é sempre a fonte de verdade operacional.
Snapshot é contexto histórico e comparativo.
```

Esta decisão é arquitetural e não deve ser revertida ou contornada em nenhuma implementação futura.

---

## Objetivo da FASE 4.2

Ativar leitura híbrida em endpoints selecionados do dashboard:

- Para dados **históricos** (D-1 em diante): usar snapshot (mais rápido, menos carga)
- Para dados **atuais** (hoje): continuar com realtime
- Para **comparações WoW/MoM**: usar snapshot exclusivamente
- Para **sparklines e tendências**: usar snapshot exclusivamente

Resultado esperado:
- Redução de carga nas queries realtime principais
- Respostas mais rápidas para dados históricos
- Nenhuma regressão funcional visível ao usuário
- UX idêntica — fallback silencioso quando snapshot ausente

---

## Dual-read Strategy

### Estratégia por Tipo de Dado

| Tipo de dado | Fonte | Fallback |
|---|---|---|
| Pipeline atual (hoje) | Realtime (RPC) | Não se aplica — obrigatório |
| Forecast (hoje) | Realtime (RPC) | Não se aplica — obrigatório |
| Alertas SLA (agora) | Realtime | Não se aplica — obrigatório |
| KPIs de hoje | Realtime | Não se aplica — obrigatório |
| Delta WoW (D-7 vs D-0) | Snapshot | Silencioso: `null` |
| Delta MoM (D-30 vs D-0) | Snapshot | Silencioso: `null` |
| Sparkline 7d | Snapshot | Silencioso: ocultar componente |
| Trendline SLA | Snapshot | Silencioso: ocultar componente |
| Seller deltas WoW | Snapshot | Silencioso: sem badge |

### Modelo de Resposta Híbrida (Padrão para FASE 4.2)

Endpoints híbridos retornam realtime + snapshot em um único response, eliminando round trips duplos no frontend:

```typescript
// Exemplo: endpoint híbrido para ExecutiveSummary
{
  "realtime": {
    "total_leads": 142,
    "conversion_rate": 23.5,
    "avg_ticket": 4200,
    "won_value": 180000
    // dados de hoje via RPC realtime
  },
  "historical": {
    "period": "wow",
    "delta_leads": 8.3,
    "delta_conversion": -1.2,
    "delta_avg_ticket": 5.1,
    "delta_won_value": 12.4,
    "source": "snapshot",
    "snapshot_date": "2026-05-11"
    // deltas via snapshot
  },
  "snapshot_meta": {
    "available": true,
    "fresh": true,
    "days_old": 1
  }
}
```

O frontend usa `realtime` para exibir valores absolutos e `historical` para exibir badges e sparklines.

---

## Endpoints Híbridos — Escopo da FASE 4.2

### Ordem de migração (gradual)

**Sprint 1 — Comparação e Tendências (baixo risco):**
- `GET /api/dashboard/snapshot-comparison` → já é snapshot-only, não requer mudança
- `GET /api/dashboard/snapshot-trends` → já é snapshot-only, não requer mudança
- Ativar feature flags para 100% dos usuários

**Sprint 2 — ExecutiveSummary (risco médio):**
- Novo endpoint híbrido `GET /api/dashboard/executive-summary-v2`
- Substitui lógica de chamar `dashboard-summary` + `snapshot-comparison` separadamente
- Manter `dashboard-summary` inalterado como fallback

**Sprint 3 — SellerRanking com histórico (risco médio):**
- Novo endpoint híbrido `GET /api/dashboard/seller-ranking-v2`
- Incorpora deltas do `snapshot-seller-deltas` na resposta principal
- Manter endpoint atual inalterado

---

## Cache Strategy

### No Backend (Vercel Edge)

Para endpoints de snapshot (dados históricos imutáveis a partir de D-2):

```typescript
res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
// 5 min de cache, 1h de stale-while-revalidate
```

Para dados de hoje (realtime):

```typescript
res.setHeader('Cache-Control', 'no-store');
// Sem cache — sempre fresco
```

### No Frontend

Usar `staleTime` do React Query (ou equivalente com `useEffect` + `useRef`):

- Snapshot trends e comparison: `staleTime: 5 * 60 * 1000` (5 minutos)
- Dados realtime: sem stale time (sempre refetch)

---

## Fallback Automático

### Critérios de Fallback para Snapshot

O frontend (via hooks) deve usar `null` (não exibir badge/sparkline) quando:

1. `snapshot_meta.available === false` — snapshot não existe para o período
2. `snapshot_meta.days_old > 2` — snapshot mais antigo que D-2 (stale)
3. `insufficient_points` — menos de 5 pontos para sparkline
4. HTTP error no endpoint de snapshot

### Comportamento Esperado

| Situação | Comportamento no Frontend |
|---|---|
| Snapshot presente e fresco | Exibe DeltaBadge e sparklines normalmente |
| Snapshot ausente | Badge oculto, valor realtime exibido sem contexto histórico |
| Snapshot stale (> 2 dias) | Badge oculto via `SnapshotDataGuard` com `freshnessOk=false` |
| Erro HTTP | Badge oculto, fallback log disparado, nenhuma mensagem ao usuário |
| < 5 pontos de dados | Sparkline oculto via `SnapshotDataGuard` com `minPoints={5}` |

**Regra de ouro:** O usuário nunca deve ver um erro causado por ausência de snapshot. O pior cenário é ver o KPI sem o badge de comparação histórica.

---

## Feature Flags — Evolução para FASE 4.2

### Flags Atuais (FASE 4.1)

```env
VITE_FEATURE_SNAPSHOT_DELTA=false
VITE_FEATURE_SNAPSHOT_TRENDS=false
VITE_FEATURE_SNAPSHOT_COMPARISON=false
```

### Flags Propostas para FASE 4.2

```env
# Ativar features FASE 4.1 para todos
VITE_FEATURE_SNAPSHOT_DELTA=true
VITE_FEATURE_SNAPSHOT_TRENDS=true
VITE_FEATURE_SNAPSHOT_COMPARISON=true

# Nova flag para dual-read no ExecutiveSummary
VITE_FEATURE_HYBRID_EXECUTIVE_SUMMARY=false

# Nova flag para dual-read no SellerRanking
VITE_FEATURE_HYBRID_SELLER_RANKING=false
```

### Rollout Recomendado

1. Ativar flags FASE 4.1 (`DELTA`, `TRENDS`, `COMPARISON`) globalmente
2. Monitorar fallback rate por 48h
3. Ativar `HYBRID_EXECUTIVE_SUMMARY` em subset de empresas (ex: 10%)
4. Validar health score e fallback rate
5. Expandir para 100% se métricas saudáveis
6. Repetir para `HYBRID_SELLER_RANKING`

---

## Seller Historical Analytics

### Métricas de Histórico por Vendedor (disponíveis em `dashboard_seller_snapshots`)

| Campo | Tipo | Descrição |
|---|---|---|
| `leads_attended` | FLOW | Leads atendidos no período |
| `conversations_opened` | FLOW | Conversas abertas |
| `opportunities_created` | FLOW | Oportunidades criadas |
| `deals_won` | FLOW | Negócios fechados |
| `won_value` | FLOW | Valor ganho |
| `avg_response_min` | STATE | Tempo médio de resposta (minutos) |
| `attendance_rate` | STATE | Taxa de atendimento |

### Análises Possíveis na FASE 4.2

- Ranking histórico: seller A era 2º há 30 dias, hoje é 5º → deterioração
- Seller com melhor consistência (baixa variância WoW)
- Seller com maior crescimento relativo (delta positivo consecutivo)
- Seller com SLA degradando (attendance_rate caindo por 3 semanas)

### Como Consumir no Frontend

```typescript
// Hook proposto para FASE 4.2
const { data: sellerHistory } = useSnapshotSellerHistory({
  companyId,
  sellerIds: topSellers.map(s => s.user_id),
  days: 30,
  enabled: flags.hybridSellerRanking,
});
```

---

## Comparação WoW/MoM — Evolução

### Estado Atual (FASE 4.1)

- Toggle global no header (WoW ou MoM)
- Afeta todos os badges e sparklines simultaneamente
- Estado local no `NewDashboard.tsx`

### Evolução na FASE 4.2

- Toggle pode ser persistido no `localStorage` por usuário
- Badges de comparação podem ter período independente por seção
- Ex: ExecutiveSummary usa MoM enquanto SellerRanking usa WoW
- Implementar sem quebrar toggle global existente

### Períodos Padrão

| Modo | Período atual | Período comparado |
|---|---|---|
| WoW | Últimos 7 dias | 7 dias anteriores (D-14 a D-8) |
| MoM | Últimos 30 dias | 30 dias anteriores (D-60 a D-31) |

Calculados em `src/lib/snapshotPeriods.ts` — manter como fonte única de verdade para períodos.

---

## Trend Strategy

### Sparklines (Dados Atuais)

- Já implementados em FASE 4.1 com `TrendSparkline` (SVG leve)
- FASE 4.2: exibir quando `health_score >= 85` para a empresa
- Gate via `SnapshotDataGuard` com `freshnessOk` consumindo `useSnapshotHealth`

### Trend Charts (Dados Expandidos)

- Já implementados em FASE 4.1 com `TrendChart` (Recharts AreaChart)
- FASE 4.2: expandir para seção dedicada de tendências
- Adicionar anotações de eventos (ex: campanha iniciada, meta alterada)

### Hook `useSnapshotHealth` (Proposto para FASE 4.2)

```typescript
const { data: health, isLoading } = useSnapshotHealth({
  companyId,
  enabled: true,
  // Usado para gate de exibição de features históricas
  // Se health_score < 70 ou fresh = false: desabilitar histórico
});
```

---

## Riscos e Mitigações

| Risco | Descrição | Mitigação |
|---|---|---|
| Discrepância visual realtime vs snapshot | Usuário vê KPI de hoje e delta que não bate | Sempre usar D-1 para delta, nunca D-0 |
| Performance do endpoint híbrido | Await paralelo de RPC realtime + query snapshot pode ser lento | `Promise.all` + cache de snapshot, `withTiming` para monitorar |
| Fallback silencioso mascarar problema real | Taxa de fallback alta sem alerta visível | `fallback_logs` + health score + alertas no Vercel Logs |
| Feature flag desativada em prod | Usuário não vê contexto histórico | Monitorar rollout ativo, documentar como ativar |
| Migração incompleta de endpoint | Dois padrões em produção simultaneamente | Feature flags isolam versões, documentar endpoints v1/v2 |
| Snapshot version mismatch | Fórmula de RPC muda sem atualizar `snapshot_version` | Incrementar `snapshot_version` em toda migration que altera fórmula |

---

## Readiness Requirements (Checklist de Entrada)

Antes de iniciar FASE 4.2, validar:

- [ ] `health_score >= 85` por 7 dias consecutivos
- [ ] `drift_alerts == 0` nos últimos 7 dias
- [ ] `timeout_hit == false` nos últimos 7 dias
- [ ] `fallback_rate < 5%` nos últimos 7 dias
- [ ] `cron success rate >= 98%` nos últimos 14 dias
- [ ] Cobertura de snapshot >= 95% das empresas ativas
- [ ] `readiness_4_2.ready == true` no `get_snapshot_health_score` para > 95% das empresas

**Query de verificação:**

```sql
-- Verificar readiness de todas as empresas ativas
SELECT
  c.id,
  c.name,
  (get_snapshot_health_score(c.id, CURRENT_DATE) ->> 'health_score')::int as score,
  (get_snapshot_health_score(c.id, CURRENT_DATE) -> 'readiness_4_2' ->> 'ready')::boolean as ready
FROM companies c
WHERE c.status = 'active' AND c.deleted_at IS NULL
ORDER BY score ASC;
```

---

## Arquivos Criados/Modificados na FASE 4.2 (Previsão)

```
api/dashboard/executive-summary-v2.ts     # endpoint híbrido (novo)
api/dashboard/seller-ranking-v2.ts        # endpoint híbrido (novo)
src/hooks/dashboard/useSnapshotHealth.ts  # hook health score (novo)
src/hooks/dashboard/useSnapshotSellerHistory.ts  # (novo)
src/pages/NewDashboard.tsx                # flags novas + v2 endpoints
src/components/Dashboard/sections/ExecutiveSummary.tsx  # v2
src/components/Dashboard/sections/SellerRankingSection.tsx  # v2
.env.local                                # novas feature flags
```

**Regra de migração:** Todo endpoint v2 deve ter 100% de comportamento compatível com o v1 quando as flags estão desligadas. Nunca remover v1 enquanto v2 não estiver estável em produção.
