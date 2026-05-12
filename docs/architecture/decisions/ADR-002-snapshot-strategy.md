# ADR-002 — Estratégia de Snapshot Histórico

**Status:** Aceito e em vigor  
**Data:** 2026-05-12  
**Contexto:** Design e implementação do sistema de snapshots históricos (FASE 4.0)

---

## Problema

O Dashboard Executivo precisa de:
1. Contexto histórico (comparações, tendências)
2. Dados atuais precisos (operação do dia)
3. Performance aceitável mesmo com crescimento de dados
4. Sem impacto operacional nas queries do dia a dia

Opções avaliadas:
- **A) Queries históricas realtime:** Calcular sempre no momento da requisição
- **B) Materialized Views:** Views materializadas que reprocessam tudo
- **C) Snapshots diários imutáveis:** Gerar uma vez por dia, armazenar, reutilizar

---

## Decisão

**Opção C — Snapshots diários imutáveis.**

Um snapshot diário por empresa é gerado uma vez por dia (cron 04:00 UTC) e persiste indefinidamente. Comparações históricas sempre consomem snapshots, nunca fazem queries pesadas nas tabelas operacionais.

---

## Por que Snapshots são Daily-Only

### Problema com granularidade horária ou menor

- Volume de dados cresce 24x para granularidade horária
- Drift entre horários é esperado (dados chegam assincronamente)
- Dashboard executivo não precisa de granularidade < dia
- Custo de armazenamento e processamento 24x maior
- Cron de hora em hora aumentaria risco de race condition e duplicate data

### O que se perde com daily-only

- Impossível ver "como estava o pipeline às 14h de ontem"
- Impossível detectar picos intraday
- Adequado para uso executivo; inadequado para operacional em tempo real

### Como isso é compensado

- Dados operacionais em tempo real continuam via RPCs realtime
- Snapshots apenas para contexto histórico e comparação
- Intraday nunca é responsabilidade dos snapshots

---

## Estratégia D-1 / D-2 / D-3 (Late Arriving Data)

### Problema

Dados chegam ao CRM com atraso. Exemplos:
- Conversa do WhatsApp sincronizada horas depois
- Lead importado via CSV com data retroativa
- Integração de CRM legado com delay

Se o snapshot fosse imutável assim que gerado, dados tardios criariam drift permanente.

### Solução: janela de recalculação

O cron recalcula snapshots dos últimos 3 dias a cada execução:

```
Execução do cron em D0 (hoje):
├── Gera snapshot de D-1 (ontem)
├── Recalcula snapshot de D-2
├── Recalcula snapshot de D-3
└── D-4+ são imutáveis
```

**Implementação:** `ON CONFLICT (company_id, period_start) DO UPDATE SET ...`

Snapshots são idempotentes — recalcular o mesmo dia produz o mesmo resultado se os dados não mudaram.

### Por que 3 dias e não mais

- 99%+ dos dados tardios chegam em até 72h após o evento
- Janela maior aumenta carga do cron sem benefício proporcional
- D-4+ tratados como dados auditados e imutáveis para analytics

---

## Por que Realtime Continua Existindo

Snapshots não substituem realtime. São complementares.

| Necessidade | Fonte correta |
|---|---|
| "Quantos leads tenho hoje?" | Realtime RPC |
| "Qual lead devo atender agora?" | Realtime RPC |
| "Tenho alertas de SLA ativos?" | Realtime RPC |
| "Como está meu forecast esta semana?" | Realtime RPC |
| "Como foi semana passada vs a anterior?" | Snapshot |
| "Meu pipeline está crescendo ou caindo?" | Snapshot |
| "Qual vendedor mais cresceu no mês?" | Snapshot |
| "Quando o SLA começou a piorar?" | Snapshot |

**Regra arquitetural imutável:** Decisão operacional (ação do dia) → sempre realtime. Contexto histórico e tendências → sempre snapshot.

---

## Por que Dual-read Será Gradual (FASE 4.2)

### Risco de adoção imediata

Ativar dual-read imediatamente após ter snapshots disponíveis é arriscado porque:
1. Snapshots novos podem ter drift não detectado
2. Comportamento de fallback pode ter bugs não previstos
3. Usuários podem ver dados inconsistentes se a estratégia não for robusta
4. Difícil reverter se houver problema em produção

### Estratégia gradual adotada

```
FASE 4.0: Gerar snapshots em shadow mode (usuário não vê)
FASE 4.1: Exibir contexto histórico com feature flags desligadas
FASE 4.1.5: Validar saúde dos snapshots, drift < 2%, health score >= 85
FASE 4.2: Ativar dual-read com feature flags por tenant, gradualmente
```

Cada fase tem critérios explícitos de saída antes de avançar. Ver [ADR-003](./ADR-003-health-score.md) para critérios.

---

## Estrutura das Tabelas de Snapshot

### `dashboard_snapshots`

Snapshot daily por empresa. Contém:
- Métricas de pipeline (STATE + FLOW)
- Métricas de conversão e forecast
- Métricas de SLA
- `snapshot_version` para rastreamento de mudanças de fórmula

### `dashboard_seller_snapshots`

Snapshot daily por empresa **e por vendedor**. Permite:
- Ranking histórico de vendedores
- Trending de performance individual
- Comparação WoW/MoM por seller

### `dashboard_funnel_stage_snapshots`

Snapshot daily por empresa **e por etapa do funil**. Permite:
- Ver onde leads estagnaram historicamente
- Identificar gargalos no funil ao longo do tempo
- Análise de velocidade por etapa

---

## `snapshot_version` e Evolução de Fórmulas

Quando uma RPC de geração de snapshot muda sua lógica de cálculo, a versão do snapshot deve ser incrementada:

```sql
-- Na migration que altera a fórmula
UPDATE dashboard_snapshots
SET snapshot_version = 2
WHERE period_start >= '2026-06-01'; -- apenas snapshots futuros
```

Ou recalcular o histórico completo se necessário.

**Por que isso importa:** Comparações WoW/MoM de snapshots de versões diferentes podem ser matematicamente incorretas se a fórmula mudou.

---

## Tradeoffs Aceitos

| Tradeoff | Decisão | Justificativa |
|---|---|---|
| Dados históricos têm delay de ~1 dia | Aceito | Contexto executivo não precisa de tempo real |
| Cron pode falhar e deixar dia sem snapshot | Aceito | Fallback silencioso, health score detecta |
| Comparações só disponíveis a partir de D-1 | Aceito | Inevitável com daily snapshot |
| Dados de hoje nunca no snapshot | Aceito — **imutável** | Evita confusão entre "hoje" e "histórico" |
| Late data de D-4+ não é capturado | Aceito | < 1% dos casos, custo não vale |

---

## Consequências

- Nunca gerar snapshot de D0 (hoje) — mantém separação clara
- `generate_dashboard_daily_snapshot` sempre recebe `period_start = CURRENT_DATE - 1`
- Novas métricas devem ser backfilladas antes de serem consumidas no frontend
- Mudanças de fórmula exigem nova `snapshot_version` e possivelmente backfill
