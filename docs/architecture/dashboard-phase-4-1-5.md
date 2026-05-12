# FASE 4.1.5 — Hardening, Observabilidade e Validação Real dos Snapshots Históricos

**Concluída em:** 2026-05-12  
**Estado:** Em produção  
**Resultado de validação:** `health_score = 91, severity = healthy, readiness_4_2 = true`

---

## Objetivo

Estabilizar, instrumentar e validar o comportamento real do snapshot histórico antes de avançar para FASE 4.2 (dual-read híbrido). A fase não alterou nenhuma funcionalidade visual ou operacional existente.

Problema que justifica a fase: após FASE 4.1, o sistema tinha snapshots e visualizações funcionando, mas sem mecanismo confiável para saber se os snapshots estavam saudáveis, frescos, e sem drift. Era necessário ter visibilidade antes de ampliar o uso dos snapshots.

---

## O Que Foi Implementado

### 1. Tabelas de Observabilidade

**Migration:** `supabase/migrations/20260524200000_create_snapshot_observability_tables.sql`

#### `dashboard_snapshot_cron_runs`

Registro global de cada execução do cron diário. Uma linha por execução.

```sql
id              UUID PRIMARY KEY
run_date        DATE NOT NULL
started_at      TIMESTAMPTZ NOT NULL
finished_at     TIMESTAMPTZ
status          TEXT CHECK (pending | running | success | partial | error)
total_companies INT
processed       INT
failed          INT
duration_ms     INT
timeout_hit     BOOLEAN DEFAULT false
drift_checked   INT  -- quantas empresas passaram por drift check
drift_alerts    INT  -- quantas tinham drift crítico (> 5%)
error_details   TEXT
created_at      TIMESTAMPTZ DEFAULT now()
```

RLS: tabela apenas acessível pelo backend com `service_role`.

#### `dashboard_snapshot_drift_logs`

Resultado do drift check por empresa por data.

```sql
id              UUID PRIMARY KEY
company_id      UUID NOT NULL REFERENCES companies
check_date      DATE NOT NULL
period_start    DATE NOT NULL  -- D-1 analisado
snapshot_value  NUMERIC        -- valor snapshot
realtime_value  NUMERIC        -- valor realtime
drift_pct       NUMERIC        -- | snapshot - realtime | / realtime × 100
metric          TEXT           -- ex: 'total_leads', 'conversion_rate'
severity        TEXT CHECK (ok | warning | critical)
checked_at      TIMESTAMPTZ DEFAULT now()
```

Índices: `(company_id, check_date)`, `(severity)`, `(drift_pct DESC)`

RLS: usuários autenticados com membership na empresa podem ler os logs da própria empresa.

#### `dashboard_snapshot_fallback_logs`

Registro de fallbacks silenciosos disparados pelo frontend.

```sql
id          UUID PRIMARY KEY
company_id  UUID NOT NULL REFERENCES companies
endpoint    TEXT NOT NULL   -- ex: 'snapshot-comparison', 'snapshot-trends'
reason      TEXT NOT NULL   -- 'missing_data' | 'api_error' | 'insufficient_points'
mode        TEXT            -- 'wow' | 'mom' | null
user_id     UUID            -- auth.uid() do momento
created_at  TIMESTAMPTZ DEFAULT now()
```

Índices: `(company_id, created_at)`, `(endpoint)`, `(reason)`

RLS: leitura apenas pelo próprio usuário que gerou o log. Inserção via backend.

---

### 2. RPC `get_snapshot_health_score`

**Migration:** `supabase/migrations/20260524200001_create_snapshot_health_score_rpc.sql`

**Assinatura:**
```sql
get_snapshot_health_score(p_company_id UUID, p_reference_date DATE)
RETURNS JSONB
SECURITY DEFINER
```

Calcula um score composto de saúde dos snapshots para uma empresa. Autoriza via `auth_user_is_company_member(p_company_id)` ou `auth_user_is_platform_admin()`.

#### Componentes do Score

| Componente | Peso | O que mede |
|---|---|---|
| `freshness_score` | 0.35 | % de snapshots D-1 presentes nos últimos 14 dias |
| `drift_score` | 0.30 | Ausência de drift crítico nos últimos 7 dias |
| `coverage_score` | 0.20 | % de empresas-dia com snapshot gerado com sucesso |
| `cron_score` | 0.15 | % de execuções de cron com status success nos últimos 14 dias |

#### Fórmula

```
health_score = (freshness × 0.35) + (drift × 0.30) + (coverage × 0.20) + (cron × 0.15)
```

Score final: 0–100, arredondado para inteiro.

