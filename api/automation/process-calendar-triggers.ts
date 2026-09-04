// =====================================================
// API: POST /api/automation/process-calendar-triggers
//
// Cron job: processa triggers temporais de calendário.
//
// Triggers implementados:
//   calendar.activity_due_soon  — atividade está prestes a ocorrer
//   calendar.activity_overdue   — atividade passou do horário sem conclusão
//
// Arquitetura:
//   1. cronGuard  — bloqueia execução fora de produção (CRON_ENABLED != 'true')
//   2. CRON_SECRET — autenticação da chamada Vercel Cron
//   3. Carregar flows ativos com triggers temporais (cross-tenant)
//   4. Agrupar por company_id
//   5. Por empresa: determinar janela e buscar atividades candidatas
//   6. Por par (flow, activity): verificar elegibilidade temporal +
//      filtros de activity_type/priority + claim atômico + dispatch
//
// Deduplicação:
//   - calendar_automation_trigger_log com UNIQUE por occurrence_key
//   - occurrence_key = "due_soon:{minutes}:{scheduled_datetime_iso}" ou
//                      "overdue:{minutes}:{scheduled_datetime_iso}"
//   - Um reagendamento altera scheduled_datetime → nova occurrence_key elegível
//
// Proteção contra concorrência:
//   - Duas instâncias simultâneas tentam o mesmo claim
//   - UNIQUE constraint garante que apenas UMA vence (INSERT atomic)
//   - Quem perde: ignoreDuplicates=true → maybeSingle() retorna null → skip
//
// DEV/PROD segurança:
//   - cronGuard verifica CRON_ENABLED=true ANTES de qualquer query
//   - Banco DEV e PROD são compartilhados — sem CRON_ENABLED a função retorna
//     imediatamente com { skipped: true }
//
// IMPORTANTE — NÃO adicionar este endpoint ao vercel.json nesta fase.
// A ativação do schedule será autorizada em separado (Fase 4B).
// =====================================================

// @ts-expect-error -- módulo JS ESM sem declarações de tipos
import { cronGuard }                            from '../lib/cronGuard.js'
// @ts-expect-error -- módulo JS ESM sem declarações de tipos
import { getSupabaseAdmin }                     from '../lib/automation/supabaseAdmin.js'
// @ts-expect-error -- módulo JS ESM sem declarações de tipos
import { claimAndDispatchTemporalTrigger }      from '../lib/automation/dispatchCalendarTrigger.js'

// ── Constantes ────────────────────────────────────────────────────────────────

/** Tamanho de cada página de atividades candidatas por empresa.
 *  Paginação via .range() permite que execuções seguintes alcancem atividades
 *  além da primeira página quando a página anterior está toda claimed. */
const PAGE_SIZE = 100

/** Número máximo de páginas processadas por empresa por execução do cron.
 *  Inspeciona no máximo PAGE_SIZE × MAX_PAGES_PER_COMPANY = 500 atividades
 *  candidatas por empresa por execução.
 *
 *  LIMITE CONHECIDO DE ESCALA:
 *  - Candidatos além de 500 dependem de execuções futuras do cron.
 *  - A query é ordenada por scheduled_datetime ASC. Atividades no início do range
 *    que permanecem pendentes e não-claimed continuam aparecendo nas páginas 1-N;
 *    atividades além do range só são alcançadas depois que as anteriores saem da janela.
 *  - due_soon: atividades saem da janela após scheduled_datetime + DUE_SOON_GRACE_MIN.
 *    Qualquer claimed due_soon naturalmente expira em minutos.
 *  - overdue: atividades saem da janela após MAX_OVERDUE_LOOKBACK_MIN (24h) do
 *    scheduled_datetime. Claimed overdue expiram em até 24h.
 *  - Portanto há recuperação temporal garantida, mas NÃO imediata para volumes >500.
 *  - Com o volume atual (15 pending, 0 overdue/due_soon), o limite é operacionalmente seguro.
 *  - Volumes extremos (>500 candidatos simultâneos por empresa) requerem revisão desta constante
 *    ou implementação de cursor/fila persistente. */
const MAX_PAGES_PER_COMPANY = 5  // 5 × 100 = 500 máx inspecionados/empresa/execução

/** Janela máxima de lookahead para triggers due_soon.
 *  Cap de segurança independente da configuração do flow.
 *  Equivalente a 48h — cobre configurações de até 1 dia de antecedência com buffer.
 *  Também é o limite superior de minutes_before aceito na validação do config. */
