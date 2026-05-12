// =====================================================
// GET /api/dashboard/snapshot-diff
//
// Shadow mode: compara snapshot D-1 com a query realtime
// para o mesmo período e detecta drift matemático.
//
// ACESSO: apenas service_role (via CRON_SECRET) — endpoint admin interno.
// NÃO exposto ao frontend durante a FASE 4.0.
//
// Query params:
//   company_id (obrigatório)
//   date       (default: D-1, formato YYYY-MM-DD)
//
// Retorno:
//   { metrics: [{ metric, snapshot_value, realtime_value, delta_pct, ok }] }
//   ok por métrica = delta_pct <= 2
// =====================================================

import { createClient }  from '@supabase/supabase-js'
import { resolvePeriod } from '../lib/dashboard/period.js'

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function validateAdminAuth(req: any): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

function deltaPct(snap: number, rt: number): number {
  if (rt === 0 && snap === 0) return 0
  if (rt === 0) return 100
  return Math.abs((snap - rt) / rt) * 100
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  if (!validateAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized — use CRON_SECRET' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ ok: false, error: 'service_role não configurado' })
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
  if (!companyId) {
    return res.status(400).json({ ok: false, error: 'company_id obrigatório' })
  }

  // Data alvo: ontem por padrão
  let targetDate: string
  if (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
    targetDate = req.query.date
  } else {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    targetDate = d.toISOString().slice(0, 10)
  }

  // 1. Buscar snapshot do dia
  const { data: snap } = await svc
    .from('dashboard_snapshots')
    .select('*')
    .eq('company_id', companyId)
    .is('funnel_id', null)
    .eq('period_start', targetDate)
    .maybeSingle()

  if (!snap) {
    return res.status(404).json({
      ok:    false,
      error: `Snapshot não encontrado para company_id=${companyId} date=${targetDate}`,
      hint:  'Execute o backfill primeiro',
    })
  }

  // 2. Query realtime para o mesmo período
  const period = resolvePeriod('custom', targetDate, targetDate)
  const { data: rtData } = await svc.rpc('get_dashboard_forecast', {
    p_company_id: companyId,
    p_start_date: targetDate,
    p_end_date:   targetDate,
    p_funnel_id:  null,
    p_user_id:    null,
  })

  const rt = rtData ?? {}

  // 3. Comparar métricas
  const METRICS_TO_COMPARE = [
    { key: 'pipeline_total',    snap_field: 'pipeline_total',    rt_field: 'pipeline_total'    },
    { key: 'pipeline_weighted', snap_field: 'pipeline_weighted', rt_field: 'pipeline_weighted' },
    { key: 'open_count',        snap_field: 'open_count',        rt_field: 'open_count'        },
    { key: 'stalled_count',     snap_field: 'stalled_count',     rt_field: 'stalled_count'     },
    { key: 'won_count',         snap_field: 'won_count',         rt_field: 'won_count'         },
    { key: 'won_value',         snap_field: 'won_value',         rt_field: 'won_value'         },
    { key: 'conversion_rate',   snap_field: 'conversion_rate',   rt_field: 'conversion_rate'   },
  ]

  const MAX_DRIFT_PCT = 2

  const results = METRICS_TO_COMPARE.map(m => {
    const sv  = Number(snap[m.snap_field] ?? 0)
    const rv  = Number(rt[m.rt_field]    ?? 0)
    const pct = deltaPct(sv, rv)
    return {
      metric:          m.key,
      snapshot_value:  sv,
      realtime_value:  rv,
      delta_pct:       Math.round(pct * 100) / 100,
      ok:              pct <= MAX_DRIFT_PCT,
    }
  })

  const allOk        = results.every(r => r.ok)
  const drifted      = results.filter(r => !r.ok)

  if (!allOk) {
    console.warn('[snapshot-diff] DRIFT DETECTADO | company:', companyId, '| date:', targetDate, '| drifted:', drifted.map(d => d.metric))
  }

  return res.status(200).json({
    ok:             allOk,
    company_id:     companyId,
    date:           targetDate,
    max_drift_pct:  MAX_DRIFT_PCT,
    all_ok:         allOk,
    drift_count:    drifted.length,
    metrics:        results,
    snapshot_taken_at: snap.snapshot_taken_at,
  })
}
