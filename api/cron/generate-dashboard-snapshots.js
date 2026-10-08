// =============================================================================
// POST /api/cron/generate-dashboard-snapshots
//
// Cron diário de geração de snapshots executivos históricos.
// FASE 4.1.5: adicionados cron_runs header, drift check automático e
//             pruning das tabelas de log operacionais.
// Sprint 0.5: guard de idempotência (Vercel at-least-once delivery) e
//             outer try/catch para garantir cleanup do cron_run em falhas.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   service_role exclusivo — sem JWT de usuário.
//
// EXECUÇÃO:
//   Para cada empresa ativa, chama generate_dashboard_daily_snapshot()
//   para os três dias civis já encerrados no fuso da empresa.
//   O upsert atinge só a linha da mesma calendar_basis. A linha UTC do mesmo
//   period_start permanece. Não há backfill das datas anteriores.
//   Processa em batches de 10 empresas com delay entre batches.
//
// OBSERVABILIDADE (FASE 4.1.5):
//   1. Guard de idempotência: ignora invocação duplicada para o mesmo run_date
//   2. Cria registro em dashboard_snapshot_cron_runs (header global)
//   3. Após geração, executa drift check em amostra de MIN(total, 10) empresas
//   4. Grava resultados em dashboard_snapshot_drift_logs
//   5. Faz pruning das tabelas de log operacionais ao início
//
// TABELAS HISTÓRICAS (NÃO alteradas / sem pruning automático):
//   dashboard_snapshots, dashboard_seller_snapshots,
//   dashboard_funnel_stage_snapshots — retenção indefinida.
//
// AGENDAMENTO:
//   "0 4 * * *" — 04:00 UTC = 01:00 Brasília (após renew-credits 03:00)
//
// THRESHOLD DISPATCHER:
//   Migrar para arquitetura dispatcher/worker quando o número de
//   empresas ativas superar 150 (estimativa de timeout: 150 × 3 × 0.6s ≈ 270s).
//
// VARIÁVEIS DE AMBIENTE:
//   CRON_SECRET              — autenticação do cron
//   SUPABASE_SERVICE_ROLE_KEY — service_role do Supabase
//   VITE_SUPABASE_URL         — URL do projeto
// =============================================================================

import { cronGuard }           from '../lib/cronGuard.js';
import { createClient } from '@supabase/supabase-js'
import { completedCivilDates, normalizeDashboardTimeZone } from '../lib/dashboard/companyCivilDate.js'
import { decideCompanyRunClaim, companyRunFinalStatus } from '../lib/dashboard/companySnapshotRun.js'

// A base da empresa só é gerada no LovooCRM, com as duas variáveis.
// A flag sozinha não basta: o LovooDev não define DASHBOARD_SNAPSHOT_PRODUCER.
const COMPANY_SNAPSHOT_WRITES = process.env.DASHBOARD_COMPANY_SNAPSHOT_WRITES === 'true'
  && process.env.DASHBOARD_SNAPSHOT_PRODUCER === 'lovoo-crm'
const BATCH_SIZE   = 10     // empresas por batch de geração
const BATCH_DELAY  = 300    // ms entre batches
const DATES_BACK   = 3      // D-1, D-2, D-3 (late arriving data)
const TIMEOUT_MS   = 255_000 // 255s — margem antes do limite Vercel Pro (300s)

// Drift check
const DRIFT_SAMPLE_SIZE = 10    // máximo de empresas por rodada
const DRIFT_WARN_PCT    = 2.0   // % para status 'warning'
const DRIFT_CRIT_PCT    = 5.0   // % para status 'critical'

// Retenção das tabelas de LOG (em dias)
const RETENTION_CRON_RUNS     = 365
const RETENTION_DRIFT_LOGS    = 180
const RETENTION_FALLBACK_LOGS = 30
const RETENTION_SNAPSHOT_JOBS = 90
const RETENTION_USAGE_LOGS    = 90