const MAX_DUE_SOON_LOOKAHEAD_MIN = 2880   // 48h

/** Limite máximo configurável de minutes_before para due_soon.
 *  Deve ser igual a MAX_DUE_SOON_LOOKAHEAD_MIN para consistência.
 *  Configs acima deste valor são ignorados/rejeitados. */
const MAX_MINUTES_BEFORE = 2880           // 48h

/** Limite máximo configurável de minutes_after para overdue.
 *  Deve ser igual a MAX_OVERDUE_LOOKBACK_MIN para consistência.
 *  Configs acima deste valor são ignorados/rejeitados. */
const MAX_MINUTES_AFTER = 1440            // 24h

/** Janela máxima de lookback para triggers overdue.
 *  Atividades cujo scheduled_datetime é anterior a este cutoff NÃO serão processadas.
 *  Evita disparo retroativo em massa na primeira ativação do cron.
 *  24h é suficiente para recuperar uma execução perdida sem volume retroativo.
 *
 *  ATENÇÃO PRODUÇÃO: ao ativar o cron pela primeira vez, atividades overdue
 *  dos últimas 24h poderão disparar automações. Revisar volume antes de ativar. */
const MAX_OVERDUE_LOOKBACK_MIN = 1440     // 24h

/** Grace window para due_soon: janela de tolerância APÓS o scheduled_datetime.
 *
 *  Problema sem grace:
 *    Atividade: 15:00, minutes_before=5 → janela [14:55, 15:00)
 *    Cron deveria executar em 14:55 mas falha/atrasa.
 *    Próxima execução: 15:01 → scheduled_datetime já passou → nunca dispara.
 *
 *  Com DUE_SOON_GRACE_MIN=2:
 *    Janela: [14:55, 15:02] → cron atrasado em 1 execução (1 min) ainda dispara.
 *    A deduplicação garante que dispara apenas uma vez.
 *
 *  Justificativa de 2 minutos:
 *    - Cron planejado para cada 1 minuto (frequência da Fase 4B).
 *    - Tolerância de 2× o intervalo cobre 1 execução perdida + cold start.
 *    - 2 minutos não confunde due_soon com overdue semanticamente.
 *    - Não gera retroativos na primeira ativação: só atividades até 2 min no passado.
 *
 *  NÃO alterar sem considerar que increase aumenta risco de overlap com overdue. */
const DUE_SOON_GRACE_MIN = 2              // 2 minutos após scheduled_datetime

/** Tipos de triggers temporais processados por este endpoint. */
const TEMPORAL_TRIGGER_TYPES = [
  'calendar.activity_due_soon',
  'calendar.activity_overdue',
] as const

type TemporalTriggerType = typeof TEMPORAL_TRIGGER_TYPES[number]

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Config extraída de um trigger temporal no nó start de um flow. */
interface TemporalTriggerConfig {
  /** Minutos antes do scheduled_datetime (due_soon). */
  minutes_before?: number
  /** Minutos após o scheduled_datetime (overdue). */
  minutes_after?: number
  /** Filtro opcional por tipo de atividade. */
  activity_type?: string
  /** Filtro opcional por prioridade. */
  priority?: string
}

/** Trigger temporal resolvido a partir de um flow ativo. */
interface ResolvedTemporalTrigger {
  triggerType: TemporalTriggerType
  config: TemporalTriggerConfig
}

/** Flow ativo com triggers temporais. */
interface TemporalFlow {
  id: string
  company_id: string
  is_over_plan: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[]
  temporalTriggers: ResolvedTemporalTrigger[]
}

/** Atividade candidata retornada pelo Supabase. */
interface CandidateActivity {
  id: string
  company_id: string
  lead_id: number
  title: string
  activity_type: string
  priority: string
  assigned_to: string | null
  owner_user_id: string
  scheduled_date: string
  scheduled_time: string
  scheduled_datetime: string
  status: string
  reminder_minutes: number | null
  duration_minutes: number | null
}

