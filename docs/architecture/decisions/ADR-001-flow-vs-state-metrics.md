# ADR-001 — FLOW vs STATE Metrics

**Status:** Aceito e em vigor  
**Data:** 2026-05-12  
**Contexto:** Sistema de snapshots históricos do Dashboard Executivo

---

## Problema

Durante o design do sistema de snapshots históricos (FASE 4.0), surgiu uma decisão crítica: como agregar métricas de múltiplas janelas de tempo sem introduzir erros matemáticos nos dados históricos.

O erro mais comum em sistemas de analytics é **somar valores que representam estado** (ex: somar o pipeline de 7 dias diferentes e apresentar como "pipeline da semana"). Isso produz dados incorretos que enganam decisões executivas.

---

## Decisão

O sistema classifica todas as métricas em dois tipos mutuamente exclusivos:

### FLOW Metrics (Métricas de Fluxo)

**Definição:** Representam eventos ou acumulações em um período. Podem ser somadas entre períodos.

**Características:**
- São zero no início de cada período
- Acumulam ao longo do tempo
- A soma de períodos adjacentes é matematicamente válida

**Exemplos no sistema:**
| Métrica | Descrição |
|---|---|
| `leads_received` | Quantos leads chegaram naquele dia |
| `conversations_opened` | Conversas abertas no dia |
| `opportunities_created` | Oportunidades criadas no dia |
| `deals_won` | Negócios fechados no dia |
| `won_value` | Valor monetário ganho no dia |
| `messages_sent` | Mensagens enviadas no dia |

**Operação de agregação válida:** `SUM(won_value) WHERE period BETWEEN D-7 AND D-1` = valor ganho na semana.

---

### STATE Metrics (Métricas de Estado)

**Definição:** Representam o estado do sistema em um ponto no tempo. **Não podem ser somadas entre períodos.**

**Características:**
- Representam um snapshot do estado atual
- Variam ao longo do tempo mas não se acumulam
- Somá-las entre períodos não tem significado

**Exemplos no sistema:**
| Métrica | Descrição |
|---|---|
| `pipeline_value` | Valor total do pipeline ativo NAQUELE momento |
| `open_opportunities` | Número de oportunidades abertas NAQUELE momento |
| `conversion_rate` | Taxa de conversão NAQUELE período (ratio, não soma) |
| `avg_response_min` | Tempo médio de resposta NAQUELE período |
| `attendance_rate` | Taxa de atendimento NAQUELE período |
| `sla_breached` | Leads em SLA violado NAQUELE momento |

**Operação INCORRETA (não fazer):**
```sql
-- ERRADO: pipeline_value é STATE, não pode ser somado
SELECT SUM(pipeline_value) FROM dashboard_snapshots
WHERE period_start BETWEEN D-7 AND D-1;
-- Resultado: ~7x o pipeline real — completamente errado
```

**Operação CORRETA:**
```sql
-- CORRETO: pegar o valor do último snapshot disponível
SELECT pipeline_value FROM dashboard_snapshots
WHERE company_id = $1 AND period_start = D-1
ORDER BY created_at DESC LIMIT 1;
```

---

## `aggregate_snapshot_period` como Fonte Oficial

A RPC `aggregate_snapshot_period(company_id, period_start, period_end)` é a **única função autorizada** para agregar snapshots em períodos.

Ela implementa corretamente:
- `SUM()` para métricas FLOW
- Último valor disponível (`LAST_VALUE`) para métricas STATE
- Ponderação para ratios calculados (ex: `conversion_rate` não é a média dos conversion_rates, é recalculado a partir de won/total)

**Nunca usar `SUM()` diretamente em snapshots no frontend ou em endpoints ad-hoc.** Sempre passar por `aggregate_snapshot_period`.

---

## Exemplos Concretos

### Exemplo 1 — Correto: deals won na semana

```sql
-- Correto: deals_won é FLOW, pode ser somado
SELECT SUM(deals_won)
FROM dashboard_snapshots
WHERE company_id = $1
  AND period_start BETWEEN '2026-05-04' AND '2026-05-10';
-- Resultado: total de negócios fechados na semana → correto
```

### Exemplo 2 — Incorreto: pipeline da semana

```sql
-- ERRADO: pipeline_value é STATE
SELECT SUM(pipeline_value)
FROM dashboard_snapshots
WHERE company_id = $1
  AND period_start BETWEEN '2026-05-04' AND '2026-05-10';
-- Resultado: 7x o pipeline real → totalmente errado
```

### Exemplo 3 — Correto: pipeline atual usando último snapshot

```sql
-- Correto: pegar snapshot mais recente para valor de estado
SELECT pipeline_value
FROM dashboard_snapshots
WHERE company_id = $1
  AND period_start <= CURRENT_DATE - 1
ORDER BY period_start DESC
LIMIT 1;
```

### Exemplo 4 — Correto: comparação WoW de won_value

```sql
-- Semana atual (FLOW): pode somar
WITH current_week AS (
  SELECT SUM(won_value) as total
  FROM dashboard_snapshots
  WHERE company_id = $1 AND period_start BETWEEN D-7 AND D-1
),
previous_week AS (
  SELECT SUM(won_value) as total
  FROM dashboard_snapshots
  WHERE company_id = $1 AND period_start BETWEEN D-14 AND D-8
)
SELECT
  c.total as current_won,
  p.total as prev_won,
  (c.total - p.total) / NULLIF(p.total, 0) * 100 as delta_pct
FROM current_week c, previous_week p;
```

---

## Tradeoffs Aceitos

| Tradeoff | Decisão |
|---|---|
| Complexidade da RPC de agregação | Aceito — vale pela correção dos dados |
| Não poder fazer queries ad-hoc simples de "soma tudo" | Aceito — protege contra erros silenciosos |
| Frontend depende de `aggregate_snapshot_period` para comparações | Aceito — abstrai a complexidade |

---

## Consequências

- Todo novo campo adicionado às tabelas de snapshot deve ser classificado como FLOW ou STATE na migration
- A classificação deve ser documentada como comentário SQL na tabela (`-- FLOW` ou `-- STATE`)
- A RPC `aggregate_snapshot_period` deve ser atualizada quando novos campos são adicionados
- Revisões de código devem rejeitar qualquer `SUM()` diretamente em campos STATE de snapshots
