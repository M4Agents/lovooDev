# Dashboard Executivo — Roadmap Arquitetural

**Projeto:** Lovoo CRM  
**Componente:** Dashboard Executivo (`/dashboard`)  
**Última atualização:** 2026-05-12  
**Estado atual:** FASE 4.1.5 concluída e em produção

---

## Estado Atual

| Item | Status |
|---|---|
| Snapshots históricos diários | Ativo — 30+ dias de histórico |
| Cron de geração (04:00 UTC) | Ativo — D-1, D-2, D-3 |
| Shadow mode | Superado — drift validado 0.00% |
| Observabilidade (cron_runs) | Ativo desde FASE 4.1.5 |
| Drift detection automático | Ativo — amostra de 10 empresas/dia |
| Health score | Operacional — score 91 em produção |
| Fallback tracking | Ativo — fire-and-forget sem impacto em UX |
| Comparação WoW/MoM (visual) | Ativo com feature flags |
| Sparklines históricos | Ativo com feature flags |
| SLA trendline | Ativo com feature flags |
| Dual-read | Não iniciado — aguarda FASE 4.2 |

**Feature flags de produção:**

```
VITE_FEATURE_SNAPSHOT_DELTA=false       # DeltaBadge + sparklines
VITE_FEATURE_SNAPSHOT_TRENDS=false      # SLA trendline
VITE_FEATURE_SNAPSHOT_COMPARISON=false  # comparação expandida
```

---

## Fases Concluídas

### FASE 0 — Infraestrutura base
Setup inicial do dashboard: roteamento, autenticação, estrutura de contexto multi-tenant. Estabeleceu o padrão `company_id` obrigatório em todos os endpoints.

### FASE 1 — KPIs e Tendências
- Cards de KPI executivo (`ExecutiveSummary`) com `InteractiveMetricCard`
- `EntityListDrawer` — lista paginada de leads/conversas/oportunidades
- `TrendsSection` — gráficos de tendência realtime (Recharts)
- Hooks: `useDashboardSummary`, `useDashboardTrends`, `useDashboardFilters`

### FASE 2 — Gestão Comercial
- `SellerRankingSection` — ranking com score composto (conversão 35%, velocidade 25%, atendimento 20%, geração 10%, SLA 10%)
- `SlaAlertsPanel` — leads sem resposta paginado, ordenado por urgência
- `LeadOriginsSection` — origens de leads com gráfico
- Hooks: `useSellerPerformance`, `useSlaAlerts`, `useLeadOrigins`

### FASE 3A — Inteligência Executiva
- `ForecastSection` — forecast de pipeline com gauge e probabilidades
- `PriorityAlertsSection` — alertas críticos acionáveis (SLA, opp stalled, seller risk)
- `IntelligenceCentral` — insights com análise de IA (créditos)
- `FunnelExecutiveSection` — visão executiva de funil
- Correção de RPCs com referências de coluna inválidas (`auth.users`, `is_hidden`)
- Botões de ação Chat/Oportunidade com `useDashboardEntityActions`

### FASE 4.0 — Infraestrutura de Snapshot
- Tabelas: `dashboard_snapshots`, `dashboard_funnel_stage_snapshots`, `dashboard_seller_snapshots`, `dashboard_snapshot_jobs`, `dashboard_snapshot_backfills`
- RPCs: `generate_dashboard_daily_snapshot`, `aggregate_snapshot_period`, `aggregate_seller_snapshot_period`
- Cron Vercel: `POST /api/cron/generate-dashboard-snapshots` (04:00 UTC)
- Backfill manual com checkpoint: `POST /api/cron/backfill-dashboard-snapshots`
- Shadow mode: `GET /api/dashboard/snapshot-diff` (admin interno)
- Endpoints: `snapshot-comparison`, `snapshot-trends`
- Backfill de 30 dias executado, drift validado em **0.00%**

