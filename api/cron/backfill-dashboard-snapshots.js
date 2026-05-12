// =============================================================================
// POST /api/cron/backfill-dashboard-snapshots
//
// Backfill manual de snapshots históricos com checkpoint persistente.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   Acesso exclusivo via service_role — não exposto ao frontend.
//
// USO:
//   Primeira chamada (novo backfill):
//     POST /api/cron/backfill-dashboard-snapshots
//     Body: { from_date: "2026-04-01", to_date: "2026-05-10" }
//     Body opcional: { company_ids: ["uuid1", "uuid2"] }  // NULL = todas
//
//   Retomada após timeout:
//     POST /api/cron/backfill-dashboard-snapshots
//     Body: { resume_backfill_id: "uuid-do-backfill" }
//
// CHECKPOINT:
//   O progresso é persistido em dashboard_snapshot_backfills.
//   Se o Vercel timeout (55s safety), retorna resume_backfill_id.
//   Re-chamar com resume_backfill_id retoma de onde parou.
//
// BATCHING:
//   Processa 1 data por iteração, 5 empresas por batch, 200ms de delay.
//   A cada 5 empresas: atualiza checkpoint no banco.
//
// VARIÁVEIS DE AMBIENTE:
//   CRON_SECRET              — autenticação
//   SUPABASE_SERVICE_ROLE_KEY — service_role
//   VITE_SUPABASE_URL         — URL Supabase
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const COMPANY_BATCH = 5     // empresas por sub-batch
const BATCH_DELAY   = 200   // ms entre sub-batches
const TIMEOUT_MS    = 55_000 // 55s — safety margin (limite Vercel: 60s hobby / 300s pro)

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

/** Retorna array de datas entre from e to em ordem DECRESCENTE (mais recente primeiro) */
function dateRange(from, to) {
  const dates = []
  const cur   = new Date(to + 'T00:00:00Z')
  const end   = new Date(from + 'T00:00:00Z')
  while (cur >= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() - 1)
  }
  return dates
}