// ── Handler principal ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // ── 1. cronGuard — PRIMEIRA verificação. Bloqueia se CRON_ENABLED !== 'true' ──
  // Banco DEV e PROD são compartilhados. Este guard impede que o endpoint
  // execute qualquer query de processamento em ambientes sem CRON_ENABLED=true.
  if (!cronGuard(req, res)) return

  // ── 2. Autenticação — CRON_SECRET ────────────────────────────────────────
  // Reutiliza o padrão dos demais crons do projeto:
  //   Authorization: Bearer {CRON_SECRET}
  const authHeader = (req.headers.authorization as string) || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[process-calendar-triggers] requisição não autorizada — CRON_SECRET inválido')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabaseAdmin()
  const now = new Date()
  const nowIso = now.toISOString()

  console.log('[process-calendar-triggers] iniciando — now:', nowIso)

  const summary = {
    flows_found: 0,
    companies: 0,
    activities_evaluated: 0,
    pairs_evaluated: 0,
    dispatched: 0,
    skipped: 0,
    errors: 0,
  }

  try {
    // ── 3. Carregar todos os flows ativos ─────────────────────────────────
    // Carregamos todos os flows ativos de uma vez (cross-tenant) e filtramos
    // em JavaScript pelos que possuem triggers temporais habilitados.
    // Motivo: supabase-js não suporta diretamente EXISTS + JSONB aninhado.
    // Número esperado: dezenas a poucos centenas — aceitável para carregar em memória.
    const { data: allFlows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, company_id, nodes, is_over_plan')
      .eq('is_active', true)

    if (flowsErr) {
      console.error('[process-calendar-triggers] erro ao carregar flows:', flowsErr.message)
      return res.status(500).json({ error: 'Erro ao carregar flows' })
    }

    // ── 4. Filtrar flows com triggers temporais + extrair configs ─────────
    const temporalFlows: TemporalFlow[] = []

    for (const flow of allFlows || []) {
      const resolved = extractTemporalTriggers(flow.nodes || [])
      if (resolved.length === 0) continue

      temporalFlows.push({
        id:               flow.id,
        company_id:       flow.company_id,
        is_over_plan:     flow.is_over_plan === true,
        nodes:            flow.nodes,
        temporalTriggers: resolved,
      })
    }

    summary.flows_found = temporalFlows.length

    if (temporalFlows.length === 0) {
      console.log('[process-calendar-triggers] nenhum flow com triggers temporais encontrado')
      return res.status(200).json({ ok: true, ...summary })
    }

    // ── 5. Agrupar por company_id ─────────────────────────────────────────
    const byCompany = new Map<string, TemporalFlow[]>()
    for (const tf of temporalFlows) {
      if (!byCompany.has(tf.company_id)) byCompany.set(tf.company_id, [])
      byCompany.get(tf.company_id)!.push(tf)
    }

    summary.companies = byCompany.size
    console.log(`[process-calendar-triggers] ${summary.flows_found} flows em ${summary.companies} empresa(s)`)

    // ── 6. Processar por empresa ──────────────────────────────────────────
    for (const [companyId, companyFlows] of byCompany.entries()) {

      // Determinar horizonte máximo de lookahead para esta empresa
      // baseado nos valores de minutes_before/minutes_after configurados nos flows.
      const maxMinutesBefore = getMaxMinutesBefore(companyFlows)
      const maxMinutesAfter  = getMaxMinutesAfter(companyFlows)

      const hasDueSoon  = maxMinutesBefore > 0
      const hasOverdue  = maxMinutesAfter  >= 0   // minutes_after=0 é válido (overdue imediato)

      // Janela de busca unificada:
      //   cutoffMin → overdue (24h atrás) OU grace do due_soon (2 min atrás), o maior
      //   cutoffMax → due_soon (até 48h à frente)
      //
      // Grace window: incluímos atividades até DUE_SOON_GRACE_MIN no passado mesmo sem
      // overdue flows, para que atividades "quase vencidas" ainda possam ser disparadas
      // quando o cron atrasa 1–2 execuções.
      const dueSoonWindowMin    = Math.min(maxMinutesBefore, MAX_DUE_SOON_LOOKAHEAD_MIN)
      const overdueLookbackMs   = hasOverdue  ? MAX_OVERDUE_LOOKBACK_MIN * 60 * 1000 : 0
      const graceLookbackMs     = DUE_SOON_GRACE_MIN * 60 * 1000
      const lookbackMs          = Math.max(overdueLookbackMs, graceLookbackMs)

      const cutoffMin = new Date(now.getTime() - lookbackMs).toISOString()
      const cutoffMax = hasDueSoon
        ? new Date(now.getTime() + dueSoonWindowMin * 60 * 1000).toISOString()
        : nowIso

      // ── 7. Paginação por empresa ──────────────────────────────────────
      //
      // Problema com LIMIT simples (sem paginação):
      //   Se existirem > PAGE_SIZE atividades já claimed na janela, o cron sempre
      //   buscaria os mesmos primeiros PAGE_SIZE registros e nunca atingiria os
      //   registros além do limite (os não-claimed ficariam sem processar).
      //
      // Solução: percorrer múltiplas páginas até MAX_PAGES_PER_COMPANY.
      // - Claimed activities recebem skip via ignoreDuplicates sem re-disparar.
      // - Atividades além de MAX_PAGES × PAGE_SIZE aguardam execuções futuras.
      //
      // LIMITE CONHECIDO: ver constante MAX_PAGES_PER_COMPANY para análise de escala.
      //
      // Filtro status='pending': completed/cancelled não geram triggers temporais
      // (decisão D1 da Fase 1 — reagendamento reseta para 'pending').

      let offset = 0

      for (let page = 0; page < MAX_PAGES_PER_COMPANY; page++) {
        const { data: candidates, error: actErr } = await supabase
          .from('lead_activities')
          .select(`
            id, company_id, lead_id, title, activity_type, priority,
            assigned_to, owner_user_id, scheduled_date, scheduled_time,
            scheduled_datetime, status, reminder_minutes, duration_minutes
          `)
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .gte('scheduled_datetime', cutoffMin)
          .lte('scheduled_datetime', cutoffMax)
          .order('scheduled_datetime', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (actErr) {
          console.error(`[process-calendar-triggers][company:${companyId}] erro ao buscar atividades (page ${page}):`, actErr.message)
          summary.errors++
          break   // Não tentar mais páginas desta empresa em caso de erro
        }

        if (!candidates || candidates.length === 0) break   // Não há mais candidatos

        summary.activities_evaluated += candidates.length

        // ── 8. Avaliar pares (flow × activity × trigger_config) ────────
        for (const flow of companyFlows) {
          for (const { triggerType, config: triggerConfig } of flow.temporalTriggers) {

            for (const activity of (candidates as CandidateActivity[])) {
              summary.pairs_evaluated++

              // ── 8a. Verificar elegibilidade temporal ──────────────────
              // Esta verificação acontece ANTES do claim. Se a atividade não está
              // na janela temporal correta, nenhum upsert é tentado.
              if (!isTemporallyEligible(triggerType, triggerConfig, activity, now)) {
                continue
              }

              // ── 8b. Gerar occurrence_key determinística ───────────────
              // Baseada no scheduled_datetime REAL da atividade (não no horário do cron).
              // Um reagendamento altera scheduled_datetime → nova chave → nova ocorrência elegível.
              const scheduledDatetimeIso = normalizeOccurrenceDatetime(activity.scheduled_datetime)
              const occurrenceKey = buildOccurrenceKey(triggerType, triggerConfig, scheduledDatetimeIso)

              // ── 8c. Claim atômico + dispatch ──────────────────────────
              // claimAndDispatchTemporalTrigger:
              //   1. Valida multi-tenant (activity.company_id === companyId)
              //   2. Verifica is_over_plan
              //   3. Aplica filtros activity_type/priority (matchesCalendarActivity)
              //      → se falha: retorna 'skipped' SEM tentar claim
              //   4. Upsert atômico com ignoreDuplicates
              //   5. Se claim venceu: createExecution (flow específico) + processFlowAsync
              //   6. Atualiza execution_id no claim (tenant-safe: WHERE id=logId AND company_id)
              const result = await claimAndDispatchTemporalTrigger({
                triggerType,
                activity,
                flow,
                companyId,
                occurrenceKey,
                triggerConfig,
                supabase,
              })

              if      (result === 'dispatched') summary.dispatched++
              else if (result === 'skipped')    summary.skipped++
              else                              summary.errors++
            }
          }
        }

        // Se a página retornou menos que PAGE_SIZE, é a última página
        if (candidates.length < PAGE_SIZE) break

        offset += PAGE_SIZE
      }
    }

    console.log('[process-calendar-triggers] concluído —', JSON.stringify(summary))
    return res.status(200).json({ ok: true, ...summary })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[process-calendar-triggers] erro inesperado:', err?.message)
    return res.status(500).json({ error: 'Erro interno no cron de triggers de calendário' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extrai triggers temporais habilitados do nó start de um flow.
 * Retorna apenas triggers do tipo due_soon ou overdue com enabled=true.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTemporalTriggers(nodes: any[]): ResolvedTemporalTrigger[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startNode = nodes.find((n: any) => n.type === 'start')
  if (!startNode) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triggers: any[] = startNode.data?.triggers || []
  const results: ResolvedTemporalTrigger[] = []

  for (const t of triggers) {
    if (!t.enabled) continue
    if (!TEMPORAL_TRIGGER_TYPES.includes(t.type)) continue

    const rawConfig = t.config || {}

    // ── Validação de due_soon ─────────────────────────────────────────────
    // Regras:
    //   - Tipo: Number() aceita string numérica ("60" → 60) por compatibilidade
    //     com serialização JSON do Flow Builder.
    //   - Inteireza: Number.isInteger() — 60.5 é rejeitado (não normalizado
    //     silenciosamente). Valores fracionários indicam configuração incorreta
    //     e devem ser reportados explicitamente via log.
    //   - Mínimo: 1 (due_soon de 0 min não tem sentido semântico)
    //   - Máximo: MAX_MINUTES_BEFORE = 2880 (48h) — cap de segurança independente
    //     do frontend. Impede window query excessivamente ampla se o config
    //     for manipulado externamente.
    //   - NaN / Infinity → rejeitado por !Number.isFinite
    if (t.type === 'calendar.activity_due_soon') {
      const mb = Number(rawConfig.minutes_before)
      const isValid = Number.isFinite(mb) && Number.isInteger(mb) && mb >= 1 && mb <= MAX_MINUTES_BEFORE
      if (!isValid) {
        console.warn(
          `[extractTemporalTriggers] flow config inválido — due_soon minutes_before=${rawConfig.minutes_before} rejeitado (esperado: inteiro 1..${MAX_MINUTES_BEFORE})`
        )
        continue
      }
      results.push({
        triggerType: t.type as TemporalTriggerType,
        config: { ...rawConfig, minutes_before: mb },
      })
      continue
    }

    // ── Validação de overdue ──────────────────────────────────────────────
    // Regras equivalentes ao due_soon, com as diferenças:
    //   - Mínimo: 0 (overdue imediato quando a atividade passa do horário)
    //   - Máximo: MAX_MINUTES_AFTER = 1440 (24h) — deve igualar MAX_OVERDUE_LOOKBACK_MIN
    //     para que nenhum flow configure espera maior que a janela de busca.
    if (t.type === 'calendar.activity_overdue') {
      const ma = Number(rawConfig.minutes_after)
      const isValid = Number.isFinite(ma) && Number.isInteger(ma) && ma >= 0 && ma <= MAX_MINUTES_AFTER
      if (!isValid) {
        console.warn(
          `[extractTemporalTriggers] flow config inválido — overdue minutes_after=${rawConfig.minutes_after} rejeitado (esperado: inteiro 0..${MAX_MINUTES_AFTER})`
        )
        continue
      }
      results.push({
        triggerType: t.type as TemporalTriggerType,
        config: { ...rawConfig, minutes_after: ma },
      })
      continue
    }
  }

  return results
}

/**
 * Retorna o maior minutes_before configurado entre todos os flows da empresa.
 * Usado para dimensionar a janela de busca de atividades.
 */
function getMaxMinutesBefore(flows: TemporalFlow[]): number {
  let max = 0
  for (const flow of flows) {
    for (const { triggerType, config } of flow.temporalTriggers) {
      if (triggerType === 'calendar.activity_due_soon') {
        const mb = Number(config.minutes_before)
        if (Number.isFinite(mb) && mb > max) max = mb
      }
    }
  }
  return max
}

/**
 * Retorna o maior minutes_after configurado entre todos os flows da empresa.
 * -1 se nenhum flow tem overdue (sinaliza que overdue não está presente).
 */
function getMaxMinutesAfter(flows: TemporalFlow[]): number {
  let max = -1
  for (const flow of flows) {
    for (const { triggerType, config } of flow.temporalTriggers) {
      if (triggerType === 'calendar.activity_overdue') {
        const ma = Number(config.minutes_after)
        if (Number.isFinite(ma) && ma > max) max = ma
      }
    }
  }
  return max
}

/**
 * Verifica se o par (triggerConfig, activity) está dentro da janela de elegibilidade
 * no momento `now`.
 *
 * Para due_soon:
 *   Elegível quando: now >= scheduled_datetime - minutes_before
 *   (a atividade entrou na janela de antecedência configurada)
 *   E ainda não ocorreu: scheduled_datetime > now
 *   (atividades já passadas não são due_soon)
 *
 * Para overdue:
 *   Elegível quando: now >= scheduled_datetime + minutes_after
 *   (aguardou o tempo configurado após o horário da atividade)
 *   E ainda pending: status='pending' (já filtrado na query do banco)
 *
 * Não usa DATE_TRUNC(now()) — usa timestamps absolutos para ser robusto
 * a atrasos/cold starts do cron.
 */
function isTemporallyEligible(
  triggerType: TemporalTriggerType,
  config: TemporalTriggerConfig,
  activity: CandidateActivity,
  now: Date,
): boolean {
  const scheduledMs = new Date(activity.scheduled_datetime).getTime()
  if (isNaN(scheduledMs)) return false

  const nowMs = now.getTime()

  if (triggerType === 'calendar.activity_due_soon') {
    const minutesBefore = Number(config.minutes_before)
    if (!Number.isFinite(minutesBefore) || minutesBefore < 1) return false

    const windowStartMs = scheduledMs - minutesBefore * 60 * 1000
    // Grace window: tolera atraso do cron de até DUE_SOON_GRACE_MIN após o horário da atividade.
    // Sem grace: se o cron atrasa 1 execução (1 min), a janela fecha às 15:00 e 15:01 nunca dispara.
    // Com grace de 2 min: janela = [scheduled - minutes_before, scheduled + grace]
    // A deduplicação garante que dispara apenas uma vez mesmo dentro da grace.
    const gracePeriodMs = DUE_SOON_GRACE_MIN * 60 * 1000
    return nowMs >= windowStartMs && nowMs <= (scheduledMs + gracePeriodMs)
  }

  if (triggerType === 'calendar.activity_overdue') {
    const minutesAfter = Number(config.minutes_after)
    if (!Number.isFinite(minutesAfter) || minutesAfter < 0) return false

    const overdueThresholdMs = scheduledMs + minutesAfter * 60 * 1000
    // Elegível: passou o tempo de espera após o scheduled_datetime
    return nowMs >= overdueThresholdMs
  }

  return false
}

/**
 * Normaliza o valor de scheduled_datetime para uso na occurrence_key.
 *
 * scheduled_datetime no banco é TIMESTAMPTZ populado pelo trigger
 * sync_scheduled_datetime() via (scheduled_date + scheduled_time)::timestamptz.
 * O servidor Supabase usa UTC, portanto o valor já é UTC sem conversão.
 *
 * A occurrence_key usa o ISO UTC normalizado (ex: "2026-09-05T18:00:00.000Z")
 * para garantir que:
 *   - Um reagendamento (altera scheduled_datetime) gera uma nova occurrence_key
 *   - A mesma atividade com o mesmo horário e mesmo flow → mesma occurrence_key
 *
 * ATENÇÃO: se o timezone do servidor Supabase mudar, as occurrence_keys existentes
 * ainda serão válidas pois usam o valor ISO já armazenado (não recalculam).
 */
function normalizeOccurrenceDatetime(scheduledDatetime: string): string {
  const d = new Date(scheduledDatetime)
  return isNaN(d.getTime()) ? scheduledDatetime : d.toISOString()
}

/**
 * Constrói a occurrence_key determinística.
 *
 * Formato:
 *   due_soon  → "due_soon:{minutes_before}:{scheduled_datetime_iso_utc}"
 *   overdue   → "overdue:{minutes_after}:{scheduled_datetime_iso_utc}"
 *
 * Exemplos:
 *   "due_soon:60:2026-09-05T18:00:00.000Z"
 *   "overdue:30:2026-09-05T18:00:00.000Z"
 *   "overdue:0:2026-09-05T18:00:00.000Z"   ← overdue imediato (minutes_after=0)
 */
function buildOccurrenceKey(
  triggerType: TemporalTriggerType,
  config: TemporalTriggerConfig,
  scheduledDatetimeIso: string,
): string {
  if (triggerType === 'calendar.activity_due_soon') {
    return `due_soon:${config.minutes_before}:${scheduledDatetimeIso}`
  }
  if (triggerType === 'calendar.activity_overdue') {
    return `overdue:${config.minutes_after}:${scheduledDatetimeIso}`
  }
  // Fallback defensivo (não deve ocorrer com os tipos atuais)
  return `${triggerType}:${scheduledDatetimeIso}`
}