### FASE 4.1 — Comparação Histórica Visual
- Componentes: `DeltaBadge`, `TrendSparkline`, `TrendChart`, `SnapshotDataGuard`
- Hooks: `useSnapshotComparison`, `useSnapshotTrends`, `useSnapshotSellerDeltas`, `useFeatureFlags`
- Toggle global `WoW | MoM` no header do dashboard
- `DeltaBadge` + `TrendSparkline` nos 4 KPI cards do `ExecutiveSummary`
- `TrendChart` colapsável no rodapé do `SlaAlertsPanel` (7 dias de SLA)
- Deltas de `attendance_rate`, `avg_response_min` e sparkline de `won_value` no `SellerRankingSection`
- Endpoint: `GET /api/dashboard/snapshot-seller-deltas`
- Helper: `src/lib/snapshotPeriods.ts` — cálculo de períodos WoW/MoM
- Regras D3/D4: fallback silencioso, mínimo 5 pontos para exibir sparkline
- Todas as flags desligadas por padrão — comportamento idêntico ao anterior

### FASE 4.1.5 — Hardening e Observabilidade
- Tabelas operacionais: `dashboard_snapshot_cron_runs`, `dashboard_snapshot_drift_logs`, `dashboard_snapshot_fallback_logs`
- RPC: `get_snapshot_health_score(company_id, date)` — score 0–100 com componentes
- Endpoint: `GET /api/dashboard/snapshot-health` — health score por tenant
- Endpoint: `POST /api/internal/snapshot-fallback-log` — fire-and-forget
- Cron enhanced: registro em `cron_runs`, drift check automático em 10 empresas/dia, pruning das tabelas de log
- `withTiming` adicionado em `snapshot-comparison`, `snapshot-trends`, `snapshot-seller-deltas`
- Fallback tracking nos hooks `useSnapshotComparison`, `useSnapshotTrends`, `useSnapshotSellerDeltas`
- `SnapshotDataGuard` com prop `freshnessOk` para gate de freshness
- Pruning automático: jobs 90d, cron_runs 365d, drift_logs 180d, fallback_logs 30d
- Resultado validado: **health_score = 91, severity = healthy, readiness_4_2 = true**

---

## Próximas Fases

### FASE 4.2 — Dual-read Controlado
**Pré-requisito:** critérios de readiness mantidos por 7 dias consecutivos.

Objetivo: ativar leitura híbrida em endpoints selecionados — snapshot para dados históricos, realtime para estado atual ("hoje"). Sem substituir realtime completamente.

Escopo:
- Endpoints híbridos: retornam realtime para período atual + snapshot para comparativo histórico em uma única resposta
- Cache-Control nos endpoints de snapshot (s-maxage=300)
- Fallback automático para realtime quando snapshot ausente ou stale
- Gradual: começar por `snapshot-comparison` e `snapshot-trends`, depois expandir
- Feature flag por tenant (não global)

Critérios de readiness — ver seção específica abaixo.

### FASE 4.3 — Escalabilidade de Snapshot
Quando empresas ativas > 150 ou cron P95 > 200s.

- Migração do cron para arquitetura dispatcher/worker (fila de jobs)
- Particionamento de `dashboard_snapshots` por `period_start` (ano) quando > 2M linhas
- Índices covering para queries frequentes de tendência
- Possível migração para processamento assíncrono via Supabase Edge Functions ou queue externa

### FASE 5 — IA Analítica Histórica
Após dual-read estável.

- Detecção automática de deterioração operacional
- Previsão de conversão por tendência histórica
- Benchmarks internos por período
- Anomaly detection no pipeline
- Análise de seller performance histórica com correlação

### FASE 6 — Benchmark Cross-company
Opt-in por tenant.

- Comparação anônima de performance entre empresas do mesmo segmento
- Percentis de conversão, SLA, pipeline
- Dados sempre anonimizados e agregados
- Separação estrita de dados por tenant

### FASE 7 — BI/Data Platform
Longo prazo.

- Export para warehouse (BigQuery, Redshift, ou similar)
- Dashboards externos com ferramentas de BI
- API de analytics para integrações de terceiros
- Retention policy configurável por tenant

---

## Estratégia Arquitetural

### Realtime vs. Snapshot

```
Realtime (Supabase RPCs)        → estado ATUAL do pipeline e alertas
Snapshot (dashboard_snapshots)  → contexto HISTÓRICO e comparações
```