/** Calcula estimativa de total company-days */
function estimateTotal(dates, companyCount) {
  return dates.length * companyCount
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  if (!validateCronAuth(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ ok: false, error: 'service_role não configurado' })
  }

  const body             = req.body ?? {}
  const resumeId         = body.resume_backfill_id ?? null
  const startedAt        = Date.now()
  let backfill           = null
  let companyIds         = []
  let dates              = []

  // ── 1. Carregar ou criar registro de backfill ────────────────────────────
  if (resumeId) {
    // Retomar backfill existente
    const { data, error } = await svc
      .from('dashboard_snapshot_backfills')
      .select('*')
      .eq('id', resumeId)
      .single()

    if (error || !data) {
      return res.status(404).json({ ok: false, error: 'Backfill não encontrado: ' + resumeId })
    }
    if (data.status === 'completed') {
      return res.status(200).json({ ok: true, message: 'Backfill já concluído', backfill_id: resumeId })
    }

    backfill = data
    dates    = dateRange(data.from_date, data.last_processed_date ?? data.to_date)
    console.log('[backfill] Retomando', resumeId, '| from last_processed_date:', backfill.last_processed_date)
  } else {
    // Novo backfill
    const { from_date, to_date, company_ids } = body
    if (!from_date || !to_date) {
      return res.status(400).json({ ok: false, error: 'from_date e to_date são obrigatórios' })
    }

    // Buscar empresas
    let query = svc.from('companies').select('id').is('deleted_at', null).eq('status', 'active')
    if (Array.isArray(company_ids) && company_ids.length > 0) {
      query = query.in('id', company_ids)
    }
    const { data: companies, error: cErr } = await query
    if (cErr) return res.status(500).json({ ok: false, error: cErr.message })

    companyIds = (companies ?? []).map(c => c.id)
    dates      = dateRange(from_date, to_date)

    const { data: created, error: createErr } = await svc
      .from('dashboard_snapshot_backfills')
      .insert({
        status:              'running',
        from_date,
        to_date,
        last_processed_date: to_date,
        total_company_days:  estimateTotal(dates, companyIds.length),
        processed_count:     0,
        failed_count:        0,
        company_ids:         Array.isArray(company_ids) && company_ids.length > 0 ? company_ids : null,
      })
      .select('*')
      .single()

    if (createErr || !created) {
      return res.status(500).json({ ok: false, error: 'Erro ao criar backfill: ' + createErr?.message })
    }

    backfill = created
    console.log('[backfill] Novo backfill', backfill.id, '| datas:', dates.length, '| empresas:', companyIds.length)
  }

  // Se retomando, buscar lista de empresas do backfill
  if (resumeId && companyIds.length === 0) {
    let query = svc.from('companies').select('id').is('deleted_at', null).eq('status', 'active')
    if (Array.isArray(backfill.company_ids) && backfill.company_ids.length > 0) {
      query = query.in('id', backfill.company_ids)
    }
    const { data: companies } = await query
    companyIds = (companies ?? []).map(c => c.id)
  }

  // ── 2. Processar datas em ordem decrescente ──────────────────────────────
  let processed = backfill.processed_count
  let failed    = backfill.failed_count
  let lastDate  = backfill.last_processed_date ?? dates[0]

  for (const date of dates) {
    // Verificar timeout
    if (Date.now() - startedAt > TIMEOUT_MS) {
      console.log('[backfill] Timeout preventivo | pausando em date:', date)

      await svc.from('dashboard_snapshot_backfills')
        .update({
          status:              'paused',
          last_processed_date: lastDate,
          processed_count:     processed,
          failed_count:        failed,
          updated_at:          new Date().toISOString(),
        })
        .eq('id', backfill.id)

      return res.status(200).json({
        ok:                 true,
        completed:          false,
        paused:             true,
        resume_backfill_id: backfill.id,
        last_processed_date: lastDate,
        processed,
        failed,
        message:          'Timeout preventivo. Re-chamar com resume_backfill_id para continuar.',
      })
    }

    // Processar empresas em sub-batches
    for (let i = 0; i < companyIds.length; i += COMPANY_BATCH) {
      const batch = companyIds.slice(i, i + COMPANY_BATCH)

      for (const companyId of batch) {
        const { data, error } = await svc.rpc('generate_dashboard_daily_snapshot', {
          p_company_id: companyId,
          p_date:       date,
        })

        const ok = !error && (data?.ok !== false)
        if (ok) processed++
        else {
          failed++
          await svc.from('dashboard_snapshot_backfills')
            .update({ error_last: error?.message ?? data?.error ?? 'unknown' })
            .eq('id', backfill.id)
        }
      }

      await sleep(BATCH_DELAY)
    }

    lastDate = date

    // Atualizar checkpoint após cada data concluída
    await svc.from('dashboard_snapshot_backfills')
      .update({
        status:              'running',
        last_processed_date: lastDate,
        processed_count:     processed,
        failed_count:        failed,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', backfill.id)

    console.log('[backfill] Data concluída:', date, '| processed:', processed, '| failed:', failed)
  }

  // ── 3. Marcar como concluído ─────────────────────────────────────────────
  const finishedAt = new Date().toISOString()
  await svc.from('dashboard_snapshot_backfills')
    .update({
      status:          'completed',
      processed_count: processed,
      failed_count:    failed,
      finished_at:     finishedAt,
      updated_at:      finishedAt,
    })
    .eq('id', backfill.id)

  console.log('[backfill] Concluído | backfill_id:', backfill.id, '| processed:', processed, '| failed:', failed)

  return res.status(200).json({
    ok:            true,
    completed:     true,
    backfill_id:   backfill.id,
    processed,
    failed,
    duration_ms:   Date.now() - startedAt,
  })
}
