# ADR-003 — Health Score dos Snapshots

**Status:** Aceito e em vigor  
**Data:** 2026-05-12  
**Contexto:** Sistema de observabilidade de snapshots (FASE 4.1.5)  
**RPC de referência:** `get_snapshot_health_score(p_company_id, p_reference_date)`

---

## Problema

Com snapshots históricos ativos em produção, era necessário ter uma resposta confiável para a pergunta:

> "Os snapshots desta empresa estão saudáveis o suficiente para confiar nos dados históricos?"

Sem isso, seria impossível:
- Decidir se é seguro ativar dual-read (FASE 4.2)
- Detectar degradação silenciosa antes que afete usuários
- Ter um gate automático de rollout de features

---

## Decisão

Implementar um score composto de saúde (0–100) calculado por empresa por data, exposto via RPC e endpoint de API.

O score é **multidimensional** — nenhuma dimensão sozinha é suficiente para representar saúde real do sistema.

---

## Fórmula do Health Score

```
health_score = round(
  (freshness_score × 0.35) +
  (drift_score × 0.30) +
  (coverage_score × 0.20) +
  (cron_score × 0.15)
)
```

Score final: inteiro entre 0 e 100.

### Componentes e Pesos

| Componente | Peso | O que mede | Como é calculado |
|---|---|---|---|
| `freshness_score` | **35%** | Presença de snapshots recentes | % de snapshots D-1 presentes nos últimos 14 dias |
| `drift_score` | **30%** | Ausência de divergência de dados | 100 se zero alertas drift em 7d; penalidade por alert |
| `coverage_score` | **20%** | Completude de geração por empresa | % de company-days com job de status `success` |
| `cron_score` | **15%** | Confiabilidade do cron global | % de execuções de cron com `status = success` (14d) |

### Por que freshness tem o maior peso (35%)

Freshness é o indicador mais direto de que o sistema está funcionando. Um snapshot desatualizado de 3+ dias invalida qualquer comparação histórica. É o critério mais crítico para o usuário final.

### Por que drift tem peso alto (30%)

Drift indica que os dados dos snapshots divergem da realidade. Um sistema com boa freshness mas alto drift seria perigoso — pareceria saudável mas entregaria dados incorretos.

---

## Severity Levels

| Score | Severity | Significado |
|---|---|---|
| ≥ 85 | `healthy` | Snapshots confiáveis, pronto para FASE 4.2 |
| ≥ 70 | `degraded` | Snapshots funcionando mas com problemas |
| < 70 | `critical` | Snapshots não confiáveis, não exibir histórico |

---

## Drift Policy

### Definição de Drift

```
drift_pct = |snapshot_value - realtime_value| / realtime_value × 100
```

Calculado para a métrica `total_leads` como proxy representativo do snapshot.

### Thresholds de Drift

| Drift | Severity | Ação |
|---|---|---|
| < 2% | `ok` | Normal, esperado por latência de dados |
| 2% – 5% | `warning` | Investigar mas não bloquear |
| > 5% | `critical` | `console.error` no cron, penaliza health score |

### Impacto no `drift_score`

```
drift_score = 100 se drift_alerts_7d == 0
drift_score = max(0, 100 - (drift_alerts_7d × 25)) para alerts warning
drift_score = max(0, 100 - (drift_alerts_7d × 50)) para alerts critical
```

### Sampling Strategy

O cron verifica drift em uma amostra de até 10 empresas por execução. A seleção é determinística por data (hash do `run_date`), garantindo que todas as empresas sejam verificadas ao longo das semanas sem repetição imediata.

---

## Freshness Policy

### Definição de "Fresco"

Um snapshot é considerado fresco quando:
- `period_start` é no máximo D-1 (ontem)
- Existe pelo menos um snapshot com `status = success` para essa data

### Freshness no Health Score

```sql
freshness_score = (
  SELECT COUNT(*) FILTER (WHERE snapshot_exists)
  FROM generate_series(ref_date - 13, ref_date - 1, '1 day') AS d
) / 13.0 × 100
```

### `freshnessOk` no Frontend

O prop `freshnessOk` do `SnapshotDataGuard` deve ser derivado de:

```typescript
freshnessOk = health?.meta?.days_since_last_snapshot <= 1
```

Se `days_since_last_snapshot > 1`: componente histórico oculto silenciosamente.

---

## Fallback Policy

### Quando ocorre fallback

O frontend dispara fallback (fire-and-forget via `reportSnapshotFallback`) quando:
1. Endpoint de snapshot retorna erro HTTP
2. Snapshot ausente para o período solicitado
3. Dados insuficientes (< 5 pontos para sparkline — regra D4)

### O que acontece no frontend

- Badge/sparkline oculto silenciosamente
- Nenhuma mensagem de erro ao usuário
- KPI realtime exibido normalmente sem contexto histórico
- Log registrado em `dashboard_snapshot_fallback_logs`

### Fallback Rate

```
fallback_rate = fallback_logs (últimos 7d) / total_requests_esperados × 100
```

Threshold: `fallback_rate < 5%` para considerar saudável.

---

## Readiness para FASE 4.2

O RPC calcula `readiness_4_2.ready` baseado em critérios estritos:

```json
{
  "ready": true,
  "blockers": []
}
```

### Critérios para `ready = true`

| Critério | Threshold |
|---|---|
| `health_score` | ≥ 85 |
| `drift_alerts_7d` | == 0 |
| `cron_success_rate` (14d) | ≥ 98% |
| `days_since_last_snapshot` | ≤ 1 |
| `freshness_score` | ≥ 90 |

Se qualquer critério falhar, `ready = false` e o bloqueador específico aparece em `blockers[]`.

### Critério Temporal Adicional

Além do RPC, é obrigatório que `readiness_4_2.ready = true` seja mantido por **7 dias consecutivos** antes de iniciar FASE 4.2. O RPC não verifica isso — é uma verificação manual/dashboard do time técnico.

---

## Estrutura Completa da Resposta do RPC

```json
{
  "health_score": 91,
  "severity": "healthy",
  "components": {
    "freshness_score": 96,
    "drift_score": 88,
    "coverage_score": 90,
    "cron_score": 95
  },
  "meta": {
    "snapshots_last_14d": 14,
    "snapshots_expected": 14,
    "drift_alerts_7d": 0,
    "cron_runs_14d": 14,
    "cron_success_14d": 14,
    "last_snapshot_date": "2026-05-11",
    "days_since_last_snapshot": 1
  },
  "readiness_4_2": {
    "ready": true,
    "blockers": []
  },
  "computed_at": "2026-05-12T12:00:00Z"
}
```

---

## Tradeoffs Aceitos

| Tradeoff | Decisão | Justificativa |
|---|---|---|
| Score calculado on-demand (não cached) | Aceito | Usado apenas em admin/monitoring, não em hot path |
| Sampling de 10 empresas (não 100%) | Aceito | Custo vs cobertura — 10 empresas/dia dá cobertura semanal completa |
| Drift medido apenas em `total_leads` | Aceito temporariamente | Proxy suficiente para FASE 4.1.5; expandir em FASE 4.2 |
| Freshness baseada nos últimos 14 dias | Aceito | Janela representativa sem ser muito pequena |

---

## Evolução Futura do Health Score

Em fases futuras, o health score pode ser expandido para incluir:
- Drift de mais métricas além de `total_leads`
- Tempo de execução do cron (P95)
- Fallback rate por empresa
- Cobertura de seller snapshots (não só company-wide)

Quando novos componentes forem adicionados, os pesos devem ser rebalanceados e este ADR atualizado.