**Regra imutável:** realtime é sempre o source of truth operacional. Snapshot é contexto secundário. Nenhuma decisão operacional (ex: "qual lead atender agora") pode depender de snapshot.

### Hierarquia de Dados

```
Dados do dia (hoje)     → realtime obrigatório
Dados de D-1 em diante → snapshot preferido, realtime como fallback
Comparações WoW/MoM    → snapshot exclusivo
Sparklines históricos   → snapshot exclusivo
Tendências 7-30 dias   → snapshot exclusivo
```

### Fallback Strategy

1. Hook tenta buscar dados de snapshot
2. Se erro ou dados insuficientes → `null` (sem erro visual)
3. Fire-and-forget para `/api/internal/snapshot-fallback-log`
4. `SnapshotDataGuard` oculta componente silenciosamente
5. Realtime segue exibindo normalmente
6. UX nunca quebra por ausência de snapshot

### Anti-drift

- Drift check automático diário em amostra de 10 empresas
- Threshold de alerta: > 2% (warning), > 5% (critical)
- Resultados persistidos em `dashboard_snapshot_drift_logs` (180 dias)
- Drift crítico → `console.error` no Vercel Logs → investigação manual
- Health score penaliza drift no componente `drift_score × 0.30`

---

## Critérios para Iniciar FASE 4.2

Todos os critérios devem ser atendidos por **7 dias consecutivos** antes de ativar dual-read:

| Critério | Threshold obrigatório |
|---|---|
| `health_score` | ≥ 85 para ≥ 95% das empresas ativas |
| Drift máximo (`max_drift_pct`) | < 2% |
| Freshness | D-1 presente para ≥ 95% dos company-days (últimos 14d) |
| Cron success rate | ≥ 98% (últimos 14d) |
| Fallback rate | < 5% por empresa (últimos 7d) |
| `drift_alerts` no cron | 0 (últimos 7d) |
| `timeout_hit` no cron | `false` (últimos 7d) |

**Query de readiness (Supabase):**

```sql
SELECT get_snapshot_health_score(id, CURRENT_DATE)
FROM companies
WHERE status = 'active' AND deleted_at IS NULL;
-- Verificar: health_score >= 85 e readiness_4_2.ready = true para todas
```

---

## Tabelas de Snapshot — Referência Rápida

| Tabela | Tipo | Retenção | Propósito |
|---|---|---|---|
| `dashboard_snapshots` | Histórica | Indefinida | Métricas diárias company-wide e por funil |
| `dashboard_seller_snapshots` | Histórica | Indefinida | Métricas diárias por vendedor |
| `dashboard_funnel_stage_snapshots` | Histórica | Indefinida | Métricas por etapa do funil |
| `dashboard_snapshot_jobs` | Operacional | 90 dias | Log por empresa por data do cron |
| `dashboard_snapshot_backfills` | Auditoria | Sem pruning | Checkpoint de backfills manuais |
| `dashboard_snapshot_cron_runs` | Operacional | 365 dias | Registro global de execução do cron |
| `dashboard_snapshot_drift_logs` | Operacional | 180 dias | Histórico de drift por tenant |
| `dashboard_snapshot_fallback_logs` | Operacional | 30 dias | Fallbacks silenciosos do frontend |

---

## Referências de Código

| Componente | Arquivo |
|---|---|
| Feature flags | `src/hooks/dashboard/useFeatureFlags.ts` |
| Períodos WoW/MoM | `src/lib/snapshotPeriods.ts` |
| Guard de dados | `src/components/Dashboard/historical/SnapshotDataGuard.tsx` |
| Cron principal | `api/cron/generate-dashboard-snapshots.js` |
| Health score | `api/dashboard/snapshot-health.ts` |
| Fallback log | `api/internal/snapshot-fallback-log.ts` |
| RPC health | `supabase/migrations/20260524200001_create_snapshot_health_score_rpc.sql` |
| Tabelas observabilidade | `supabase/migrations/20260524200000_create_snapshot_observability_tables.sql` |
