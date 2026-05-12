# ADR-004 — Dual-read Strategy

**Status:** Planejado — implementação na FASE 4.2  
**Data:** 2026-05-12  
**Contexto:** Evolução do sistema de snapshots para leitura híbrida  
**Pré-requisito:** Critérios de readiness da FASE 4.1.5 atendidos

---

## Problema

Com snapshots históricos validados e saudáveis, o próximo passo natural é usar esses snapshots ativamente nas respostas da API — não apenas como overlay visual (FASE 4.1), mas como fonte real de dados históricos nos endpoints principais.

O desafio é fazer isso sem:
- Introduzir inconsistências entre dados realtime e snapshot
- Criar dependência perigosa de snapshot para dados operacionais
- Afetar performance ou UX em caso de snapshot ausente
- Criar endpoints difíceis de manter com dois paths de leitura

---

## Decisão

**Dual-read gradual e controlado**, onde:
- Realtime é mandatório para dados atuais ("hoje")
- Snapshot é preferido para dados históricos (D-1 em diante)
- Fallback silencioso para realtime quando snapshot ausente ou stale
- Rollout via feature flags por tenant, não global

---

## Princípio Fundamental (Imutável)

```
Snapshot NUNCA substitui realtime para dados de "hoje".
Realtime é sempre a fonte de verdade operacional.
```

Esta decisão não deve ser revertida. Motivações:
1. Snapshot de hoje seria o snapshot de ontem gerado na madrugada — incompleto por definição
2. Usuário operacional precisa de "agora", não de "meia-noite de ontem"
3. Misturar os dois para o mesmo período cria confusão e erros silenciosos

---

## Hierarquia de Fontes por Tipo de Dado

```
┌─────────────────────────────────────┬──────────────┬────────────────────┐
│ Dado                                │ Fonte        │ Fallback           │
├─────────────────────────────────────┼──────────────┼────────────────────┤
│ Pipeline atual (hoje)               │ Realtime     │ Nenhum (obrigatório│
│ Alertas SLA ativos                  │ Realtime     │ Nenhum (obrigatório│
│ Forecast da semana                  │ Realtime     │ Nenhum (obrigatório│
│ KPIs do dia                         │ Realtime     │ Nenhum (obrigatório│
│ Delta WoW / MoM                     │ Snapshot     │ null (ocultar badge│
│ Sparkline 7/30 dias                 │ Snapshot     │ null (ocultar span)│
│ Trendline SLA                       │ Snapshot     │ null (ocultar chart│
│ Seller deltas históricos            │ Snapshot     │ null (sem badge)   │
│ Comparação de pipeline entre meses  │ Snapshot     │ null               │
└─────────────────────────────────────┴──────────────┴────────────────────┘
```

---

## Arquitetura de Endpoints Híbridos

### Padrão v2 (Dual-read)

Endpoints híbridos fazem duas leituras em paralelo e combinam no response:

```typescript
// Exemplo conceitual de endpoint híbrido
export default async function handler(req, res) {
  const [realtimeData, snapshotData] = await Promise.allSettled([
    fetchRealtimeData(companyId),          // RPC realtime
    fetchSnapshotAggregation(companyId),   // query em dashboard_snapshots
  ]);

  return res.json({
    realtime: realtimeData.status === 'fulfilled' ? realtimeData.value : null,
    historical: snapshotData.status === 'fulfilled' ? snapshotData.value : null,
    snapshot_meta: {
      available: snapshotData.status === 'fulfilled',
      fresh: snapshotData.value?.days_old <= 1,
    }
  });
}
```

**Regras de implementação:**
- `Promise.allSettled` — nunca `Promise.all` (não pode bloquear se snapshot falhar)
- Realtime failure = 500 (operacional crítico)
- Snapshot failure = retorna `null` no campo `historical` (não crítico)
- Frontend deve checar `snapshot_meta.available` antes de renderizar histórico

### Compatibilidade com Versões Anteriores

Endpoints v2 coexistem com v1 durante rollout:

```
/api/dashboard/executive-summary      → v1 (apenas realtime, mantido)
/api/dashboard/executive-summary-v2   → v2 (dual-read, ativado via flag)
```

v1 só é removido quando v2 estiver em produção e estável por 30+ dias.

---

## Fallback Silencioso — Comportamento Detalhado

### Quando o frontend deve fazer fallback

1. `snapshot_meta.available === false` → sem snapshot para o período
2. `snapshot_meta.fresh === false` → snapshot mais velho que 2 dias
3. HTTP error no endpoint de snapshot
4. `data.historical === null`
5. Dados insuficientes para sparkline (< 5 pontos)

### O que acontece em cada caso

| Situação | Comportamento | Log |
|---|---|---|
| Snapshot ausente | Badge/sparkline oculto, KPI realtime exibido | `reportSnapshotFallback('missing_data')` |
| Snapshot stale | `SnapshotDataGuard` oculta com `freshnessOk=false` | `reportSnapshotFallback('stale_data')` |
| HTTP error | Badge/sparkline oculto | `reportSnapshotFallback('api_error')` |
| < 5 pontos | Sparkline oculto | `reportSnapshotFallback('insufficient_points')` |

