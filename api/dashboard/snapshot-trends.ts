// =====================================================
// GET /api/dashboard/snapshot-trends
//
// Série temporal de snapshots diários para um período.
// Retorna um ponto por dia para as métricas solicitadas.
// Base para gráficos de tendência na FASE 4.1.
//
// SHADOW MODE: endpoint ativo mas NÃO consumido pelo frontend ainda.
//
// Query params:
//   company_id  (obrigatório)
//   from_date   (YYYY-MM-DD, obrigatório)
//   to_date     (YYYY-MM-DD, obrigatório)
//   funnel_id   (opcional — NULL = company-wide)
//   metrics     (CSV de nomes de métricas, default: pipeline_weighted,won_value,conversion_rate)
//
// AUTENTICAÇÃO:
//   Bearer JWT do usuário → membership validado.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                           from '../lib/dashboard/auth.js'
import { withTiming }        from '../lib/dashboard/observability.js'
import { fetchDailySeries } from '../lib/dashboard/snapshotSeries.js'

// Métricas permitidas (whitelist para evitar injeção SQL)
const ALLOWED_METRICS = new Set([
  // FLOW
  'leads_created', 'conversations_attended', 'won_count', 'won_value',
  'lost_count', 'lost_value', 'sla_breached_count',
  // STATE
  'pipeline_total', 'pipeline_weighted', 'pipeline_risk',
  'open_count', 'stalled_count', 'hot_count',
  'avg_response_minutes', 'conversion_rate',
  'prob_0_20_value', 'prob_21_40_value', 'prob_41_60_value',
  'prob_61_80_value', 'prob_81_100_value',
])

const DEFAULT_METRICS = ['pipeline_weighted', 'won_value', 'conversion_rate']
const MAX_DAYS        = 90

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── Autenticação ───────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc       = getSupabaseAdmin()
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id obrigatório'); return }

    const member = await assertMembership(svc, user.id, companyId)
    if (!member) { jsonError(res, 403, 'Acesso negado'); return }

    // ── Parâmetros ─────────────────────────────────────────────────────────
    const fromDate = typeof req.query.from_date === 'string' ? req.query.from_date.trim() : ''
    const toDate   = typeof req.query.to_date   === 'string' ? req.query.to_date.trim()   : ''
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null

    if (!fromDate || !toDate) {
      jsonError(res, 400, 'from_date e to_date são obrigatórios')
      return
    }

    // Validar janela temporal
    const fromMs = new Date(fromDate).getTime()
    const toMs   = new Date(toDate).getTime()
    const daysDiff = Math.ceil((toMs - fromMs) / 86_400_000) + 1

    if (daysDiff > MAX_DAYS) {
      jsonError(res, 400, `Janela máxima: ${MAX_DAYS} dias`)
      return
    }

    // Métricas solicitadas (whitelist)
    const requestedRaw = typeof req.query.metrics === 'string'
      ? req.query.metrics.split(',').map((s: string) => s.trim())
      : DEFAULT_METRICS

    const metrics = requestedRaw.filter((m: string) => ALLOWED_METRICS.has(m))
    if (metrics.length === 0) {
      jsonError(res, 400, 'Nenhuma métrica válida solicitada')
      return
    }

    // ── Buscar série temporal ──────────────────────────────────────────────
    let rows: any[]
    try {
      rows = await withTiming(
        'snapshot.trends.query',
        () => fetchDailySeries(svc, { companyId, funnelId, metrics, fromDate, toDate }),
        { companyId },
      )
    } catch (e: any) {
      console.error('[snapshot-trends] Erro:', e?.message)
      jsonError(res, 500, 'Erro ao buscar snapshots')
      return
    }

    return res.status(200).json({
      ok:          true,
      company_id:  companyId,
      funnel_id:   funnelId,
      from_date:   fromDate,
      to_date:     toDate,
      metrics,
      data_points: rows.length,
      series:      rows,
    })
  } catch (err: any) {
    console.error('[snapshot-trends] Erro:', err?.message)
    jsonError(res, 500, 'Erro interno')
  }
}