// Métricas comparadas no drift check (usando get_dashboard_forecast)
const DRIFT_METRICS = [
  { key: 'pipeline_total',    snap_field: 'pipeline_total',    rt_field: 'pipeline_total'    },
  { key: 'pipeline_weighted', snap_field: 'pipeline_weighted', rt_field: 'pipeline_weighted' },
  { key: 'open_count',        snap_field: 'open_count',        rt_field: 'open_count'        },
  { key: 'won_count',         snap_field: 'won_count',         rt_field: 'won_count'         },
  { key: 'won_value',         snap_field: 'won_value',         rt_field: 'won_value'         },
  { key: 'conversion_rate',   snap_field: 'conversion_rate',   rt_field: 'conversion_rate'   },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Dias civis já encerrados no fuso da empresa. Não regrava o histórico anterior. */
function companySnapshotDates(timeZone, now = new Date()) {
  return completedCivilDates(timeZone, DATES_BACK, now)
}

/** Datas UTC do cron publicado. Usadas enquanto a gravação da base da empresa está desligada. */
function utcSnapshotDates(daysBack, now = new Date()) {
  const dates = []
  for (let i = 1; i <= daysBack; i++) {
    const day = new Date(now)
    day.setUTCDate(day.getUTCDate() - i)
    dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

/**
 * O cron novo só grava depois que calendar_basis existe.
 * Sem a coluna, a função antiga regravaria a janela UTC.
 */
async function snapshotCalendarReady(svc) {
  const { error } = await svc
    .from('dashboard_snapshots')
    .select('calendar_basis')
    .limit(1)
  return !error
}

/** Calcula delta percentual absoluto entre snapshot e realtime */
function deltaPct(snap, rt) {
  if (rt === 0 && snap === 0) return 0
  if (rt === 0) return 100
  return Math.abs((snap - rt) / rt) * 100
}

/** Seleciona amostra pseudo-aleatória de companyIds usando a data como seed */
function sampleCompanies(companyIds, sampleSize, seedDate) {
  if (companyIds.length <= sampleSize) return [...companyIds]
  // Seed determinístico baseado na data (YYYY-MM-DD → número)
  const seed = seedDate.replace(/-/g, '')
  const shuffled = [...companyIds].sort((a, b) => {
    const ha = (parseInt(a.slice(0, 8), 16) ^ parseInt(seed)) % 1000
    const hb = (parseInt(b.slice(0, 8), 16) ^ parseInt(seed)) % 1000
    return ha - hb
  })
  return shuffled.slice(0, sampleSize)
}

/**
 * Posse exclusiva da geração no calendário da empresa.
 * Não usa dashboard_snapshot_cron_runs: o LovooDev conclui essa tabela na base utc
 * e impediria a produção de gerar o outro calendário.
 */
async function claimCompanySnapshotRun(svc, jobDate, nowMs = Date.now()) {
  const startedAt = new Date(nowMs).toISOString()
  const { data: inserted, error: insertError } = await svc
    .from('dashboard_company_snapshot_runs')
    .insert({ run_date: jobDate, status: 'running', started_at: startedAt })
    .select('id, started_at')
    .maybeSingle()

  if (!insertError && inserted?.id) {
    return { claimed: true, id: inserted.id, startedAt: inserted.started_at }
  }

  const { data: existing } = await svc
    .from('dashboard_company_snapshot_runs')
    .select('id, status, started_at')
    .eq('run_date', jobDate)
    .maybeSingle()

  const decision = decideCompanyRunClaim(existing, nowMs)
  if (decision === 'skip_completed') return { claimed: false, reason: 'duplicate_invocation' }
  if (decision === 'concurrent') return { claimed: false, reason: 'concurrent_run' }
  if (decision !== 'retry' && decision !== 'retry_stale') {
    return { claimed: false, reason: 'claim_failed' }
  }

  let takeover = svc
    .from('dashboard_company_snapshot_runs')
    .update({
      status: 'running',
      started_at: startedAt,
      finished_at: null,
    })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .eq('started_at', existing.started_at)
  const { data: taken } = await takeover.select('id, started_at').maybeSingle()

  if (taken?.id) return { claimed: true, id: taken.id, startedAt: taken.started_at }
  return { claimed: false, reason: 'concurrent_run' }
}

async function finishOwnedCompanyRun(svc, runId, startedAt, status) {
  const { data } = await svc
    .from('dashboard_company_snapshot_runs')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', 'running')
    .eq('started_at', startedAt)
    .select('id')
    .maybeSingle()
  return Boolean(data?.id)
}

/** Processa um batch de empresas para uma data específica */
async function processBatch(svc, companyIds, date, jobDate, rpcName) {
  const results = []
  for (const companyId of companyIds) {
    const start = Date.now()
    const { data, error } = await svc.rpc(rpcName, {
      p_company_id: companyId,
      p_date:       date,
    })

    const duration = Date.now() - start
    const result   = data ?? {}
    const ok       = !error && result.ok !== false

    results.push({ companyId, ok, error: error?.message ?? result.error ?? null, duration })

    await svc.from('dashboard_snapshot_jobs').insert({
      job_date:        jobDate,
      company_id:      companyId,
      status:          ok ? 'ok' : 'failed',
      dates_processed: [date],
      error_msg:       ok ? null : (error?.message ?? result.error ?? 'unknown'),
      duration_ms:     duration,
    })
  }
  return results
}

/** Executa drift check para uma empresa e salva em dashboard_snapshot_drift_logs */
async function runDriftCheckForCompany(svc, companyId, targetDate, timeZone, companyWrites) {
  try {
    const calendarBasis = normalizeDashboardTimeZone(timeZone)
    let query = svc
      .from('dashboard_snapshots')
      .select(DRIFT_METRICS.map(m => m.snap_field).join(', ') + ', snapshot_taken_at')
      .eq('company_id', companyId)
      .is('funnel_id', null)
      .eq('period_start', targetDate)
    query = query.eq('calendar_basis', companyWrites ? calendarBasis : 'utc')
    const { data: snap } = await query.maybeSingle()

    if (!snap) {
      // Sem snapshot = não há como comparar, ignorar silenciosamente
      return null
    }

    // 2. Buscar realtime para o mesmo dia via get_dashboard_forecast
    const { data: rtData } = await svc.rpc(
      companyWrites ? 'get_dashboard_forecast_company' : 'get_dashboard_forecast',
      {
      p_company_id: companyId,
      p_start_date: targetDate,
      p_end_date:   targetDate,
      p_funnel_id:  null,
      p_user_id:    null,
    })

    if (!rtData) return null

    // 3. Calcular delta por métrica
    const metricsResult = {}
    let   maxDriftPct   = 0
    let   driftCount    = 0

    for (const m of DRIFT_METRICS) {
      const sv  = Number(snap[m.snap_field] ?? 0)
      const rv  = Number(rtData[m.rt_field] ?? 0)
      const pct = Math.round(deltaPct(sv, rv) * 100) / 100

      metricsResult[m.key] = { snap: sv, rt: rv, pct }

      if (pct > maxDriftPct) maxDriftPct = pct
      if (pct > DRIFT_WARN_PCT) driftCount++
    }

    // 4. Status baseado no drift máximo
    let status
    if      (maxDriftPct >= DRIFT_CRIT_PCT) status = 'critical'
    else if (maxDriftPct >= DRIFT_WARN_PCT) status = 'warning'
    else                                    status = 'ok'

    // 5. Persistir
    await svc.from('dashboard_snapshot_drift_logs').insert({
      company_id:    companyId,
      checked_at:    new Date().toISOString(),
      check_date:    targetDate,
      max_drift_pct: maxDriftPct,
      drift_count:   driftCount,
      metrics_json:  metricsResult,
      status,
    })

    return { companyId, maxDriftPct, driftCount, status }
  } catch (err) {
    // Drift check nunca bloqueia o cron
    console.warn('[cron/drift-check] Erro silencioso para', companyId, ':', err?.message)
    return null
  }
}

/** Remove registros expirados das tabelas de log operacionais */
async function pruneOperationalTables(svc, jobDate) {
  const now    = new Date(jobDate + 'T00:00:00Z')
  const cutoffs = {
    cron_runs:     new Date(now.getTime() - RETENTION_CRON_RUNS     * 86_400_000).toISOString(),
    drift_logs:    new Date(now.getTime() - RETENTION_DRIFT_LOGS    * 86_400_000).toISOString(),
    fallback_logs: new Date(now.getTime() - RETENTION_FALLBACK_LOGS * 86_400_000).toISOString(),
    snapshot_jobs: new Date(now.getTime() - RETENTION_SNAPSHOT_JOBS * 86_400_000).toISOString(),
    usage_logs:    new Date(now.getTime() - RETENTION_USAGE_LOGS    * 86_400_000).toISOString(),
  }

  const pruneOps = [
    svc.from('dashboard_snapshot_cron_runs').delete().lt('created_at', cutoffs.cron_runs),
    svc.from('dashboard_snapshot_drift_logs').delete().lt('checked_at', cutoffs.drift_logs),
    svc.from('dashboard_snapshot_fallback_logs').delete().lt('occurred_at', cutoffs.fallback_logs),
    svc.from('dashboard_snapshot_jobs').delete().lt('created_at', cutoffs.snapshot_jobs),
    svc.from('dashboard_endpoint_usage_logs').delete().lt('occurred_at', cutoffs.usage_logs),
  ]

  const results = await Promise.allSettled(pruneOps)
  const errors  = results.filter(r => r.status === 'rejected').map(r => r.reason?.message ?? r.reason)

  if (errors.length > 0) {
    console.warn('[cron/prune] Erros parciais no pruning:', errors)
  } else {
    console.info('[cron/prune] Pruning concluído | cutoffs:', {
      cron_runs:     cutoffs.cron_runs.slice(0, 10),
      drift_logs:    cutoffs.drift_logs.slice(0, 10),
      fallback_logs: cutoffs.fallback_logs.slice(0, 10),
      snapshot_jobs: cutoffs.snapshot_jobs.slice(0, 10),
      usage_logs:    cutoffs.usage_logs.slice(0, 10),
    })
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (!cronGuard(req, res)) return;
  // Aceita GET (Vercel Cron trigger automático) e POST (chamadas manuais / testes)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  if (!validateCronAuth(req)) {
    console.warn('[cron/generate-dashboard-snapshots] Acesso sem CRON_SECRET válido')
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[cron/generate-dashboard-snapshots] service_role não configurado')
    return res.status(500).json({ ok: false, error: 'service_role não configurado' })
  }

  const startedAt = Date.now()
  const jobDate   = new Date().toISOString().slice(0, 10)
  const now       = new Date(startedAt)
  const runTable  = COMPANY_SNAPSHOT_WRITES
    ? 'dashboard_company_snapshot_runs'
    : 'dashboard_snapshot_cron_runs'
  let runId = null
  let companyRunStartedAt = null

  if (COMPANY_SNAPSHOT_WRITES) {
    const claim = await claimCompanySnapshotRun(svc, jobDate, startedAt)
    if (!claim.claimed) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: claim.reason,
        job_date: jobDate,
        producer: 'lovoo-crm',
      })
    }
    runId = claim.id
    companyRunStartedAt = claim.startedAt
  }

  // ── 0. Guard de idempotência da base utc — não bloqueia o produtor da empresa ──
  if (!COMPANY_SNAPSHOT_WRITES) {
  // Cobre dois cenários:
  //   a) Run 'completed'/'partial': invocação duplicada pós-término → ignorar
  //   b) Run 'running' recente (< 10 min): invocação concorrente → ignorar
  //      (race condition corrigida na FASE 5.4.1 — runs em progresso também bloqueiam)
  //   c) Run 'running' stale (>= 10 min): run anterior travada → permitir nova execução
  //      (cron tem timeout de 255s ≈ 4.25 min; 10 min garante margem segura)
  try {
    const { data: existingRun } = await svc
      .from('dashboard_snapshot_cron_runs')
      .select('id, status, started_at')
      .eq('run_date', jobDate)
      .in('status', ['completed', 'partial', 'running'])
      .maybeSingle()

    if (existingRun) {
      if (existingRun.status === 'running') {
        const ageMs = Date.now() - new Date(existingRun.started_at).getTime()
        if (ageMs < 10 * 60 * 1000) {
          // Run legítima em progresso — bloquear invocação concorrente
          console.info(
            '[cron/generate-dashboard-snapshots] Run em progresso para', jobDate,
            '— ignorando invocação concorrente | existingRunId:', existingRun.id,
            '| age_ms:', ageMs
          )
          return res.status(200).json({
            ok:       true,
            skipped:  true,
            reason:   'concurrent_run',
            job_date: jobDate,
          })
        }
        // Run stale (>= 10 min) — provável crash anterior; permitir nova execução
        console.warn(
          '[cron/generate-dashboard-snapshots] Run stale detectada para', jobDate,
          '— permitindo nova execução | stale_run_id:', existingRun.id,
          '| age_ms:', ageMs
        )
      } else {
        // completed ou partial — invocação duplicada pós-término
        console.info(
          '[cron/generate-dashboard-snapshots] Run já completada para', jobDate,
          '— ignorando invocação duplicada | existingRunId:', existingRun.id
        )
        return res.status(200).json({
          ok:       true,
          skipped:  true,
          reason:   'duplicate_invocation',
          job_date: jobDate,
        })
      }
    }
  } catch (err) {
    // Falha no guard não impede a execução (benefício da dúvida)
    console.warn('[cron/idempotency-guard] Erro ao verificar run existente:', err?.message)
  }
  }

  console.log(
    '[cron/generate-dashboard-snapshots] Iniciando | jobDate:', jobDate,
    '| writer:', COMPANY_SNAPSHOT_WRITES ? 'lovoo-crm' : 'utc',
  )

  // ── 1. Registro da base utc. A base da empresa já tomou posse acima. ──
  if (!COMPANY_SNAPSHOT_WRITES) {
    try {
      const { data: cronRun } = await svc
        .from('dashboard_snapshot_cron_runs')
        .insert({
          run_date:   jobDate,
          started_at: new Date(startedAt).toISOString(),
          status:     'running',
        })
        .select('id')
        .single()

      runId = cronRun?.id ?? null
    } catch (err) {
      console.warn('[cron] Falha ao criar cron_run header:', err?.message)
    }
  }

  // ── Processamento principal — outer try/catch garante cleanup do cron_run ──
  try {
    // ── 2. Pruning das tabelas de log operacionais ──────────────────────────
    await pruneOperationalTables(svc, jobDate)

    // ── 3. Buscar empresas ativas ───────────────────────────────────────────
    const { data: companies, error: companiesError } = await svc
      .from('companies')
      .select('id, timezone')
      .is('deleted_at', null)
      .eq('status', 'active')

    if (companiesError) {
      throw new Error('Erro ao buscar empresas: ' + companiesError.message)
    }

    if (COMPANY_SNAPSHOT_WRITES && !(await snapshotCalendarReady(svc))) {
      console.error('[cron/generate-dashboard-snapshots] calendar_basis ausente. Nenhuma métrica foi gravada.')
      if (runId) {
        await finishOwnedCompanyRun(svc, runId, companyRunStartedAt, 'failed')
      }
      return res.status(200).json({
        ok: false,
        skipped: true,
        reason: 'calendar_basis_ausente',
        job_date: jobDate,
      })
    }

    const companyRows = companies ?? []
    const companyIds = companyRows.map(c => c.id)
    const total      = companyIds.length

    console.log('[cron/generate-dashboard-snapshots] Empresas ativas:', total)

    if (total > 150) {
      console.warn(
        '[cron/generate-dashboard-snapshots] ATENÇÃO: empresas ativas (' + total + ') > 150.' +
        ' Considerar migração para arquitetura dispatcher/worker (ver FASE 4.3).'
      )
    }

    // ── 4. Processar em batches ─────────────────────────────────────────────
    let processed  = 0
    let failed     = 0
    let timeoutHit = false

    for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        console.warn('[cron/generate-dashboard-snapshots] Timeout preventivo atingido. Interrompendo.')
        timeoutHit = true
        break
      }

      const batch   = companyRows.slice(i, i + BATCH_SIZE)
      const batchNo = Math.floor(i / BATCH_SIZE) + 1

      for (const company of batch) {
        const dates = COMPANY_SNAPSHOT_WRITES
          ? companySnapshotDates(company.timezone, now)
          : utcSnapshotDates(DATES_BACK, now)
        const rpcName = COMPANY_SNAPSHOT_WRITES
          ? 'generate_dashboard_company_daily_snapshot'
          : 'generate_dashboard_daily_snapshot'
        for (const date of dates) {
          const results = await processBatch(svc, [company.id], date, jobDate, rpcName)
          for (const r of results) {
            if (r.ok) processed++
            else      failed++
          }
        }
      }

      console.log(
        '[cron/generate-dashboard-snapshots] Batch', batchNo,
        '| processed:', processed, '| failed:', failed
      )

      if (i + BATCH_SIZE < companyIds.length) {
        await sleep(BATCH_DELAY)
      }
    }

    // ── 5. Drift check automático — amostra pós-geração ────────────────────
    let driftChecked = 0
    let driftAlerts  = 0

    // Drift do último dia civil encerrado de cada empresa da amostra.
    const driftSample = sampleCompanies(companyIds, DRIFT_SAMPLE_SIZE, jobDate)
    const timezoneByCompany = new Map(companyRows.map(company => [company.id, company.timezone]))

    for (const companyId of driftSample) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        console.warn('[cron/drift-check] Timeout atingido durante drift check, interrompendo')
        break
      }

      const companyZone = timezoneByCompany.get(companyId)
      const targetDate = (COMPANY_SNAPSHOT_WRITES
        ? companySnapshotDates(companyZone, now)
        : utcSnapshotDates(DATES_BACK, now))[0]
      const result = await runDriftCheckForCompany(
        svc, companyId, targetDate, companyZone, COMPANY_SNAPSHOT_WRITES,
      )

      if (result) {
        driftChecked++
        if (result.status === 'critical') {
          driftAlerts++
          console.error(
            '[cron/drift-check] DRIFT CRÍTICO | company:', companyId,
            '| date:', targetDate,
            '| max_drift:', result.maxDriftPct.toFixed(2) + '%'
          )
        } else if (result.status === 'warning') {
          console.warn(
            '[cron/drift-check] DRIFT WARNING | company:', companyId,
            '| date:', targetDate,
            '| max_drift:', result.maxDriftPct.toFixed(2) + '%'
          )
        }
      }
    }

    // ── 6. Finalizar registro de execução global ────────────────────────────
    const duration    = Date.now() - startedAt
    const finalStatus = companyRunFinalStatus(timeoutHit, failed)

    if (runId && COMPANY_SNAPSHOT_WRITES) {
      const owned = await finishOwnedCompanyRun(svc, runId, companyRunStartedAt, finalStatus)
      if (!owned) {
        return res.status(200).json({
          ok: false,
          skipped: true,
          reason: 'lost_ownership',
          job_date: jobDate,
          producer: 'lovoo-crm',
          status: 'running',
        })
      }
    } else if (runId) {
      const patch = {
            status:          finalStatus,
            finished_at:     new Date().toISOString(),
            total_companies: total,
            processed_count: processed,
            failed_count:    failed,
            timeout_hit:     timeoutHit,
            duration_ms:     duration,
            drift_checked:   driftChecked,
            drift_alerts:    driftAlerts,
          }
      await svc.from(runTable).update(patch).eq('id', runId)
    }

    console.log(
      '[cron/generate-dashboard-snapshots] Concluído |',
      'status:', finalStatus,
      '| processed:', processed, '| failed:', failed,
      '| drift_checked:', driftChecked, '| drift_alerts:', driftAlerts,
      '| duration:', duration + 'ms'
    )

    return res.status(200).json({
      ok:              COMPANY_SNAPSHOT_WRITES ? finalStatus === 'completed' : true,
      job_date:        jobDate,
      dates_basis:     COMPANY_SNAPSHOT_WRITES ? 'company_timezone' : 'utc',
      company_writes:  COMPANY_SNAPSHOT_WRITES,
      fallback_dates:  COMPANY_SNAPSHOT_WRITES ? companySnapshotDates(null, now) : utcSnapshotDates(DATES_BACK, now),
      total_companies: total,
      processed,
      failed,
      timeout_hit:     timeoutHit,
      drift_checked:   driftChecked,
      drift_alerts:    driftAlerts,
      duration_ms:     duration,
      status:          finalStatus,
    })
  } catch (err) {
    // Erro inesperado no processamento principal — garantir cleanup do cron_run
    const duration = Date.now() - startedAt
    console.error('[cron/generate-dashboard-snapshots] Erro inesperado:', err?.message)

    if (runId && COMPANY_SNAPSHOT_WRITES) {
      await finishOwnedCompanyRun(svc, runId, companyRunStartedAt, 'failed').catch(updateErr => {
        console.error('[cron] Falha ao atualizar a execução para failed:', updateErr?.message)
      })
    } else if (runId) {
      await svc.from(runTable).update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).eq('id', runId).catch(updateErr => {
        console.error('[cron] Falha ao atualizar a execução para failed:', updateErr?.message)
      })
    }

    return res.status(500).json({ ok: false, error: err?.message ?? 'Erro interno' })
  }
}