#### Severity (baseado no score)

| Score | Severity |
|---|---|
| ≥ 85 | `healthy` |
| ≥ 70 | `degraded` |
| < 70 | `critical` |

#### Estrutura de Resposta

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

#### Critérios de `readiness_4_2.ready = true`

Todos devem ser atendidos simultaneamente:

- `health_score >= 85`
- `drift_alerts_7d == 0`
- `cron_success_rate >= 98%` (últimos 14d)
- `days_since_last_snapshot <= 1`
- `freshness_score >= 90`

Se qualquer critério falhar, `ready = false` e o bloqueador é listado em `blockers[]`.

---

### 3. Endpoint `GET /api/dashboard/snapshot-health`

**Arquivo:** `api/dashboard/snapshot-health.ts`

```
GET /api/dashboard/snapshot-health?company_id=<uuid>&date=<YYYY-MM-DD>
Authorization: Bearer <user_jwt>
```

- Autentica via `getUserFromToken` (anon key)
- Valida membership com `assertMembership(user.id, company_id)`
- `date` é opcional — default: `CURRENT_DATE`
- Chama `get_snapshot_health_score` via `service_role` (RPC SECURITY DEFINER)
- Retorna o JSONB completo do health score
- Tempo de resposta monitorado com `withTiming`

**Uso:** monitoring interno, admin dashboard, gates de rollout, verificação pré-FASE 4.2.

---

### 4. Endpoint `POST /api/internal/snapshot-fallback-log`

**Arquivo:** `api/internal/snapshot-fallback-log.ts`

```
POST /api/internal/snapshot-fallback-log
Authorization: Bearer <user_jwt>
Body: { company_id, endpoint, reason, mode? }
```

- Sempre retorna `200 OK` independente do resultado (fire-and-forget)
- Valida membership antes de inserir
- Insere em `dashboard_snapshot_fallback_logs` via `service_role`
- Nunca bloqueia o frontend — erros são descartados silenciosamente

**Razões válidas:**
- `missing_data` — snapshot ausente para o período
- `api_error` — erro HTTP ao chamar o endpoint de snapshot
- `insufficient_points` — menos de 5 pontos para exibir sparkline (D4)

---

### 5. Cron Enhanced

**Arquivo:** `api/cron/generate-dashboard-snapshots.js`

#### Fluxo Atual do Cron

```
1. INSERT dashboard_snapshot_cron_runs (status: 'running')
2. Para cada empresa ativa:
   a. Chamar generate_dashboard_daily_snapshot(company_id, today)
   b. Registrar em dashboard_snapshot_jobs
   c. Late arriving data: recalcular D-1, D-2, D-3
3. Drift check automático:
   a. Samplear até 10 empresas (determinístico por data)
   b. Para cada empresa: comparar snapshot D-1 vs realtime
   c. Salvar resultado em dashboard_snapshot_drift_logs
   d. Se drift > 5%: console.error (visível no Vercel Logs)
4. Pruning das tabelas de log (ver seção de retenção)
5. UPDATE dashboard_snapshot_cron_runs (status: 'success' ou 'partial')
```

#### Drift Check por Empresa

```javascript
async function runDriftCheckForCompany(svc, companyId, checkDate) {
  // Busca snapshot D-1
  // Busca valor realtime equivalente via RPC
  // Calcula drift_pct = | snapshot - realtime | / realtime * 100
  // Determina severity: ok (<2%), warning (2-5%), critical (>5%)
  // INSERT dashboard_snapshot_drift_logs
  // Se critical: console.error(...)
}
```

**Seleção de empresas para drift check:** determinístico por hash da data para garantir cobertura distribuída ao longo das semanas.

---

### 6. Hooks com Fallback Tracking

Todos os hooks de snapshot passaram a chamar `dashboardApi.reportSnapshotFallback` de forma fire-and-forget no `catch` block e em condições de dados insuficientes.

| Hook | Arquivo | Quando dispara fallback |
|---|---|---|
| `useSnapshotComparison` | `src/hooks/dashboard/useSnapshotComparison.ts` | `missing_data`, `api_error` |
| `useSnapshotTrends` | `src/hooks/dashboard/useSnapshotTrends.ts` | `missing_data`, `api_error`, `insufficient_points` (< 5 pontos) |
| `useSnapshotSellerDeltas` | `src/hooks/dashboard/useSnapshotSellerDeltas.ts` | `missing_data`, `api_error` |

**Regra D4:** `useSnapshotTrends` dispara fallback com `insufficient_points` quando a resposta retorna menos de 5 pontos de dados — mínimo necessário para exibir um sparkline significativo.

