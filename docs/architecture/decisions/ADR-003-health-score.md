# ADR-003 — Health Score dos Snapshots

**Status:** Aceito e em vigor  
**Data:** 2026-05-12 | **Atualizado:** 2026-06-09 (Sprint 0.5)  
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
  (drift_score     × 0.30) +
  (coverage_score  × 0.20) +
  (cron_score      × 0.15)
) × 100
```

Score final: numérico entre 0.0 e 100.0.

### Componentes e Pesos

| Componente | Peso | O que mede | Como é calculado |
|---|---|---|---|
| `freshness_score` | **35%** | Presença de snapshots recentes | D-1 → 1.0 / D-2 → 0.7 / D-3 → 0.3 / sem snapshot → 0.0 |
| `drift_score` | **30%** | Ausência de divergência de dados | Último log de drift: <2% → 1.0 / <5% → 0.7 / <10% → 0.3 / ≥10% → 0.0 |
| `coverage_score` | **20%** | Completude de geração nos últimos 30 dias | ≥95% dias → 1.0 / ≥85% → 0.7 / ≥70% → 0.3 / <70% → 0.0 |
| `cron_score` | **15%** | Confiabilidade do cron global | Taxa completed/total em 7 dias: ≥98% → 1.0 / ≥90% → 0.7 / ≥80% → 0.3 / <80% → 0.0 |

### Benefício da dúvida (sem dados)

Se uma dimensão não tiver dados suficientes ainda:
- `drift_score = 0.8` quando sem logs de drift
- `cron_score = 0.8` quando sem execuções registradas

---

## Severity Levels

| Score | Severity | Significado |
|---|---|---|
| ≥ 85 | `healthy` | Snapshots confiáveis (aplicado apenas a tenants maduros) |
| ≥ 65 | `degraded` | Snapshots funcionando mas com problemas |
| ≥ 40 | `warning` | Problemas moderados que requerem atenção |
| < 40 | `critical` | Snapshots não confiáveis |

**Nota:** A severidade reflete sempre o score numérico. A classificação final (`classification`) é quem determina o comportamento do sistema.

---

## Dimensão de Maturidade (Sprint 0.5)

### Problema identificado

O `health_score` penaliza empresas novas pelo `coverage_score` (poucos dias de histórico nos últimos 30 dias). Uma empresa com 5 dias de existência nunca poderia atingir `coverage_score >= 0.95`, resultando em `health_score < 85` — não por falha operacional, mas por ausência natural de histórico.

Isso criava um problema: empresas novas bloqueavam métricas de readiness da plataforma, mesmo que todas as empresas maduras estivessem saudáveis.

### Solução: dimensão ortogonal de maturidade

Um tenant é **maduro** quando tem **≥ 30 dias de snapshots históricos** (janela de cobertura completa).

```
mature: days_of_history >= 30
new:    days_of_history < 30
```

Empresas novas são classificadas como `insufficient_history` — uma condição esperada, não uma falha.

---

## Classificação Consolidada (`classification`)

O campo `classification` combina maturidade e score em uma única classificação acionável:

| Classificação | Condição | Significado | Ação |
|---|---|---|---|
| `healthy` | Maduro + score ≥ 85 | Snapshots confiáveis | Pronto para FASE 4.2 |
| `insufficient_history` | Novo (< 30 dias) | Histórico insuficiente — normal | Realtime apenas; widgets históricos ocultos |
| `degraded` | Maduro + 65 ≤ score < 85 | Problema operacional moderado | Investigar; não ativar dual-read |
| `critical` | Maduro + score < 65 | Problema operacional grave | Não usar histórico; escalar |

### Regra fundamental

> **Empresa nova não é empresa com problema.**

`insufficient_history` não é degradação — é o estado natural de um tenant recém-criado que ainda não acumulou o histórico mínimo para comparações confiáveis.

---

## Readiness para FASE 4.2

### Critério por tenant

Um tenant está pronto para FASE 4.2 quando:
- `classification == 'healthy'`

Um tenant com `insufficient_history` nunca está pronto para FASE 4.2 (ainda), mas isso é um estado temporário esperado, não um bloqueador operacional.

### Critério de plataforma

A FASE 4.2 pode ser liberada (gradualmente, por tenant) quando:

```
>= 80% dos tenants MADUROS estão 'healthy'
```

**Tenants com `insufficient_history` são EXCLUÍDOS do denominador.**

Isso evita que novas empresas (em onboarding) bloqueiem a evolução da plataforma para empresas maduras e saudáveis.

### Critério temporal adicional

Além do critério por score, é obrigatório que os tenants alvo mantenham `classification = 'healthy'` por **7 dias consecutivos** antes da ativação da FASE 4.2. O RPC não verifica isso — é uma verificação manual/dashboard do time técnico.

---

## Estrutura Completa da Resposta do RPC

```json
{
  "company_id": "uuid",
  "reference_date": "2026-06-09",
  "health_score": 100.0,
  "severity": "healthy",
  "classification": "healthy",
  "maturity": {
    "status": "mature",
    "days_of_history": 156,
    "threshold_days": 30
  },
  "components": {
    "freshness": {
      "score": 1.0,
      "status": "fresh",
      "latest_date": "2026-06-08",
      "days_since": 1
    },
    "drift": {
      "score": 1.0,
      "status": "ok",
      "max_drift_pct": 0.0
    },
    "coverage": {
      "score": 1.0,
      "days_covered": 30,
      "total_days": 30,
      "coverage_pct": 100.0
    },
    "cron": {
      "score": 1.0,
      "jobs_ok": 7,
      "jobs_total": 7,
      "success_rate": 100.0
    }
  },
  "readiness_4_2": {
    "ready": true,
    "blocker": null
  }
}
```

**Exemplo para tenant novo:**

```json
{
  "health_score": 65.0,
  "severity": "degraded",
  "classification": "insufficient_history",
  "maturity": {
    "status": "new",
    "days_of_history": 6,
    "threshold_days": 30
  },
  "readiness_4_2": {
    "ready": false,
    "blocker": "insufficient_history"
  }
}
```

---

## Drift Policy

### Definição de Drift

```
drift_pct = |snapshot_value - realtime_value| / realtime_value × 100
```

Calculado para múltiplas métricas: `pipeline_total`, `pipeline_weighted`, `open_count`, `won_count`, `won_value`, `conversion_rate`.

O `drift_score` da RPC usa apenas o **último log** de drift para o tenant.

### Thresholds de Drift

| Drift | Status | drift_score |
|---|---|---|
| < 2% | `ok` | 1.0 |
| 2% – 4.9% | `warning` | 0.7 |
| 5% – 9.9% | `critical` | 0.3 |
| ≥ 10% | `critical` | 0.0 |

### Atenção: amplificação por denominador pequeno

Em empresas muito novas (< 14 dias), pequenas diferenças absolutas (1-2 registros) podem gerar percentuais de drift elevados. Isso é esperado e **não é indicativo de falha de fórmula**. A classificação `insufficient_history` previne que esse drift afete a readiness da plataforma.

---

## Freshness Policy

### Definição de "Fresco"

Um snapshot é considerado fresco quando `period_start = D-1` (ontem).

### `freshnessOk` no Frontend (previsto para FASE 4.2)

```typescript
freshnessOk = health?.components?.freshness?.days_since <= 1
```

Se `days_since > 1`: `SnapshotDataGuard` oculta silenciosamente os widgets históricos.

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

---

## Observabilidade do Cron — Idempotência (Sprint 0.5)

### Problema identificado

O Vercel Cron usa entrega at-least-once, podendo disparar o endpoint duas vezes por dia. A segunda invocação criava registros `running` que nunca eram atualizados (ghost records), distorcendo o `cron_score` (50% de sucesso ao invés de 100%).

### Solução implementada

O endpoint `generate-dashboard-snapshots` verifica se já existe um run `completed` ou `partial` para o mesmo `run_date` antes de processar:

```javascript
// Guard de idempotência
const { data: existingRun } = await svc
  .from('dashboard_snapshot_cron_runs')
  .select('id, status')
  .eq('run_date', jobDate)
  .in('status', ['completed', 'partial'])
  .maybeSingle()