### O que NÃO deve acontecer

- Exibir erro visual ao usuário por ausência de snapshot
- Bloquear renderização de dados realtime por causa de snapshot
- Exibir dados de snapshot com mais de 2 dias como se fossem recentes
- Usar snapshot para dados do dia atual

---

## Critérios de Fallback para Snapshot Stale

Um snapshot é considerado **stale** (degradado/não confiável) quando:

```
days_since_last_snapshot > 2
```

Ou quando o health score do tenant indica:
```
severity === 'critical'  // health_score < 70
```

Nessas condições, `SnapshotDataGuard` com `freshnessOk=false` oculta silenciosamente todos os componentes históricos para aquele tenant.

---

## Cache Strategy para Endpoints Híbridos

### Dados de Snapshot (Histórico Imutável a partir de D-2)

```typescript
// D-2 e anteriores: podem ser cacheados agressivamente
res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
```

### Dados de D-1 (Recalculados pelo Cron)

```typescript
// D-1: cache mais curto (pode ser recalculado)
res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
```

### Dados Realtime (Hoje)

```typescript
// Hoje: sem cache
res.setHeader('Cache-Control', 'no-store');
```

### No Frontend

Para hooks de snapshot, usar `staleTime` equivalente:
- Trends e comparison: `staleTime: 5 * 60 * 1000` (5 minutos)
- Realtime: `staleTime: 0` (sempre refetch)

---

## Feature Flags e Rollout Gradual

### Flags para Dual-read (FASE 4.2)

```env
VITE_FEATURE_HYBRID_EXECUTIVE_SUMMARY=false   # endpoint v2 para ExecutiveSummary
VITE_FEATURE_HYBRID_SELLER_RANKING=false       # endpoint v2 para SellerRanking
```

### Estratégia de Rollout

```
Etapa 1: Ativar flags FASE 4.1 globalmente
         → Monitorar fallback rate por 48h
         → Threshold: fallback < 5%

Etapa 2: Ativar HYBRID_EXECUTIVE_SUMMARY para 10% dos tenants
         → Monitorar health score e fallback rate
         → Threshold: health_score >= 85, fallback < 5%

Etapa 3: Expandir HYBRID_EXECUTIVE_SUMMARY para 100%
         → Monitorar por 7 dias
         → Se estável, prosseguir

Etapa 4: Ativar HYBRID_SELLER_RANKING para 10% dos tenants
         → Repetir ciclo de validação

Etapa 5: Expandir HYBRID_SELLER_RANKING para 100%
```

### Critério de Rollback

Se em qualquer etapa:
- `fallback_rate > 10%` → reverter flag, investigar
- `health_score < 70` para > 5% dos tenants → reverter flag
- Erro visual reportado por usuário → reverter imediatamente

---

## Behavior When Snapshot is Unavailable

| Cenário | Frontend | Backend |
|---|---|---|
| Snapshot de D-1 ainda não gerado (antes das 05:00 UTC) | Badge ausente, sem erro | Retorna `snapshot_meta.available = false` |
| Cron falhou ontem | Badge ausente, sem erro | `days_since_last_snapshot = 2` |
| Cron falhou há 3+ dias | Todos os históricos ocultos | `severity = critical` no health score |
| Snapshot corrompido | Badge ausente, sem erro | Fallback para `null` no campo historical |
| Empresa nova sem histórico | Todos os históricos ocultos | `snapshots_last_14d = 0` |

---

## Tradeoffs e Decisões Explícitas

| Decisão | Alternativa Rejeitada | Justificativa |
|---|---|---|
| Dual-read gradual por feature flag | Migrar todos os endpoints de uma vez | Rollback impossível em produção se houver bug |
| Fallback silencioso (ocultar, não errar) | Exibir mensagem "dado histórico indisponível" | UX ruim para algo que não é erro crítico |
| `Promise.allSettled` em endpoints híbridos | `Promise.all` (falha se qualquer um falhar) | Snapshot não pode derrubar resposta de realtime |
| Manter v1 durante rollout | Remover v1 imediatamente | Segurança para rollback rápido |
| Cache de snapshot em edge | Cache apenas no frontend | Reduz latência para todos os usuários |
| Snapshot exclui D0 definitivamente | Incluir D0 como estimativa | Cria confusão entre parcial e completo |

---

## Consequências para Implementação Futura

1. Todo novo endpoint de snapshot deve seguir o padrão v2 com `snapshot_meta`
2. Hooks de snapshot devem sempre verificar `snapshot_meta.available` e `snapshot_meta.fresh`
3. `SnapshotDataGuard` é a única forma aceitável de gate de renderização histórica
4. Nenhum componente visual pode depender de snapshot sem estar dentro de `SnapshotDataGuard`
5. Qualquer mudança de fórmula de snapshot exige atualização de `snapshot_version`
6. Rollback de feature flag deve ser documentado e testado antes do rollout