**Implementação de fire-and-forget:**
```typescript
dashboardApi.reportSnapshotFallback({
  company_id: companyId,
  endpoint: 'snapshot-trends',
  reason: 'api_error',
  mode: comparisonMode,
}).catch(() => {}); // nunca bloqueia
```

---

### 7. `SnapshotDataGuard` com `freshnessOk`

**Arquivo:** `src/components/Dashboard/historical/SnapshotDataGuard.tsx`

Prop adicionada: `freshnessOk?: boolean`

**Comportamento:**
- Se `freshnessOk === false`: oculta o conteúdo silenciosamente (sem erro visual)
- Se `freshnessOk === undefined` (default): comportamento anterior mantido
- Impede exibição de dados históricos potencialmente desatualizados

**Uso esperado na FASE 4.2:**
```tsx
<SnapshotDataGuard
  enabled={flags.snapshotDelta}
  dataPoints={trendData?.points?.length ?? 0}
  minPoints={5}
  freshnessOk={healthData?.meta?.days_since_last_snapshot <= 1}
>
  <TrendSparkline ... />
</SnapshotDataGuard>
```

---

### 8. Performance Instrumentation

**Arquivo:** `api/lib/dashboard/observability.ts` — função `withTiming`

Adicionado a:

| Endpoint | O que é monitorado |
|---|---|
| `api/dashboard/snapshot-comparison.ts` | Duas chamadas a `aggregate_snapshot_period` |
| `api/dashboard/snapshot-trends.ts` | Query principal de tendências |
| `api/dashboard/snapshot-seller-deltas.ts` | Query de deltas por vendedor |
| `api/dashboard/snapshot-health.ts` | Chamada ao `get_snapshot_health_score` |

Output de `withTiming` vai para `console.log` do Vercel com formato:
```
[timing] snapshot-comparison aggregate_current: 142ms
```

---

## Retenção de Dados

| Tabela | Retenção | Justificativa |
|---|---|---|
| `dashboard_snapshots` | Indefinida | Ativo analítico histórico |
| `dashboard_seller_snapshots` | Indefinida | Ativo analítico histórico |
| `dashboard_funnel_stage_snapshots` | Indefinida | Ativo analítico histórico |
| `dashboard_snapshot_jobs` | 90 dias | Log operacional de curto prazo |
| `dashboard_snapshot_cron_runs` | 365 dias | Auditoria de cron (1 ano de histórico) |
| `dashboard_snapshot_drift_logs` | 180 dias | Análise de drift (6 meses) |
| `dashboard_snapshot_fallback_logs` | 30 dias | Diagnóstico de curto prazo |
| `dashboard_snapshot_backfills` | Sem pruning automático | Auditoria de backfills históricos |

**Pruning ocorre ao final do cron diário.** Execução aproximada: 04:30 UTC.

---

## Estratégia D-1 / D-2 / D-3

O cron recalcula os snapshots de D-1, D-2 e D-3 além de gerar D atual. Isso é necessário para **late arriving data** — dados que chegam ao CRM com atraso (ex: conversas sincronizadas de WhatsApp, leads importados retroativamente).

```
Hoje (D0):   gerado mas NÃO é o snapshot "oficial" do dia
D-1:         snapshot principal gerado E recalculado
D-2:         snapshot recalculado para capturar late data
D-3:         snapshot recalculado como segurança adicional
```

Snapshots de D-4+ são tratados como imutáveis — não são recalculados.

---

## Riscos Identificados e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Cron timeout em escala (> 200 empresas) | Médio | Médio | `timeout_hit` detectado, pruning de jobs, future: dispatcher/worker |
| Drift silencioso por mudança de fórmula em RPC | Baixo | Alto | `snapshot_version` nas tabelas, drift check automático diário |
| Fallback rate alto sem causa óbvia | Baixo | Médio | `fallback_logs` com 30d de histórico para análise |
| Snapshots com dados de D corrompidos | Baixo | Médio | D0 nunca é snapshot oficial; D-1 é sempre recalculado |
| Escala de `dashboard_snapshots` sem particionamento | Médio (longo prazo) | Baixo | FASE 4.3 prevê particionamento |

---

## Próximos Passos

1. Monitorar `health_score` diariamente por 7 dias
2. Verificar `drift_alerts` no cron — deve ser 0
3. Verificar `timeout_hit` no cron — deve ser false
4. Verificar `fallback_logs` — taxa deve ser < 5%
5. Quando todos os critérios de readiness atendidos por 7 dias consecutivos → iniciar FASE 4.2