if (existingRun) {
  return res.status(200).json({
    ok: true, skipped: true, reason: 'duplicate_invocation'
  })
}
```

Um outer try/catch garante que qualquer erro inesperado atualize o cron_run para `failed`.

---

## Tradeoffs Aceitos

| Tradeoff | Decisão | Justificativa |
|---|---|---|
| Score calculado on-demand (não cached) | Aceito | Usado apenas em admin/monitoring, não em hot path |
| Maturidade baseada em total de snapshots históricos | Aceito | Mais confiável que data de criação da empresa (backfills alteram a percepção) |
| Threshold de maturidade = 30 dias | Aceito | Coincide com a janela de cobertura; empresa com 30+ dias tem coverage_score acionável |
| Drift medido com base apenas no último log | Aceito temporariamente | Proxy suficiente para FASE 4.1.5; expandir para janela de 7 dias em FASE 4.2 |
| `insufficient_history` excluído do denominador de readiness | Aceito | Empresa nova não é falha — incluí-la distorceria métricas de saúde da plataforma |

---

## Evolução Futura do Health Score

Em fases futuras, o health score pode ser expandido para incluir:
- Drift medido sobre janela de 7 dias (não apenas último log)
- Tempo de execução do cron (P95)
- Fallback rate por empresa
- Cobertura de seller snapshots (não só company-wide)

Quando novos componentes forem adicionados, os pesos devem ser rebalanceados e este ADR atualizado.
